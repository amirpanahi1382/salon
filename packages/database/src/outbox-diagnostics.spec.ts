import { markOutboxDeadLetter, markOutboxRetry } from './outbox';

describe('outbox durable diagnostics', () => {
  const synthetic = 'PHONE_FAKE_09120000000 BODY_FAKE_HELLO MONEY_FAKE_1234.56 TOKEN_FAKE_XYZ DBURL_FAKE_postgres OBJECT_FAKE_vip/key';

  it.each(['retry', 'dead_letter'] as const)(
    'persists only allowlisted codes for %s while retaining the ownership fence',
    async (operation) => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const db = { outboxEvent: { updateMany } } as never;
      const id = '11111111-1111-4111-8111-111111111111';
      if (operation === 'retry') {
        expect(await markOutboxRetry(db, id, 7n, synthetic, 5000)).toBe(true);
      } else {
        expect(await markOutboxDeadLetter(db, id, 7n, synthetic)).toBe(true);
      }
      const serialized = JSON.stringify(updateMany.mock.calls, (_, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value);
      expect(serialized).not.toContain(synthetic);
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id, status: 'PROCESSING', claimGeneration: 7n },
        data: expect.objectContaining({ lastError: 'CONSUMER_FAILED' }),
      }));
    },
  );

  it('retains known provider and unknown-event codes', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = { outboxEvent: { updateMany } } as never;
    await markOutboxRetry(db, 'event-1', 2n, 'PROVIDER_RATE_LIMITED', 5000);
    await markOutboxDeadLetter(db, 'event-2', 3n, 'UNKNOWN_EVENT_TYPE');
    expect(updateMany.mock.calls[0]?.[0]?.data.lastError).toBe('PROVIDER_RATE_LIMITED');
    expect(updateMany.mock.calls[1]?.[0]?.data.lastError).toBe('UNKNOWN_EVENT_TYPE');
  });

  it('rejects stale ownership without changing the failure reason', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const db = { outboxEvent: { updateMany } } as never;
    expect(await markOutboxRetry(db, 'event-3', 8n, synthetic, 1000)).toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'event-3', status: 'PROCESSING', claimGeneration: 8n },
      data: expect.objectContaining({ lastError: 'CONSUMER_FAILED' }),
    }));
  });
});
