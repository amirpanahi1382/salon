import { toCustomerIntelligenceResponse } from './intelligence.mapper';

describe('toCustomerIntelligenceResponse', () => {
  it('does not include phone numbers on intelligence DTOs', () => {
    const response = toCustomerIntelligenceResponse(
      { id: 'cust-1', firstName: 'Sara', lastName: 'Ahmadi' },
      {
        visitCount: 2,
        firstVisitAt: new Date('2026-06-01T00:00:00.000Z'),
        lastVisitAt: new Date('2026-07-06T00:00:00.000Z'),
        daysSinceLastVisit: 52,
        averageReturnIntervalDays: 35,
        expectedReturnIntervalDays: 35,
      },
      {
        status: 'AT_RISK',
        explanation: 'Usually returns every 35 days. Last visit was 52 days ago, which is past the expected return window.',
        signals: ['OVERDUE'],
        opportunities: [
          {
            type: 'REACTIVATION',
            reason: 'Usually returns every 35 days. Last visit was 52 days ago, which is past the expected return window.',
            recommendedAction: 'Send a reactivation message.',
          },
        ],
      },
    );

    expect(response).not.toHaveProperty('phoneNumber');
    expect(JSON.stringify(response)).not.toMatch(/phone/i);
    expect(response.opportunities[0]?.recommendedAction).toBe('Send a reactivation message.');
  });
});
