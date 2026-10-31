/**
 * Disposable capacity process. Not part of the API build.
 * Start only with CAPACITY_BENCHMARK=1 after:
 *   pnpm exec tsc -p tsconfig.capacity.json
 *   node dist-capacity/perf/capacity-main.js
 * Throttling is disabled in this process. AppModule defaults stay unchanged.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createPrismaClient } from '@salon/database';
import { AppModule } from '../src/app.module';

const PORT = 18141;
const BIND = '127.0.0.1';
const EXPECTED_DATABASE = 'salon_metric_oracle_20261030';
const EXPECTED_COMMENT = 'metric-oracle-disposable:20261030';
const EXPECTED_PORT = '55931';
const REFUSED = new Set(['7700113693112733735', '7683163620851879970']);
const REFUSED_NAMES = new Set(['salon', 'salon-db', 'salon_preview', 'phone_first_product']);

async function assertDisposable(): Promise<void> {
  if (process.env.CAPACITY_BENCHMARK !== '1') {
    throw new Error('Refusing to start without CAPACITY_BENCHMARK=1');
  }
  const url = process.env.DATABASE_URL ?? '';
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (parsed.hostname !== BIND || parsed.port !== EXPECTED_PORT || REFUSED_NAMES.has(name) || name !== EXPECTED_DATABASE) {
    throw new Error('Refusing a database that is not the disposable benchmark');
  }
  const db = createPrismaClient(url, { connectionLimit: 1, poolTimeoutSeconds: 5 });
  const rows = await db.$queryRaw<Array<{ systemId: string; comment: string | null; name: string }>>`
    SELECT current_database() AS name,
           (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemId",
           (SELECT description FROM pg_catalog.pg_shdescription
              JOIN pg_catalog.pg_database ON objoid = pg_database.oid
             WHERE datname = current_database()) AS comment
  `;
  await db.$disconnect();
  const row = rows[0];
  if (!row || REFUSED.has(row.systemId) || row.name !== EXPECTED_DATABASE || row.comment !== EXPECTED_COMMENT) {
    throw new Error('Capacity API refused the database identity');
  }
  process.stdout.write(`capacity-db ${row.name} ${row.systemId}\n`);
}

async function main(): Promise<void> {
  await assertDisposable();
  ThrottlerGuard.prototype.canActivate = async () => true;
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const server = app.getHttpServer() as {
    timeout: number;
    headersTimeout: number;
    keepAliveTimeout: number;
  };
  server.timeout = 120_000;
  server.headersTimeout = 125_000;
  server.keepAliveTimeout = 5_000;
  await app.listen(PORT, BIND);
  process.stdout.write(`capacity-listen ${BIND}:${PORT}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`FAILED ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exit(1);
});
