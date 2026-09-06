const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accepts only UUID-shaped IDs from clients. Rejects arbitrary strings
 * to avoid log injection and oversized correlation headers.
 */
export function isSafeRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

export function firstHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}
