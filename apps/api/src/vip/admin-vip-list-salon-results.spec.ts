import { AdminVipOutreachRepository } from './admin-vip-outreach.repository';

describe('admin VIP list salon results read model', () => {
  it('loads one bounded aggregate page for the requested list', async () => {
    const listId = '11111111-1111-4111-8111-111111111111';
    const salonId = '22222222-2222-4222-8222-222222222222';
    const queryRaw = jest.fn().mockResolvedValue([
      {
        salonId,
        salonName: 'سالن نمونه',
        requestCount: 3,
        recipientCount: 100,
        pendingMessageCount: 18,
        sentMessageCount: 80,
        failedMessageCount: 1,
        cancelledMessageCount: 0,
        globallyStoppedMessageCount: 1,
        latestActivityAt: new Date('2026-10-28T08:30:00.000Z'),
      },
    ]);
    const repository = new AdminVipOutreachRepository({
      client: { $queryRaw: queryRaw },
    } as never);

    const page = await repository.listListSalonResults(listId);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const call = queryRaw.mock.calls[0]!;
    const strings = call[0] as string[];
    expect(strings.join(' ')).toContain('WITH list_requests AS MATERIALIZED');
    expect(strings.join(' ')).toContain('WHERE r.list_id =');
    expect(call.slice(1)).toContain(listId);
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          salonId,
          requestCount: 3,
          recipientCount: 100,
          sentMessageCount: 80,
          globallyStoppedMessageCount: 1,
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });
});
