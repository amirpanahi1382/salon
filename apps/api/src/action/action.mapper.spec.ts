import { toActionResponse } from './action.mapper';

describe('toActionResponse', () => {
  it('maps UTC timestamps and omits salon identity', () => {
    const response = toActionResponse({
      id: 'a1',
      customerId: 'c1',
      opportunityType: 'REACTIVATION',
      status: 'OPEN',
      createdBy: 'u1',
      createdAt: new Date('2026-09-09T10:00:00.000Z'),
      updatedAt: new Date('2026-09-09T10:00:00.000Z'),
      completedAt: null,
      dismissedAt: null,
      customer: { firstName: 'Sara', lastName: 'Ahmadi' },
    });
    expect(response).toEqual({
      id: 'a1',
      customerId: 'c1',
      firstName: 'Sara',
      lastName: 'Ahmadi',
      opportunityType: 'REACTIVATION',
      status: 'OPEN',
      createdBy: 'u1',
      createdAt: '2026-09-09T10:00:00.000Z',
      updatedAt: '2026-09-09T10:00:00.000Z',
      completedAt: null,
      dismissedAt: null,
    });
    expect(response).not.toHaveProperty('salonId');
  });
});
