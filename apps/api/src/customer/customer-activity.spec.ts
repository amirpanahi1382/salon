import { encodeCursor } from '../infrastructure/http/list-page';
import {
  activityKeysetOr,
  compareActivityDesc,
  mergeCustomerActivity,
  parseCustomerActivityCursor,
  type CustomerActivityRow,
} from './customer-activity';

function row(
  overrides: Partial<CustomerActivityRow> & Pick<CustomerActivityRow, 'id' | 'type'>,
): CustomerActivityRow {
  return {
    occurredAt: new Date('2026-09-10T10:00:00.000Z'),
    createdAt: new Date('2026-09-10T10:00:00.000Z'),
    status: null,
    opportunityType: null,
    ...overrides,
  };
}

describe('customer activity projection', () => {
  it('orders by occurredAt, createdAt, type, then id descending', () => {
    const later = row({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'VISIT',
      occurredAt: new Date('2026-09-10T12:00:00.000Z'),
    });
    const earlier = row({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'MANUAL_MESSAGE',
      occurredAt: new Date('2026-09-10T11:00:00.000Z'),
    });
    const sameTimeVisit = row({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'VISIT',
    });
    const sameTimeMessage = row({
      id: '44444444-4444-4444-8444-444444444444',
      type: 'MANUAL_MESSAGE',
    });
    const merged = mergeCustomerActivity(
      [[earlier, later], [sameTimeVisit], [sameTimeMessage]],
      10,
    );
    expect(merged.map((item) => item.id)).toEqual([
      later.id,
      earlier.id,
      sameTimeVisit.id,
      sameTimeMessage.id,
    ]);
  });

  it('keeps one manual-message row alongside other business events', () => {
    const request = row({
      id: '55555555-5555-4555-8555-555555555555',
      type: 'MANUAL_MESSAGE',
      status: 'DISPATCHED',
    });
    const visit = row({
      id: '77777777-7777-4777-8777-777777777777',
      type: 'VISIT',
      occurredAt: new Date('2026-09-10T09:00:00.000Z'),
    });
    const merged = mergeCustomerActivity([[visit], [request]], 10);
    expect(merged.filter((item) => item.type === 'MANUAL_MESSAGE')).toHaveLength(1);
    expect(merged.map((item) => item.type)).toEqual(['MANUAL_MESSAGE', 'VISIT']);
  });

  it('parses a four-part cursor', () => {
    const cursor = parseCustomerActivityCursor(
      encodeCursor([
        '2026-09-10T10:00:00.000Z',
        '2026-09-10T10:00:00.000Z',
        'MANUAL_MESSAGE',
        '55555555-5555-4555-8555-555555555555',
      ]),
    );
    expect(cursor?.type).toBe('MANUAL_MESSAGE');
    expect(cursor?.id).toBe('55555555-5555-4555-8555-555555555555');
  });

  it('builds a keyset that excludes already-seen higher types at the same instant', () => {
    const cursor = {
      occurredAt: new Date('2026-09-10T10:00:00.000Z'),
      createdAt: new Date('2026-09-10T10:00:00.000Z'),
      type: 'TRANSACTION' as const,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const visitWhere = activityKeysetOr('visitedAt', 'VISIT', cursor) as { OR: unknown[] };
    expect(visitWhere.OR).toHaveLength(2);
    const messageWhere = activityKeysetOr('requestedAt', 'MANUAL_MESSAGE', cursor) as {
      OR: unknown[];
    };
    expect(messageWhere.OR).toHaveLength(3);
  });

  it('compares equal ids as the same event', () => {
    const a = row({ id: '66666666-6666-4666-8666-666666666666', type: 'VISIT' });
    expect(compareActivityDesc(a, a)).toBe(0);
  });
});
