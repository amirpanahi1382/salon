import { customerListWhere } from './customer.repository';

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cursor = {
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  id: '11111111-1111-4111-8111-111111111111',
};

describe('customerListWhere', () => {
  it('scopes q-only queries to the tenant and search', () => {
    const where = customerListWhere(tenantA, 'Ahmadi');
    expect(where).toEqual({
      AND: [
        { salonId: tenantA },
        {
          OR: [
            { firstName: { contains: 'Ahmadi', mode: 'insensitive' } },
            { lastName: { contains: 'Ahmadi', mode: 'insensitive' } },
            { phoneNumber: { contains: 'Ahmadi' } },
          ],
        },
      ],
    });
  });

  it('scopes cursor-only queries to the tenant and cursor', () => {
    const where = customerListWhere(tenantA, undefined, cursor);
    expect(where).toEqual({
      AND: [
        { salonId: tenantA },
        {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        },
      ],
    });
  });

  it('AND-combines tenant, search, and cursor without replacing OR clauses', () => {
    const where = customerListWhere(tenantA, 'Ahmadi', cursor);
    expect(where.AND).toHaveLength(3);
    expect(where).toEqual({
      AND: [
        { salonId: tenantA },
        {
          OR: [
            { firstName: { contains: 'Ahmadi', mode: 'insensitive' } },
            { lastName: { contains: 'Ahmadi', mode: 'insensitive' } },
            { phoneNumber: { contains: 'Ahmadi' } },
          ],
        },
        {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        },
      ],
    });
  });

  it('never includes another tenant in the where clause', () => {
    const where = customerListWhere(tenantA, 'Ahmadi', cursor);
    expect(JSON.stringify(where)).toContain(tenantA);
    expect(JSON.stringify(where)).not.toContain(tenantB);
    expect(where.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ salonId: tenantA })]),
    );
  });
});
