import { fullJitterDelayMs } from '@salon/shared';

describe('outbox retry policy', () => {
  it('uses full jitter and respects the cap', () => {
    const delays = Array.from({ length: 20 }, () =>
      fullJitterDelayMs(10, 500, 1000),
    );
    expect(delays.every((delay) => delay >= 0 && delay <= 1000)).toBe(true);
  });
});
