import { maskCustomerPhone, salonMessageStatus } from '@salon/shared';
import { toManualOutreachItem, toMessageResponse, type MessageRequestRow } from './message.mapper';

describe('toMessageResponse', () => {
  it('masks the destination and does not expose provider credentials', () => {
    const row: MessageRequestRow = {
      id: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      actionId: '33333333-3333-4333-8333-333333333333',
      opportunityType: 'REVENUE_DECLINE',
      messageText: 'سلام',
      status: 'QUEUED',
      createdByUserId: '44444444-4444-4444-8444-444444444444',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
      createdAt: new Date('2026-09-09T00:00:00.000Z'),
      updatedAt: new Date('2026-09-09T00:00:00.000Z'),
      customer: { phoneNumber: '09121111111' },
      recipientPhoneNumber: null,
      deliveries: [],
    };
    const dto = toMessageResponse(row);
    expect(dto.status).toBe('QUEUED');
    expect(dto.body).toBe('سلام');
    expect(dto.destinationHint).toBe(maskCustomerPhone('09121111111'));
    expect(dto.destinationHint).not.toContain('09121111111');
    expect(JSON.stringify(dto)).not.toContain('api-access-key');
  });

  it('maps manual outreach without action or opportunity type', () => {
    const row: MessageRequestRow = {
      id: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      actionId: null,
      opportunityType: null,
      messageText: 'سلام',
      status: 'QUEUED',
      createdByUserId: '44444444-4444-4444-8444-444444444444',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
      createdAt: new Date('2026-09-09T00:00:00.000Z'),
      updatedAt: new Date('2026-09-09T00:00:00.000Z'),
      customer: { phoneNumber: '09121111111' },
      recipientPhoneNumber: null,
      deliveries: [],
    };
    const dto = toMessageResponse(row);
    expect(dto.actionId).toBeNull();
    expect(dto.opportunityType).toBeNull();
    expect(dto.status).toBe('QUEUED');
  });

  it('maps a VIP request from recipientPhoneNumber when customer is null', () => {
    const row: MessageRequestRow = {
      id: '11111111-1111-4111-8111-111111111111',
      customerId: null,
      actionId: null,
      opportunityType: null,
      messageText: 'سلام',
      status: 'QUEUED',
      createdByUserId: '44444444-4444-4444-8444-444444444444',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
      createdAt: new Date('2026-09-09T00:00:00.000Z'),
      updatedAt: new Date('2026-09-09T00:00:00.000Z'),
      customer: null,
      recipientPhoneNumber: '09121111111',
      deliveries: [],
    };
    const dto = toMessageResponse(row);
    expect(dto.customerId).toBeNull();
    expect(dto.destinationHint).toBe(maskCustomerPhone('09121111111'));
    expect(dto.destinationHint).not.toContain('09121111111');
  });

  it('keeps DISPATCHED on the manual outreach inbox instead of collapsing it to QUEUED', () => {
    expect(salonMessageStatus('DISPATCHED')).toBe('QUEUED');
    expect(
      toManualOutreachItem({
        id: '11111111-1111-4111-8111-111111111111',
        customerId: '22222222-2222-4222-8222-222222222222',
        status: 'DISPATCHED',
        requestedAt: new Date('2026-09-11T07:00:00.000Z'),
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
        customer: { firstName: 'Sara', lastName: 'Ahmadi' },
      }),
    ).toMatchObject({
      customerId: '22222222-2222-4222-8222-222222222222',
      customerName: 'Sara Ahmadi',
      messageRequestId: '11111111-1111-4111-8111-111111111111',
      status: 'DISPATCHED',
    });
  });
});
