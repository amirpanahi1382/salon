import { Inject, Injectable, Optional } from '@nestjs/common';
import { InfrastructureError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';

export const OTPY_HTTP = Symbol('OTPY_HTTP');

export type OtpSendReceipt = {
  requestId: string;
  ttlSeconds: number;
};

/**
 * Transport boundary only. Auth use cases own purpose, attempts, and account state.
 *
 * Contract from the public OTPy SDK 0.3.4 (`@o-t-p-y/sdk`):
 * `POST /v1/otp/send` `{ phone }` → `{ request_id, ttl_seconds, free }`
 * `POST /v1/otp/verify` `{ phone, code }` → `{ verified }`
 * `Authorization: Bearer <project key>`.
 * The SDK has no resend method. `verified: false` does not distinguish a wrong code
 * from an expired one.
 */
export interface OtpProvider {
  send(phone: string): Promise<OtpSendReceipt>;
  verify(phone: string, code: string): Promise<boolean>;
}

const PHONE = /^09\d{9}$/;

@Injectable()
export class OtpyProvider implements OtpProvider {
  private readonly http: typeof fetch;

  constructor(
    private readonly config: AppConfigService,
    @Optional() @Inject(OTPY_HTTP) http?: typeof fetch,
  ) {
    this.http = http ?? globalThis.fetch.bind(globalThis);
  }

  async send(phone: string): Promise<OtpSendReceipt> {
    if (!PHONE.test(phone)) {
      throw new InfrastructureError();
    }
    const result = await this.post('/v1/otp/send', { phone });
    const requestId = result.request_id;
    const ttlSeconds = result.ttl_seconds;
    if (
      typeof requestId !== 'string' ||
      requestId.length === 0 ||
      typeof ttlSeconds !== 'number' ||
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds <= 0
    ) {
      throw new InfrastructureError();
    }
    return { requestId, ttlSeconds };
  }

  async verify(phone: string, code: string): Promise<boolean> {
    if (!PHONE.test(phone) || code.length === 0) {
      throw new InfrastructureError();
    }
    const result = await this.post('/v1/otp/verify', { phone, code });
    if (typeof result.verified !== 'boolean') {
      throw new InfrastructureError();
    }
    return result.verified;
  }

  private async post(
    path: string,
    body: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const { OTPY_API_KEY: key, OTPY_BASE_URL: base, OTPY_TIMEOUT_MS: timeout } =
      this.config.values;
    if (!key) {
      throw new InfrastructureError();
    }

    const timeoutAbort = new AbortController();
    const timer = setTimeout(() => timeoutAbort.abort(), timeout);
    let response: Response;
    try {
      response = await this.http(`${base.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: timeoutAbort.signal,
      });
    } catch (error) {
      if (timeoutAbort.signal.aborted) {
        throw new InfrastructureError('Outbound request timed out');
      }
      if (error instanceof InfrastructureError) {
        throw error;
      }
      throw new InfrastructureError();
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new InfrastructureError();
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new InfrastructureError();
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InfrastructureError();
    }
    return value as Record<string, unknown>;
  }
}
