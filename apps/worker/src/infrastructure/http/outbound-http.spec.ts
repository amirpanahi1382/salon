import { InfrastructureError } from '@salon/shared';
import { fetchWithTimeout } from './outbound-http';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a hung fetch to InfrastructureError', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }) as Promise<Response>,
    );
    await expect(
      fetchWithTimeout('http://example.test/upstream', { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(InfrastructureError);
  });

  it('aborts the underlying HTTP request when the timeout fires', async () => {
    const seen: AbortSignal[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (init?.signal) {
        seen.push(init.signal);
      }
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }) as Promise<Response>;
    });

    await expect(
      fetchWithTimeout('http://example.test/upstream', { timeoutMs: 15 }),
    ).rejects.toBeInstanceOf(InfrastructureError);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
  });
});
