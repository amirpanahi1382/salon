import { Prisma } from '@salon/database';
import { toVisitHistoryItem, toVisitListItem, toVisitResponse } from './visit.mapper';

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
      transactions: [],
    });
    expect(response.firstName).toBe('Sara');
    expect(response.serviceName).toBeNull();
    expect(response.amountReceived).toBeNull();
    expect(response).not.toHaveProperty('salonId');
  });

  it('maps service name and COMPLETED amount from the visit sale', () => {
    const response = toVisitListItem({
      id: '11111111-1111-7111-8111-111111111111',
      customerId: '22222222-2222-7222-8222-222222222222',
      visitedAt: new Date('2026-09-01T10:00:00.000Z'),
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
      customer: { firstName: 'Maryam', lastName: 'Ahmadi' },
      transactions: [
        {
          id: 't1',
          amount: new Prisma.Decimal('8000000.00'),
          status: 'COMPLETED',
          createdAt: new Date('2026-09-01T10:01:00.000Z'),
          items: [{ service: { name: 'Hair Service' } }],
        },
      ],
    });
    expect(response.serviceName).toBe('Hair Service');
    expect(response.amountReceived).toBe('8000000.00');
  });
});

describe('toVisitHistoryItem', () => {
  it('keeps the current service name even when the catalog status is unused', () => {
    const response = toVisitHistoryItem({
      id: '11111111-1111-7111-8111-111111111111',
      customerId: '22222222-2222-7222-8222-222222222222',
      visitedAt: new Date('2026-09-01T10:00:00.000Z'),
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
      transactions: [
        {
          id: 't1',
          amount: new Prisma.Decimal('8000000.00'),
          status: 'COMPLETED',
          createdAt: new Date('2026-09-01T10:01:00.000Z'),
          items: [{ service: { name: 'Hair Botox Premium' } }],
        },
      ],
    });
    expect(response.serviceName).toBe('Hair Botox Premium');
    expect(response.amountReceived).toBe('8000000.00');
  });
});
