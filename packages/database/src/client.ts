import { PrismaClient } from '@prisma/client';

const PRISMA_LOG_LEVELS =
  process.env.NODE_ENV === 'development'
    ? (['error', 'warn'] as const)
    : (['error'] as const);

export type SanitizedPrismaLog = {
  target?: string;
  operation?: string;
  code?: string;
};

function safeToken(value: string | undefined): string | undefined {
  if (!value || value.length > 80 || !/^[A-Za-z0-9_.$:-]+$/.test(value)) {
    return undefined;
  }
  return value;
}

/**
 * Keeps a Prisma engine log line to operation and error code.
 * The raw message can include bound parameters and rejected row text.
 */
export function sanitizePrismaLogEvent(message: string, target: string): SanitizedPrismaLog {
  const head = message.split(/DETAIL:|Failing row|\bdetail:/)[0] ?? '';
  const fromMessage = safeToken(message.match(/^Invalid `prisma\.([^`]+)\(\)` invocation/)?.[1]);
  const methodTarget = /^[$A-Za-z_][A-Za-z0-9_.$]*$/.test(target) ? safeToken(target) : undefined;
  const operation = fromMessage ?? methodTarget;
  const reportedTarget = safeToken(target);
  const code = safeToken(
    head.match(/\bCode: `([0-9A-Z]{5})`/)?.[1] ??
      head.match(/\bcode: "([0-9A-Z]{5})"/)?.[1] ??
      head.match(/\b(P[0-9]{4})\b/)?.[1],
  );
  return {
    ...(reportedTarget && reportedTarget !== operation ? { target: reportedTarget } : {}),
    ...(operation ? { operation } : {}),
    ...(code ? { code } : {}),
  };
}

function writeSanitizedPrismaLog(
  level: (typeof PRISMA_LOG_LEVELS)[number],
  message: string,
  target: string,
): void {
  const line = JSON.stringify({
    source: 'prisma',
    level,
    ...sanitizePrismaLogEvent(message, target),
  });
  process.stderr.write(`${line}\n`);
}

export type PrismaPoolOptions = {
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
};

function withQueryParam(databaseUrl: string, key: string, value: string): string {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    const pattern = new RegExp(`([?&])${key}=[^&]*`);
    if (pattern.test(databaseUrl)) {
      return databaseUrl.replace(pattern, `$1${key}=${encodeURIComponent(value)}`);
    }
    const separator = databaseUrl.includes('?') ? '&' : '?';
    return `${databaseUrl}${separator}${key}=${encodeURIComponent(value)}`;
  }
}

/**
 * Applies Prisma connection-pool query params without logging the URL.
 * Existing query params are preserved; explicit pool fields override.
 */
export function applyDatabasePoolParams(
  databaseUrl: string,
  options: PrismaPoolOptions = {},
): string {
  let result = databaseUrl;
  if (options.connectionLimit != null) {
    result = withQueryParam(result, 'connection_limit', String(options.connectionLimit));
  }
  if (options.poolTimeoutSeconds != null) {
    result = withQueryParam(result, 'pool_timeout', String(options.poolTimeoutSeconds));
  }
  return result;
}

export function createPrismaClient(
  databaseUrl: string,
  pool: PrismaPoolOptions = {},
): PrismaClient {
  const datasourceUrl =
    pool.connectionLimit == null && pool.poolTimeoutSeconds == null
      ? databaseUrl
      : applyDatabasePoolParams(databaseUrl, pool);
  const client = new PrismaClient({
    datasourceUrl,
    log: PRISMA_LOG_LEVELS.map((level) => ({ emit: 'event' as const, level })),
  });
  for (const level of PRISMA_LOG_LEVELS) {
    client.$on(level, (event) => {
      writeSanitizedPrismaLog(level, event.message, event.target);
    });
  }
  return client;
}
