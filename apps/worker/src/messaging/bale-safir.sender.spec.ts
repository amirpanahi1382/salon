import { InfrastructureError } from '@salon/shared';
import type { AppConfig } from '@salon/config';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { BaleSafirMessageSender } from './bale-safir.sender';

describe('BaleSafirMessageSender', () => {
  const config = {
    values: {
      BALE_SAFIR_API_ACCESS_KEY: 'test-key',
      BALE_SAFIR_BOT_ID: 123456789,
      BALE_SAFIR_BASE_URL: 'https://safir.bale.ai/api/v3',
      BALE_SAFIR_TIMEOUT_MS: 1000,
    } as AppConfig,
  } as AppConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the documented Safir JSON contract and maps success', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid-1', error_data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const sender = new BaleSafirMessageSender(config);
    const result = await sender.sendText({
      requestId: 'delivery-id',
      phoneNumber: '09123456789',
      text: 'سلام',
    });
    expect(result).toEqual({ outcome: 'sent', providerMessageId: 'mid-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://safir.bale.ai/api/v3/send_message');
    expect((init.headers as Record<string, string>)['api-access-key']).toBe('test-key');
    expect(JSON.parse(String(init.body))).toEqual({
      request_id: 'delivery-id',
      bot_id: 123456789,
      phone_number: '989123456789',
      message_data: { message: { text: 'سلام' } },
    });
  });

  it('maps a timeout to a retryable temporary failure', async () => {
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
    const sender = new BaleSafirMessageSender({
      values: { ...config.values, BALE_SAFIR_TIMEOUT_MS: 20 },
    } as AppConfigService);
    await expect(
      sender.sendText({
        requestId: 'delivery-id',
        phoneNumber: '09123456789',
        text: 'سلام',
      }),
    ).resolves.toEqual({ outcome: 'retryable', code: 'PROVIDER_TEMPORARY' });
    expect(InfrastructureError).toBeDefined();
  });
});
