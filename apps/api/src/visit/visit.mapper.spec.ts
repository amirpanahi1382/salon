import { toVisitListItem, toVisitResponse } from './visit.mapper';

describe('toVisitResponse', () => {
  it('maps visit facts without salonId', () => {
    const response = toVisitResponse({
      id: '11111111-1111-7111-8111-111111111111',
      customerId: '22222222-2222-7222-8222-222222222222',
      visitedAt: new Date('2026-09-01T10:00:00.000Z'),
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
    });

    expect(response).not.toHaveProperty('salonId');
    expect(response.visitedAt).toBe('2026-09-01T10:00:00.000Z');
  });
});

describe('toVisitListItem', () => {
  it('includes customer name for salon-wide lists', () => {
    const response = toVisitListItem({
      id: '11111111-1111-7111-8111-111111111111',
      customerId: '22222222-2222-7222-8222-222222222222',
      visitedAt: new Date('2026-09-01T10:00:00.000Z'),
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
      customer: { firstName: 'Sara', lastName: 'Ahmadi' },
    });
    expect(response.firstName).toBe('Sara');
    expect(response).not.toHaveProperty('salonId');
  });
});
