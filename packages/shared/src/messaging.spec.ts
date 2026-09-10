import {
  maskCustomerPhone,
  MESSAGE_BODY_MAX_LENGTH,
  messageBusinessDateKey,
  normalizeMessageBody,
  salonMessageStatus,
  toSafirPhoneNumber,
} from './messaging';

describe('Safir phone mapping', () => {
  it('maps 09 national numbers to 98… without separators', () => {
    expect(toSafirPhoneNumber('09123456789')).toBe('989123456789');
  });

  it('rejects stored phones that are not the salon canonical form', () => {
    expect(toSafirPhoneNumber('989123456789')).toBeNull();
    expect(toSafirPhoneNumber('+989123456789')).toBeNull();
    expect(toSafirPhoneNumber('0912-345-6789')).toBeNull();
  });
});

describe('message body', () => {
  it('trims and rejects empty or oversized text', () => {
    expect(normalizeMessageBody('  سلام  ')).toBe('سلام');
    expect(normalizeMessageBody('   ')).toBeNull();
    expect(normalizeMessageBody('a'.repeat(MESSAGE_BODY_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeMessageBody('ok\0no')).toBeNull();
  });
});

describe('phone masking', () => {
  it('keeps a recognizable prefix without exposing the full number', () => {
    expect(maskCustomerPhone('09121111111')).toBe('0912****111');
  });
});

describe('message business day', () => {
  it('uses Asia/Tehran calendar dates without changing the UTC instant', () => {
    const endOfTehranDay = new Date('2026-09-10T20:29:00.000Z');
    const startOfNextTehranDay = new Date('2026-09-10T20:30:00.000Z');
    expect(messageBusinessDateKey(endOfTehranDay)).toBe('2026-09-10');
    expect(messageBusinessDateKey(startOfNextTehranDay)).toBe('2026-09-11');
  });

  it('maps request status for salon clients', () => {
    expect(salonMessageStatus('QUEUED')).toBe('QUEUED');
    expect(salonMessageStatus('DISPATCHED')).toBe('QUEUED');
    expect(salonMessageStatus('SENT')).toBe('SENT');
    expect(salonMessageStatus('FAILED')).toBe('FAILED');
  });
});
