import { Test } from '@nestjs/testing';
import { InfrastructureError, LOG_REDACT_PATHS } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { OtpyProvider } from './otp-provider';

const phone = ['09', '2'.repeat(9)].join('');
const code = '4'.repeat(6);
const projectKey = ['configured', 'project'].join('-');
const bodyMarker = ['upstream', 'payload'].join('-');

function config(key: string | undefined, timeoutMs = 1_000): AppConfigService {
  return {
    values: {
      OTPY_API_KEY: key,
      OTPY_BASE_URL: 'https://otp.example.test/',
      OTPY_TIMEOUT_MS: timeoutMs,
    },
  } as unknown as AppConfigService;
}

function jsonResponse(status: number, value: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
}

function provider(
  http: typeof fetch,
  options: { key?: string; timeoutMs?: number } = {},
): OtpyProvider {
  const key = 'key' in options ? options.key : projectKey;
  return new OtpyProvider(config(key, options.timeoutMs ?? 1_000), http);
}

describe('OtpyProvider', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterEach(() => {
    consoleError.mockClear();
    consoleLog.mockClear();
    consoleWarn.mockClear();
  });

  afterAll(() => {
    consoleError.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  it('sends with the documented path, bearer header, and receipt fields', async () => {
    const http = jest.fn(async () =>
      jsonResponse(200, { request_id: 'receipt-a', ttl_seconds: 120, free: true }),
    );
    const receipt = await provider(http).send(phone);
    expect(receipt).toEqual({ requestId: 'receipt-a', ttlSeconds: 120 });
    expect(http).toHaveBeenCalledTimes(1);
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://otp.example.test/v1/otp/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: `Bearer ${projectKey}`,
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({ phone });
  });

  it('returns false when the provider reports an unverified code', async () => {
    const http = jest.fn(async () => jsonResponse(200, { verified: false }));
    await expect(provider(http).verify(phone, code)).resolves.toBe(false);
    expect(JSON.parse(String((http.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      phone,
      code,
    });
  });

  it('returns true when the provider reports a verified code', async () => {
    const http = jest.fn(async () => jsonResponse(200, { verified: true }));
    await expect(provider(http).verify(phone, code)).resolves.toBe(true);
  });

  it('hides a non-success provider response', async () => {
    const http = jest.fn(async () =>
      jsonResponse(429, { error: 'rate_limited', detail: bodyMarker, phone, code }),
    );
    await expect(provider(http).send(phone)).rejects.toEqual(expect.any(InfrastructureError));
    await expect(provider(http).send(phone)).rejects.toThrow(InfrastructureError);
    try {
      await provider(http).send(phone);
    } catch (error) {
      expect(error).toBeInstanceOf(InfrastructureError);
      expect(serialized(error)).not.toContain(bodyMarker);
      expect(secretLeak(serialized(error))).toBe(false);
    }
  });

  it('aborts and reports a timeout without the request contents', async () => {
    const http: typeof fetch = jest.fn(
      (_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const pending = provider(http, { timeoutMs: 20 }).verify(phone, code);
    await expect(pending).rejects.toThrow('Outbound request timed out');
    const init = (http as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
    try {
      await pending;
    } catch (error) {
      expect(secretLeak(serialized(error))).toBe(false);
    }
  });

  it('does not call the provider when the project key is missing', async () => {
    const http = jest.fn();
    await expect(provider(http, { key: undefined }).send(phone)).rejects.toBeInstanceOf(
      InfrastructureError,
    );
    await expect(provider(http, { key: undefined }).verify(phone, code)).rejects.toBeInstanceOf(
      InfrastructureError,
    );
    expect(http).not.toHaveBeenCalled();
  });

  it('does not call the provider for a phone or code outside the documented shape', async () => {
    const http = jest.fn();
    await expect(provider(http).send(`08${'2'.repeat(9)}`)).rejects.toBeInstanceOf(
      InfrastructureError,
    );
    await expect(provider(http).verify(phone, '')).rejects.toBeInstanceOf(InfrastructureError);
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects a success body that is missing the documented fields', async () => {
    const http = jest.fn(async () => jsonResponse(200, { free: true, detail: bodyMarker }));
    await expect(provider(http).send(phone)).rejects.toBeInstanceOf(InfrastructureError);
    const verifyHttp = jest.fn(async () => jsonResponse(200, { detail: bodyMarker }));
    await expect(provider(verifyHttp).verify(phone, code)).rejects.toBeInstanceOf(
      InfrastructureError,
    );
  });

  it('rejects a non-JSON success body', async () => {
    const http = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => {
            throw new SyntaxError(bodyMarker);
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    try {
      await provider(http).send(phone);
      throw new Error('expected infrastructure failure');
    } catch (error) {
      expect(error).toBeInstanceOf(InfrastructureError);
      expect(serialized(error)).not.toContain(bodyMarker);
    }
  });

  it('does not log the key, phone, code, or provider body', async () => {
    const http = jest.fn(async () => jsonResponse(500, { detail: bodyMarker, phone, code }));
    await expect(provider(http).verify(phone, code)).rejects.toBeInstanceOf(InfrastructureError);
    const logged = [consoleError, consoleLog, consoleWarn].flatMap((spy) =>
      spy.mock.calls.map((call) => call.map(String).join(' ')),
    );
    expect(logged.join('\n')).not.toContain(bodyMarker);
    expect(secretLeak(logged.join('\n'))).toBe(false);
  });

  it('redacts the project key and phone fields if a log record contains them', () => {
    expect(LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining(['OTPY_API_KEY', '*.OTPY_API_KEY', 'phone', '*.phone']),
    );
  });

  it('can be constructed by Nest without an HTTP client token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [OtpyProvider, { provide: AppConfigService, useValue: config(projectKey) }],
    }).compile();
    expect(moduleRef.get(OtpyProvider)).toBeInstanceOf(OtpyProvider);
    await moduleRef.close();
  });
});

function secretLeak(value: string): boolean {
  return value.includes(projectKey) || value.includes(phone) || value.includes(code);
}

function serialized(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return `${error.name} ${error.message} ${error.stack ?? ''}`;
}
