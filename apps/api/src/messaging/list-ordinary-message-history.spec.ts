import { toDisplayStatus } from './list-ordinary-message-history.use-case';

describe('ordinary message history display status', () => {
  it('distinguishes queued, processing, sent, failed, and cancelled', () => {
    expect(toDisplayStatus('QUEUED', null)).toBe('QUEUED');
    expect(toDisplayStatus('DISPATCHED', 'PENDING')).toBe('PROCESSING');
    expect(toDisplayStatus('DISPATCHED', 'PROCESSING')).toBe('PROCESSING');
    expect(toDisplayStatus('SENT', 'SENT')).toBe('SENT');
    expect(toDisplayStatus('QUEUED', 'SENT')).toBe('SENT');
    expect(toDisplayStatus('FAILED', 'FAILED')).toBe('FAILED');
    expect(toDisplayStatus('CANCELLED', null)).toBe('CANCELLED');
    expect(toDisplayStatus('CANCELLED', 'SENT')).toBe('CANCELLED');
  });

  it('treats SENT as recorded send mapping, not a separate delivery confirmation', () => {
    expect(toDisplayStatus('SENT', 'SENT')).toBe('SENT');
  });
});
