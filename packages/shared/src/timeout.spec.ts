import { TimeoutError, withTimeout } from './timeout';

describe('withTimeout', () => {
  it('resolves when the operation finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('rejects with TimeoutError when the operation hangs', async () => {
    const hung = new Promise<void>(() => undefined);
    await expect(withTimeout(hung, 20, 'http timed out')).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });
});
