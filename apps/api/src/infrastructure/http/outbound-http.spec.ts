import { InfrastructureError } from '@salon/shared';
import { fetchWithTimeout } from './outbound-http';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a hung fetch to InfrastructureError', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => undefined) as Promise<Response>,
    );
    await expect(
      fetchWithTimeout('http://example.test/upstream', { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(InfrastructureError);
  });
});
