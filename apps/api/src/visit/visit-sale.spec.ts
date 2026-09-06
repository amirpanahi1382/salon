import { Prisma } from '@salon/database';
import { saleFacts } from './visit-sale';

describe('saleFacts', () => {
  it('returns nulls when the visit has no transaction', () => {
    expect(saleFacts([])).toEqual({ serviceName: null, amountReceived: null });
  });

  it('uses COMPLETED amount and service', () => {
    expect(
      saleFacts([
        {
          id: 't1',
          amount: new Prisma.Decimal('8000000.00'),
          status: 'COMPLETED',
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          items: [{ service: { name: 'Hair Service' } }],
        },
      ]),
    ).toEqual({ serviceName: 'Hair Service', amountReceived: '8000000.00' });
  });

  it('keeps service from a VOIDED sale but omits amount as received revenue', () => {
    expect(
      saleFacts([
        {
          id: 't2',
          amount: new Prisma.Decimal('100.00'),
          status: 'VOIDED',
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          items: [{ service: { name: 'Nail Service' } }],
        },
      ]),
    ).toEqual({ serviceName: 'Nail Service', amountReceived: null });
  });

  it('prefers COMPLETED over VOIDED when both exist', () => {
    expect(
      saleFacts([
        {
          id: 'voided',
          amount: new Prisma.Decimal('1.00'),
          status: 'VOIDED',
          createdAt: new Date('2026-08-01T09:00:00.000Z'),
          items: [{ service: { name: 'Old' } }],
        },
        {
          id: 'ok',
          amount: new Prisma.Decimal('50.00'),
          status: 'COMPLETED',
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          items: [{ service: { name: 'Hair Service' } }],
        },
      ]),
    ).toEqual({ serviceName: 'Hair Service', amountReceived: '50.00' });
  });
});
