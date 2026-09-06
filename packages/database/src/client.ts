import { PrismaClient } from '@prisma/client';

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
  return new PrismaClient({
    datasourceUrl,
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });
}
