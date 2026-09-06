import { InfrastructureError, TimeoutError, withTimeout } from '@salon/shared';

export type OutboundHttpInit = RequestInit & { timeoutMs: number };

/**
 * Bounded outbound HTTP. No retries — callers must not create retry storms.
 * There are no production outbound HTTP dependencies in Phase B; this is the
 * required timeout wrapper for any future adapter.
 */
export async function fetchWithTimeout(
  url: string,
  init: OutboundHttpInit,
): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  try {
    return await withTimeout(fetch(url, rest), timeoutMs, 'Outbound HTTP timed out');
  } catch (error: unknown) {
    if (error instanceof TimeoutError) {
      throw new InfrastructureError('Outbound request timed out');
    }
    throw new InfrastructureError('Outbound request failed');
  }
}
