import { maskCustomerPhone } from '@salon/shared';
import { toMessageResponse, type MessageRow } from './message.mapper';

describe('toMessageResponse', () => {
  it('masks the destination and does not expose provider credentials', () => {
    const row: MessageRow = {
      id: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      actionId: '33333333-3333-4333-8333-333333333333',
      provider: 'BALE_SAFIR',
      channel: 'TEXT',
      status: 'PENDING',
      body: 'سلام',
      failureCode: null,
      createdBy: '44444444-4444-4444-8444-444444444444',
      createdAt: new Date('2026-09-09T00:00:00.000Z'),
      updatedAt: new Date('2026-09-09T00:00:00.000Z'),
      submittedAt: null,
      failedAt: null,
      action: { opportunityType: 'REVENUE_DECLINE' },
      customer: { phoneNumber: '09121111111' },
    };
    const dto = toMessageResponse(row);
    expect(dto.destinationHint).toBe(maskCustomerPhone('09121111111'));
    expect(dto.destinationHint).not.toContain('09121111111');
    expect(JSON.stringify(dto)).not.toContain('api-access-key');
  });
});
