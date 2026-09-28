import { createHash } from 'node:crypto';
import { createPrismaClient, PrismaClient } from '@salon/database';
import { CompleteActionUseCase } from '../src/action/transition-action.use-case';
import { ActionRepository } from '../src/action/action.repository';
import { SelectMessageDeliveryModeUseCase } from '../src/messaging/admin-message.use-cases';
import { DispatchVipRequestUseCase } from '../src/vip/vip.use-cases';
import { VipRepository } from '../src/vip/vip.repository';

// Explicit opt-in. The named database is a disposable, synthetic Phase 8 fixture.
// Recreate it from the documented migrations/fixture before each run.
const isolatedUrl = process.env.PHASE8B_ISOLATED_DATABASE_URL;
const describeIsolated = isolatedUrl ? describe : describe.skip;

describeIsolated('Phase 8B real command paths against synthetic dirty history', () => {
  const url = new URL(isolatedUrl ?? 'postgresql://unused/phase8_relations');
  if (isolatedUrl && (url.hostname !== '127.0.0.1' || url.pathname !== '/phase8_relations')) {
    throw new Error('PHASE8B_ISOLATED_DATABASE_URL must target loopback phase8_relations');
  }
  const db = createPrismaClient(isolatedUrl ?? 'postgresql://unused/phase8_relations');
  const id = (name: string) => {
    const hex = createHash('md5').update(name).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const salonA = id('p8-salon-a');
  const salonB = id('p8-salon-b');
  const admin = { kind: 'platform', adminId: id('p8-admin') } as const;
  const service = { client: db } as never;

  beforeAll(async () => {
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE migration_name IN ('20260927120000_phase8_tenant_composite_relations',
        '20260927130000_phase8b_preserve_historical_parent_fks') AND finished_at IS NOT NULL`;
    expect(applied).toHaveLength(2);
    expect(await db.opportunityAction.count({ where: { id: id('p8-action-cross'), salonId: salonA } })).toBe(1);
  });

  afterAll(async () => { await db.$disconnect(); });

  it('completes a historical action without rewriting creator provenance or leaking it to another tenant', async () => {
    const actionId = id('p8-action-cross');
    const actions = new ActionRepository(service);
    const command = new CompleteActionUseCase(service, actions);
    expect(await actions.findById(salonB, actionId)).toBeNull();
    await expect(command.execute({ userId: id('p8-user-a'), tenantId: salonB, role: 'OWNER' }, actionId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    await command.execute({ userId: id('p8-user-a'), tenantId: salonA, role: 'OWNER' }, actionId);
    const row = await db.opportunityAction.findUniqueOrThrow({ where: { id: actionId } });
    expect(row).toMatchObject({ status: 'COMPLETED', createdBy: id('p8-user-b'), salonId: salonA });
    expect(await db.auditLog.count({ where: { resourceId: actionId, action: 'ACTION_COMPLETED', result: 'SUCCESS' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { tenantId: salonA, eventType: 'ActionCompleted', payload: { path: ['actionId'], equals: actionId } } })).toBe(1);
  });

  it('rejects manual delivery for an invalid historical creator atomically and safely on retry', async () => {
    const requestId = id('p8-msg-cross');
    const command = new SelectMessageDeliveryModeUseCase(service, {} as never, { values: {} } as never);
    const before = {
      deliveries: await db.messageDelivery.count({ where: { messageRequestId: requestId } }),
      audit: await db.auditLog.count({ where: { resourceId: requestId, action: 'MESSAGE_DELIVERY_MODE_SELECTED', result: 'SUCCESS' } }),
      events: await db.outboxEvent.count({ where: { tenantId: salonA, eventType: 'MessageDeliveryActivated' } }),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(command.execute(admin, requestId, 'MANUAL'))
        .rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409, message: 'Related records prevent this change' });
    }
    expect((await db.messageRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('QUEUED');
    expect(await db.messageDelivery.count({ where: { messageRequestId: requestId } })).toBe(before.deliveries);
    expect(await db.auditLog.count({ where: { resourceId: requestId, action: 'MESSAGE_DELIVERY_MODE_SELECTED', result: 'SUCCESS' } })).toBe(before.audit);
    expect(await db.outboxEvent.count({ where: { tenantId: salonA, eventType: 'MessageDeliveryActivated' } })).toBe(before.events);
  });

  it('rejects manual VIP dispatch with a bad historical creator without consuming idempotency', async () => {
    const requestId = id('p8-vip-cross');
    await db.vipRequestRecipient.createMany({ skipDuplicates: true, data: [{
      id: id('p8-vip-cross-recipient'), vipRequestId: requestId, salonId: salonA, sortOrder: 1,
      sourceContactId: id('p8-contact-1'), phoneNumber: '09120000011', messageText: 'Synthetic',
    }] });
    const command = new DispatchVipRequestUseCase(service, new VipRepository(service));
    const key = 'phase8b-vip-cross-retry';
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(command.execute(admin, requestId, 'MANUAL', key))
        .rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    }
    expect((await db.vipRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('SUBMITTED');
    expect(await db.messageRequest.count({ where: { vipRequestId: requestId } })).toBe(0);
    expect(await db.auditLog.count({ where: { resourceId: requestId, action: 'VIP_DISPATCH_SELECTED', result: 'SUCCESS' } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { tenantId: salonA, eventType: 'MessageRequested', payload: { path: ['vipRequestId'], equals: requestId } } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0);
  });

  it('records the exact Prisma outcome for an unchanged historical key assignment', async () => {
    const queries: string[] = [];
    const traced = new PrismaClient({
      datasources: { db: { url: isolatedUrl } },
      log: [{ emit: 'event', level: 'query' }],
    });
    traced.$on('query', (event) => { queries.push(event.query); });
    try {
      expect((await traced.opportunityAction.updateMany({
        where: { id: id('p8-action-cross') }, data: { createdBy: id('p8-user-b') },
      })).count).toBe(1);
    } finally { await traced.$disconnect(); }
    expect(queries.some((query) => query.includes('UPDATE') && query.includes('created_by'))).toBe(true);
    const checks = [
      db.opportunityAction.updateMany({ where: { id: id('p8-action-cross') }, data: { createdBy: id('p8-user-b') } }),
      db.messageRequest.updateMany({ where: { id: id('p8-msg-cross') }, data: { createdByUserId: id('p8-user-b') } }),
      db.messageDelivery.updateMany({ where: { id: id('p8-delivery-cross') }, data: { createdBy: id('p8-user-b') } }),
      db.vipRequest.updateMany({ where: { id: id('p8-vip-cross') }, data: { createdByUserId: id('p8-user-b') } }),
      db.vipRequestRecipient.updateMany({ where: { id: id('p8-recipient-cross') }, data: { messageRequestId: id('p8-vip-msg-b') } }),
    ];
    const outcomes: string[] = [];
    for (const update of checks) {
      try { const result = await update; outcomes.push(`OK:${result.count}`); }
      catch (error) { outcomes.push((error as { code?: string }).code ?? 'unknown'); }
    }
    expect(outcomes).toEqual(['OK:1', 'OK:1', 'OK:1', 'OK:1', 'OK:1']);
  });

  it('retains a mismatched recipient link while dispatching only the valid null recipient', async () => {
    const requestId = id('p8-vip-a');
    const command = new DispatchVipRequestUseCase(service, new VipRepository(service));
    const response = await command.execute(admin, requestId, 'MANUAL', 'phase8b-vip-valid');
    expect(response.status).toBe('MANUAL_QUEUED');
    expect(JSON.stringify(response)).not.toContain(id('p8-vip-msg-b'));
    expect((await db.vipRequestRecipient.findUniqueOrThrow({ where: { id: id('p8-recipient-cross') } })).messageRequestId)
      .toBe(id('p8-vip-msg-b'));
    const nullRecipient = await db.vipRequestRecipient.findUniqueOrThrow({ where: { id: id('p8-recipient-null') } });
    expect(nullRecipient.messageRequestId).not.toBeNull();
    expect((await db.messageRequest.findUniqueOrThrow({ where: { id: nullRecipient.messageRequestId! } })).salonId).toBe(salonA);
    await command.execute(admin, requestId, 'MANUAL', 'phase8b-vip-valid');
    expect(await db.messageRequest.count({ where: { vipRequestId: requestId } })).toBe(2);
    expect(await db.auditLog.count({ where: { resourceId: requestId, action: 'VIP_DISPATCH_SELECTED', result: 'SUCCESS' } })).toBe(1);
  });

  it('records Bale as not implemented on a bad historical VIP creator without creating a message', async () => {
    const requestId = id('p8-vip-cross');
    const command = new DispatchVipRequestUseCase(service, new VipRepository(service));
    const response = await command.execute(admin, requestId, 'BALE', 'phase8b-vip-bale');
    expect(response.status).toBe('BALE_NOT_IMPLEMENTED');
    expect(await db.messageRequest.count({ where: { vipRequestId: requestId } })).toBe(0);
  });
});
