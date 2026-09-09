import type { MessageFailureCode } from '@salon/shared';
import type { SendTextResult } from './message-sender';

type SafirErrorInfo = {
  phone_number?: unknown;
  code?: unknown;
  description?: unknown;
};

type SafirSendResponse = {
  message_id?: unknown;
  error_data?: SafirErrorInfo[] | null;
};

/** Official Safir codes from https://docs.bale.ai/safir */
const SAFIR_CODE = {
  InternalServerError: 2,
  RateLimitExceeded: 3,
  InvalidInput: 4,
  InvalidPhone: 8,
  NotBaleUser: 17,
  PaymentRequired: 20,
  MaximumContactLimitReached: 21,
} as const;

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.min(seconds * 1000, 15 * 60 * 1000);
}

export function mapSafirHttpFailure(
  status: number,
  retryAfterMs?: number,
): SendTextResult {
  if (status === 429) {
    return { outcome: 'retryable', code: 'PROVIDER_RATE_LIMITED', retryAfterMs };
  }
  if (status === 401 || status === 403) {
    return { outcome: 'failed', code: 'PROVIDER_AUTH' };
  }
  if (status >= 500 || status === 408) {
    return { outcome: 'retryable', code: 'PROVIDER_TEMPORARY', retryAfterMs };
  }
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return { outcome: 'failed', code: 'PROVIDER_INVALID_REQUEST' };
  }
  return { outcome: 'retryable', code: 'PROVIDER_UNKNOWN', retryAfterMs };
}

export function mapSafirBody(body: unknown): SendTextResult {
  if (!body || typeof body !== 'object') {
    return { outcome: 'retryable', code: 'PROVIDER_UNKNOWN' };
  }
  const payload = body as SafirSendResponse;
  const errors = Array.isArray(payload.error_data) ? payload.error_data : [];
  if (errors.length > 0) {
    return mapSafirErrorCode(errors[0]?.code);
  }
  if (typeof payload.message_id === 'string' && payload.message_id.length > 0) {
    return { outcome: 'sent', providerMessageId: payload.message_id };
  }
  return { outcome: 'retryable', code: 'PROVIDER_UNKNOWN' };
}

export function mapSafirErrorCode(code: unknown): SendTextResult {
  const numeric = typeof code === 'number' ? code : Number(code);
  switch (numeric) {
    case SAFIR_CODE.InternalServerError:
      return { outcome: 'retryable', code: 'PROVIDER_TEMPORARY' };
    case SAFIR_CODE.RateLimitExceeded:
      return { outcome: 'retryable', code: 'PROVIDER_RATE_LIMITED' };
    case SAFIR_CODE.InvalidPhone:
    case SAFIR_CODE.NotBaleUser:
      return { outcome: 'failed', code: 'PROVIDER_RECIPIENT_UNAVAILABLE' };
    case SAFIR_CODE.InvalidInput:
    case SAFIR_CODE.PaymentRequired:
    case SAFIR_CODE.MaximumContactLimitReached:
      return { outcome: 'failed', code: 'PROVIDER_INVALID_REQUEST' };
    default:
      return { outcome: 'failed', code: failureOrUnknown(numeric) };
  }
}

function failureOrUnknown(code: number): MessageFailureCode {
  if (!Number.isFinite(code)) {
    return 'PROVIDER_UNKNOWN';
  }
  return 'PROVIDER_UNKNOWN';
}
