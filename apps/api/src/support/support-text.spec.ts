import { normalizeSupportText, SUPPORT_TEXT_MAX_LENGTH } from './support.constants';
import { supportMessageAuditMetadata } from './support-audit';
import { adminSupportMessageHash, salonSupportMessageHash } from './support-idempotency';
import { decodeSupportCursor, encodeSupportCursor } from './support-cursor';

describe('support text', () => {
  it('trims and rejects empty, oversized, and control characters', () => {
    expect(normalizeSupportText('  سلام  ')).toBe('سلام');
    expect(normalizeSupportText('   ')).toBeNull();
    expect(normalizeSupportText('a'.repeat(SUPPORT_TEXT_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeSupportText('خط\nبعد')).toBe('خط\nبعد');
    expect(normalizeSupportText('bad\u0000text')).toBeNull();
  });
});

describe('support audit metadata', () => {
  it('keeps only conversation, message, and author kind', () => {
    const bodyMarker = 'SUPPORT_BODY_MARKER';
    const metadata = supportMessageAuditMetadata({
      conversationId: '11111111-1111-4111-8111-111111111111',
      messageId: '22222222-2222-4222-8222-222222222222',
      authorKind: 'SALON_USER',
    });
    expect(Object.keys(metadata).sort()).toEqual(['authorKind', 'conversationId', 'messageId']);
    expect(JSON.stringify(metadata)).not.toContain(bodyMarker);
  });
});

describe('support idempotency hash', () => {
  it('does not store the message text', () => {
    const bodyMarker = 'SUPPORT_BODY_MARKER';
    const salon = salonSupportMessageHash(bodyMarker);
    const admin = adminSupportMessageHash('33333333-3333-4333-8333-333333333333', bodyMarker);
    expect(salon).toMatch(/^[a-f0-9]{64}$/);
    expect(admin).toMatch(/^[a-f0-9]{64}$/);
    expect(salon).not.toContain(bodyMarker);
    expect(admin).not.toContain(bodyMarker);
    expect(salon).not.toBe(admin);
  });
});

describe('support cursor', () => {
  it('round-trips an instant and id', () => {
    const at = new Date('2026-10-10T12:00:00.123Z');
    const id = '44444444-4444-4444-8444-444444444444';
    const decoded = decodeSupportCursor(encodeSupportCursor(at, id));
    expect(decoded?.at.toISOString()).toBe(at.toISOString());
    expect(decoded?.id).toBe(id);
  });
});
