import { fullJitterDelayMs } from './backoff';

describe('fullJitterDelayMs', () => {
  it('stays within [0, min(cap, base * 2^attempt)]', () => {
    const baseMs = 100;
    const capMs = 1000;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bound = Math.min(capMs, baseMs * 2 ** attempt);
      for (let i = 0; i < 50; i += 1) {
        const delay = fullJitterDelayMs(attempt, baseMs, capMs);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(bound);
      }
    }
  });

  it('rejects invalid inputs', () => {
    expect(() => fullJitterDelayMs(-1, 100, 1000)).toThrow();
    expect(() => fullJitterDelayMs(0, 0, 1000)).toThrow();
  });
});
