import { InfrastructureError, TimeoutError } from '@salon/shared';

export type OutboundHttpInit = RequestInit & { timeoutMs: number };

/**
 * Bounded outbound HTTP. Timeout aborts the underlying request via AbortController.
 * No retries — callers must not create retry storms.
 */
export async function fetchWithTimeout(
  url: string,
  init: OutboundHttpInit,
): Promise<Response> {
  const { timeoutMs, signal: callerSignal, ...rest } = init;
  const timeoutAbort = new AbortController();
  const timer = setTimeout(() => timeoutAbort.abort(), timeoutMs);
  const signal =
    callerSignal != null
      ? AbortSignal.any([callerSignal, timeoutAbort.signal])
      : timeoutAbort.signal;

  try {
    return await fetch(url, { ...rest, signal });
  } catch (error: unknown) {
    if (timeoutAbort.signal.aborted && callerSignal?.aborted !== true) {
      throw new InfrastructureError('Outbound request timed out');
    }
    if (error instanceof TimeoutError) {
      throw new InfrastructureError('Outbound request timed out');
    }
    throw new InfrastructureError('Outbound request failed');
  } finally {
    clearTimeout(timer);
  }
}
