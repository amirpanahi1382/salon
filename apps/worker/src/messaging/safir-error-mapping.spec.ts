import { mapSafirBody, mapSafirErrorCode, mapSafirHttpFailure, parseRetryAfterMs } from './safir-error-mapping';

describe('Safir error mapping', () => {
  it('maps official body error codes', () => {
    expect(mapSafirErrorCode(2)).toEqual({ outcome: 'retryable', code: 'PROVIDER_TEMPORARY' });
    expect(mapSafirErrorCode(3)).toEqual({ outcome: 'retryable', code: 'PROVIDER_RATE_LIMITED' });
    expect(mapSafirErrorCode(8)).toEqual({
      outcome: 'failed',
      code: 'PROVIDER_RECIPIENT_UNAVAILABLE',
    });
    expect(mapSafirErrorCode(17)).toEqual({
      outcome: 'failed',
      code: 'PROVIDER_RECIPIENT_UNAVAILABLE',
    });
    expect(mapSafirErrorCode(4)).toEqual({ outcome: 'failed', code: 'PROVIDER_INVALID_REQUEST' });
  });

  it('treats HTTP 429 as retryable and 401 as auth failure', () => {
    expect(mapSafirHttpFailure(429, 5000)).toEqual({
      outcome: 'retryable',
      code: 'PROVIDER_RATE_LIMITED',
      retryAfterMs: 5000,
    });
    expect(mapSafirHttpFailure(401)).toEqual({ outcome: 'failed', code: 'PROVIDER_AUTH' });
    expect(mapSafirHttpFailure(503)).toEqual({ outcome: 'retryable', code: 'PROVIDER_TEMPORARY' });
  });

  it('maps a successful Safir body to sent', () => {
    expect(
      mapSafirBody({ message_id: '523e6875-7c41-491b-8460-04b33039d7fc', error_data: null }),
    ).toEqual({
      outcome: 'sent',
      providerMessageId: '523e6875-7c41-491b-8460-04b33039d7fc',
    });
  });

  it('treats malformed success bodies as retryable unknown outcome', () => {
    expect(mapSafirBody({})).toEqual({ outcome: 'retryable', code: 'PROVIDER_UNKNOWN' });
    expect(mapSafirBody(null)).toEqual({ outcome: 'retryable', code: 'PROVIDER_UNKNOWN' });
  });

  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs('12')).toBe(12_000);
    expect(parseRetryAfterMs('nope')).toBeUndefined();
  });
});
