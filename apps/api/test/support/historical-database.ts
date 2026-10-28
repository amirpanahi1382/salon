import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPrismaClient } from '@salon/database';

const FORBIDDEN_PORTS = new Set(['5432', '15442', '15450', '15452', '3002', '18082']);
const FORBIDDEN_NAMES = new Set([
  'salon',
  'salon_preview',
  'postgres',
  'template0',
  'template1',
  'phone_first_product',
  'salon-db',
]);

export const MIGRATIONS_DIR = resolve(__dirname, '../../../../packages/database/prisma/migrations');
export const SCHEMA_PATH = resolve(__dirname, '../../../../packages/database/prisma/schema.prisma');
const REPO_ROOT = resolve(__dirname, '../../../..');

export function scrub(text: string, url: URL): string {
  const password = decodeURIComponent(url.password);
  return text.split(url.toString()).join('[isolated URL]').split(password).join('[redacted]');
}

export function assertLoopbackPort(url: URL): void {
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('Historical database URL must be PostgreSQL');
  }
  if (url.hostname !== '127.0.0.1' || !url.port || FORBIDDEN_PORTS.has(url.port)) {
    throw new Error('Historical database must be a non-protected loopback port');
  }
}

export function assertDisposableName(name: string, pattern: RegExp): void {
  if (!pattern.test(name) || FORBIDDEN_NAMES.has(name) || name.includes('"')) {
    throw new Error('Historical database name is not an isolated disposable name');
  }
}

const PROTECTED_CONTAINERS = new Set([
  'salon-platform-postgres-1',
  'salon-mobile-ui-pg-20261017',
  'salon-preview-pg-20261005',
]);

function disposableContainerForPort(port: string): string {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not identify the disposable database container');
  const needle = `127.0.0.1:${port}->`;
  const hits = result.stdout.split('\n').filter((line) => line.includes(needle));
  if (hits.length !== 1) throw new Error('Historical database port does not map to one disposable container');
  const name = hits[0]!.split('\t')[0] ?? '';
  if (!name || PROTECTED_CONTAINERS.has(name) || name.includes('preview') || name.includes('mobile-ui')) {
    throw new Error('Historical database resolved a protected container');
  }
  return name;
}

export function listMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((name) => /^\d/.test(name)).sort();
}

export function withDatabase(url: URL, databaseName: string): string {
  const next = new URL(url);
  next.pathname = `/${databaseName}`;
  return next.toString();
}

export async function recreateDisposableDatabase(adminUrl: string, databaseName: string, pattern: RegExp): Promise<void> {
  const admin = new URL(adminUrl);
  assertLoopbackPort(admin);
  assertDisposableName(databaseName, pattern);
  const adminName = decodeURIComponent(admin.pathname.replace(/^\//, ''));
  if (adminName !== 'postgres') {
    throw new Error('Historical admin connection must be the postgres maintenance database');
  }
  const client = createPrismaClient(admin.toString());
  try {
    const rows = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (rows[0]?.name !== adminName) throw new Error('Historical admin connection resolved a different database');
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await client.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.$disconnect();
  }
}

export class HistoricalMigrationRehearsal {
  readonly temp: string;
  private readonly copied = new Set<string>();

  constructor(readonly databaseUrl: string) {
    const url = new URL(databaseUrl);
    assertLoopbackPort(url);
    this.temp = mkdtempSync(join(tmpdir(), 'salon-historical-'));
    writeFileSync(join(this.temp, 'schema.prisma'), readFileSync(SCHEMA_PATH));
    cpSync(join(MIGRATIONS_DIR, 'migration_lock.toml'), join(this.temp, 'migrations', 'migration_lock.toml'));
  }

  /** Copy a closed name range. `afterExclusive` is the last migration already applied. */
  copyRange(lastInclusive: string, afterExclusive?: string): void {
    let sawEnd = false;
    for (const name of listMigrationNames()) {
      if (afterExclusive && name <= afterExclusive) continue;
      if (name > lastInclusive) break;
      if (name === '20261017150000_phone_first_identity') {
        throw new Error('Phone-first migration is not part of a historical rehearsal');
      }
      if (!this.copied.has(name)) {
        cpSync(join(MIGRATIONS_DIR, name), join(this.temp, 'migrations', name), { recursive: true });
        this.copied.add(name);
      }
      if (name === lastInclusive) sawEnd = true;
    }
    if (!sawEnd) throw new Error(`Migration boundary was not available: ${lastInclusive}`);
  }

  deploy(): void {
    const url = new URL(this.databaseUrl);
    const result = spawnSync(
      'pnpm',
      ['--filter', '@salon/database', 'exec', 'prisma', 'migrate', 'deploy', '--schema', join(this.temp, 'schema.prisma')],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: this.databaseUrl },
        encoding: 'utf8',
      },
    );
    if (result.status !== 0) {
      throw new Error(`Isolated migration failed: ${scrub(`${result.stderr}\n${result.stdout}`, url)}`);
    }
  }

  applySqlFile(file: string): void {
    const url = new URL(this.databaseUrl);
    const container = disposableContainerForPort(url.port);
    const result = spawnSync(
      'docker',
      [
        'exec', '-i',
        '-e', `PGPASSWORD=${decodeURIComponent(url.password)}`,
        container,
        'psql', '-U', decodeURIComponent(url.username),
        '-d', decodeURIComponent(url.pathname.replace(/^\//, '')),
        '-v', 'ON_ERROR_STOP=1',
      ],
      { input: readFileSync(file), encoding: 'utf8' },
    );
    if (result.status !== 0) {
      const detail = `${result.error?.message ?? ''}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`;
      throw new Error(`Historical SQL failed: ${scrub(detail, url)}`);
    }
  }

  dispose(): void {
    rmSync(this.temp, { recursive: true, force: true });
  }
}
