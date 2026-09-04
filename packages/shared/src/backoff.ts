/**
 * Full jitter exponential backoff:
 * delay = random(0, min(cap, base * 2^attempt))
 *
 * `attempt` is zero-based (0 after the first failure).
 */
export function fullJitterDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
): number {
  if (attempt < 0) {
    throw new Error('attempt must be >= 0');
  }
  if (baseMs <= 0 || capMs <= 0) {
    throw new Error('baseMs and capMs must be > 0');
  }

  const exponential = baseMs * 2 ** attempt;
  const bound = Math.min(capMs, exponential);
  return Math.floor(Math.random() * (bound + 1));
}
