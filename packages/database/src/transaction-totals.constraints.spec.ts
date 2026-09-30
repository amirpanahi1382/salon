import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const isolatedUrl = process.env.PHASE9_ISOLATED_DATABASE_URL;
const describeIfDb = isolatedUrl && process.env.DATABASE_URL === isolatedUrl ? describe : describe.skip;

describeIfDb('Phase 9 transaction totals (disposable PostgreSQL)', () => {
  const db = createPrismaClient(isolatedUrl as string);

  afterAll(async () => { await db.$disconnect(); });

  async function fixture() {
    const salonId = randomUUID(), customerId = randomUUID(), serviceId = randomUUID();
    await db.salon.create({ data: { id: salonId, name: 'Phase 9 synthetic', updatedAt: new Date() } });
    await db.customer.create({ data: {
      id: customerId, salonId, firstName: 'Synthetic', lastName: 'Only',
      phoneNumber: `09${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`,
      updatedAt: new Date(),
    } });
    await db.service.create({ data: { id: serviceId, salonId, name: 'Synthetic', updatedAt: new Date() } });
    return { salonId, customerId, serviceId };
  }

  async function createSale(f: Awaited<ReturnType<typeof fixture>>, amount = '10.00') {
    const id = randomUUID();
    const itemId = randomUUID();
    await db.ledgerTransaction.create({ data: {
      id, salonId: f.salonId, customerId: f.customerId, occurredAt: new Date(),
      amount, updatedAt: new Date(), items: { create: [{
        id: itemId, serviceId: f.serviceId, quantity: 1, unitPrice: amount, totalAmount: amount,
      }] },
    } });
    return { id, itemId };
  }

  it('allows deferred header-then-items, exact decimals, zero, and the maximum stored value', async () => {
    const f = await fixture();
    const id = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.ledgerTransaction.create({ data: {
        id, salonId: f.salonId, customerId: f.customerId, occurredAt: new Date(),
        amount: '0.30', updatedAt: new Date(),
      } });
      for (const amount of ['0.10', '0.20']) {
        await tx.transactionItem.create({ data: {
          id: randomUUID(), salonId: f.salonId, transactionId: id,
          serviceId: f.serviceId, quantity: 1, unitPrice: amount, totalAmount: amount,
        } });
      }
    });
    expect((await db.transactionItem.aggregate({ where: { transactionId: id }, _sum: { totalAmount: true } }))._sum.totalAmount?.toString()).toBe('0.3');
    await createSale(f, '0.00');
    await createSale(f, '99999999999999999.99');
  });

  it('rejects empty or mismatched headers at commit and preserves rollback', async () => {
    const f = await fixture();
    const id = randomUUID(), auditId = randomUUID(), outboxId = randomUUID();
    let reachedCommit = false;
    await expect(db.$transaction(async (tx) => {
      await tx.ledgerTransaction.create({ data: {
        id, salonId: f.salonId, customerId: f.customerId, occurredAt: new Date(),
        amount: '2.00', updatedAt: new Date(),
      } });
      await tx.auditLog.create({ data: { id: auditId, tenantId: f.salonId, action: 'SYNTHETIC', result: 'SUCCESS' } });
      await tx.outboxEvent.create({ data: { id: outboxId, tenantId: f.salonId, eventType: 'Synthetic', payload: {} } });
      reachedCommit = true;
    })).rejects.toThrow('transaction total must equal its nonempty item total');
    expect(reachedCommit).toBe(true);
    expect(await db.ledgerTransaction.findUnique({ where: { id } })).toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: auditId } })).toBeNull();
    expect(await db.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();

    const mismatchId = randomUUID();
    await expect(db.$transaction(async (tx) => {
      await tx.ledgerTransaction.create({ data: {
        id: mismatchId, salonId: f.salonId, customerId: f.customerId,
        occurredAt: new Date(), amount: '2.00', updatedAt: new Date(),
      } });
      await tx.transactionItem.create({ data: {
        id: randomUUID(), salonId: f.salonId, transactionId: mismatchId,
        serviceId: f.serviceId, quantity: 1, unitPrice: '1.00', totalAmount: '1.00',
      } });
    })).rejects.toThrow('transaction total must equal its nonempty item total');
    expect(await db.ledgerTransaction.findUnique({ where: { id: mismatchId } })).toBeNull();
  });

  it('rolls back Visit, evidence and idempotency on money failure; corrected retry can commit once', async () => {
    const f = await fixture();
    const actorId = randomUUID(), visitId = randomUUID(), transactionId = randomUUID();
    const claimId = randomUUID(), auditId = randomUUID(), outboxId = randomUUID();
    const key = randomUUID();
    await db.user.create({ data: {
      id: actorId, salonId: f.salonId, name: 'Synthetic owner',
      email: `${actorId}@example.test`, passwordHash: 'unused', role: 'OWNER', updatedAt: new Date(),
    } });
    const write = (amount: string) => db.$transaction(async (tx) => {
      await tx.idempotencyRecord.create({ data: {
        id: claimId, tenantId: f.salonId, actorId, operation: 'synthetic-sale', key,
        requestHash: 'synthetic', resourceType: 'transaction', resourceId: transactionId,
      } });
      await tx.visit.create({ data: {
        id: visitId, salonId: f.salonId, customerId: f.customerId,
        visitedAt: new Date(), updatedAt: new Date(),
      } });
      await tx.ledgerTransaction.create({ data: {
        id: transactionId, salonId: f.salonId, customerId: f.customerId,
        visitId, occurredAt: new Date(), amount, updatedAt: new Date(),
        items: { create: [{ id: randomUUID(), serviceId: f.serviceId,
          quantity: 1, unitPrice: '1.00', totalAmount: '1.00' }] },
      } });
      await tx.auditLog.create({ data: {
        id: auditId, tenantId: f.salonId, actorId, action: 'SYNTHETIC', result: 'SUCCESS',
      } });
      await tx.outboxEvent.create({ data: {
        id: outboxId, tenantId: f.salonId, eventType: 'Synthetic', payload: {},
      } });
    });
    await expect(write('2.00')).rejects.toThrow('transaction total must equal its nonempty item total');
    expect(await db.visit.findUnique({ where: { id: visitId } })).toBeNull();
    expect(await db.ledgerTransaction.findUnique({ where: { id: transactionId } })).toBeNull();
    expect(await db.idempotencyRecord.findUnique({ where: { id: claimId } })).toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: auditId } })).toBeNull();
    expect(await db.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
    await write('1.00');
    expect(await db.visit.count({ where: { id: visitId } })).toBe(1);
    expect(await db.ledgerTransaction.count({ where: { id: transactionId } })).toBe(1);
    expect(await db.idempotencyRecord.count({ where: { tenantId: f.salonId, key } })).toBe(1);
  });

  it('protects item arithmetic, amount updates, deletion and both sides of reparenting', async () => {
    const f = await fixture();
    const a = await createSale(f), b = await createSale(f);
    await expect(db.transactionItem.update({ where: { id: a.itemId }, data: { quantity: 2 } })).rejects.toThrow();
    await expect(db.ledgerTransaction.update({ where: { id: a.id }, data: { amount: '11.00' } })).rejects.toThrow();
    await expect(db.transactionItem.delete({ where: { id: a.itemId } })).rejects.toThrow();
    await expect(db.transactionItem.update({ where: { id: a.itemId }, data: { transactionId: b.id } })).rejects.toThrow();
    expect(await db.transactionItem.count({ where: { transactionId: a.id } })).toBe(1);
    expect(await db.transactionItem.count({ where: { transactionId: b.id } })).toBe(1);
    await db.ledgerTransaction.update({ where: { id: a.id }, data: { status: 'VOIDED' } });
    await expect(db.transactionItem.delete({ where: { id: a.itemId } })).rejects.toThrow();
  });

  it('enforces direct SQL, aggregate bounds, and composite tenant links', async () => {
    const a = await fixture(), b = await fixture();
    const sale = await createSale(a);
    await expect(db.$executeRaw`
      UPDATE transaction_items SET unit_price = 11.00, total_amount = 11.00
      WHERE id = ${sale.itemId}::uuid
    `).rejects.toThrow('transaction total must equal its nonempty item total');
    await expect(db.$executeRaw`
      INSERT INTO transaction_items(id, salon_id, transaction_id, service_id, quantity, unit_price, total_amount)
      VALUES (${randomUUID()}::uuid, ${b.salonId}::uuid, ${sale.id}::uuid,
        ${b.serviceId}::uuid, 1, 1.00, 1.00)
    `).rejects.toThrow();
    const id = randomUUID();
    await expect(db.$transaction(async (tx) => {
      await tx.ledgerTransaction.create({ data: {
        id, salonId: a.salonId, customerId: a.customerId, occurredAt: new Date(),
        amount: '99999999999999999.99', updatedAt: new Date(),
      } });
      for (let i = 0; i < 2; i += 1) {
        await tx.transactionItem.create({ data: {
          id: randomUUID(), salonId: a.salonId, transactionId: id,
          serviceId: a.serviceId, quantity: 1,
          unitPrice: '99999999999999999.99', totalAmount: '99999999999999999.99',
        } });
      }
    })).rejects.toThrow('transaction total must equal its nonempty item total');
    expect(await db.ledgerTransaction.findUnique({ where: { id } })).toBeNull();
  });

  it('checks both parents after a balanced reparent within one transaction', async () => {
    const f = await fixture();
    const a = await createSale(f), b = await createSale(f);
    await db.$transaction(async (tx) => {
      await tx.transactionItem.update({ where: { id: a.itemId }, data: {
        unitPrice: '5.00', totalAmount: '5.00',
      } });
      await tx.transactionItem.create({ data: {
        id: randomUUID(), salonId: f.salonId, transactionId: a.id,
        serviceId: f.serviceId, quantity: 1, unitPrice: '5.00', totalAmount: '5.00',
      } });
    });
    await db.$transaction(async (tx) => {
      await tx.transactionItem.update({ where: { id: a.itemId }, data: { transactionId: b.id } });
      await tx.ledgerTransaction.update({ where: { id: a.id }, data: { amount: '5.00' } });
      await tx.ledgerTransaction.update({ where: { id: b.id }, data: { amount: '15.00' } });
    });
    expect((await db.ledgerTransaction.findUniqueOrThrow({ where: { id: a.id } })).amount.toString()).toBe('5');
    expect((await db.ledgerTransaction.findUniqueOrThrow({ where: { id: b.id } })).amount.toString()).toBe('15');
  });

  it('serializes competing connections so both cannot commit against one header', async () => {
    const f = await fixture();
    const sale = await createSale(f);
    const second = createPrismaClient(isolatedUrl as string);
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const write = (client: typeof db) => client.$transaction(async (tx) => {
      await tx.transactionItem.create({ data: {
        id: randomUUID(), salonId: f.salonId, transactionId: sale.id,
        serviceId: f.serviceId, quantity: 1, unitPrice: '5.00', totalAmount: '5.00',
      } });
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      await tx.ledgerTransaction.update({ where: { id: sale.id }, data: { amount: '15.00' } });
    }, { timeout: 15_000 });
    try {
      const results = await Promise.allSettled([write(db), write(second)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const row = await db.ledgerTransaction.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
      expect(row.amount.toString()).toBe('15');
      expect(row.items.reduce((sum, item) => sum.plus(item.totalAmount), row.amount.minus(row.amount)).eq(row.amount)).toBe(true);
    } finally {
      await second.$disconnect();
    }
  }, 25_000);

  it('allows a concurrent status-only void while a conflicting item write rolls back', async () => {
    const f = await fixture();
    const sale = await createSale(f);
    const second = createPrismaClient(isolatedUrl as string);
    let release!: () => void;
    let inserted!: () => void;
    const mayCommit = new Promise<void>((resolve) => { release = resolve; });
    const didInsert = new Promise<void>((resolve) => { inserted = resolve; });
    try {
      const conflicting = second.$transaction(async (tx) => {
        await tx.transactionItem.create({ data: {
          id: randomUUID(), salonId: f.salonId, transactionId: sale.id,
          serviceId: f.serviceId, quantity: 1, unitPrice: '1.00', totalAmount: '1.00',
        } });
        inserted();
        await mayCommit;
      }, { timeout: 15_000 });
      await didInsert;
      await db.ledgerTransaction.update({ where: { id: sale.id }, data: { status: 'VOIDED' } });
      release();
      await expect(conflicting).rejects.toThrow('transaction total must equal its nonempty item total');
      const row = await db.ledgerTransaction.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
      expect(row.status).toBe('VOIDED');
      expect(row.items).toHaveLength(1);
    } finally {
      release();
      await second.$disconnect();
    }
  }, 25_000);

  it('serializes a balanced item deletion racing a competing item insert', async () => {
    const f = await fixture();
    const sale = await createSale(f);
    await db.$transaction(async (tx) => {
      await tx.transactionItem.update({ where: { id: sale.itemId }, data: {
        unitPrice: '5.00', totalAmount: '5.00',
      } });
      await tx.transactionItem.create({ data: {
        id: randomUUID(), salonId: f.salonId, transactionId: sale.id,
        serviceId: f.serviceId, quantity: 1, unitPrice: '5.00', totalAmount: '5.00',
      } });
    });
    const second = createPrismaClient(isolatedUrl as string);
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const remove = db.$transaction(async (tx) => {
      await tx.transactionItem.delete({ where: { id: sale.itemId } });
      if (++arrivals === 2) release();
      await barrier;
      await tx.ledgerTransaction.update({ where: { id: sale.id }, data: { amount: '5.00' } });
    }, { timeout: 15_000 });
    const add = second.$transaction(async (tx) => {
      await tx.transactionItem.create({ data: {
        id: randomUUID(), salonId: f.salonId, transactionId: sale.id,
        serviceId: f.serviceId, quantity: 1, unitPrice: '5.00', totalAmount: '5.00',
      } });
      if (++arrivals === 2) release();
      await barrier;
      await tx.ledgerTransaction.update({ where: { id: sale.id }, data: { amount: '15.00' } });
    }, { timeout: 15_000 });
    try {
      const results = await Promise.allSettled([remove, add]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const row = await db.ledgerTransaction.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
      expect(row.items.reduce((sum, item) => sum.plus(item.totalAmount), row.amount.minus(row.amount)).eq(row.amount)).toBe(true);
    } finally {
      release();
      await second.$disconnect();
    }
  }, 25_000);

  it('does not couple independent financial writes in different salons', async () => {
    const a = await fixture(), b = await fixture();
    const second = createPrismaClient(isolatedUrl as string);
    try {
      const [first, other] = await Promise.all([
        createSale(a, '0.10'),
        second.ledgerTransaction.create({ data: {
          id: randomUUID(), salonId: b.salonId, customerId: b.customerId,
          occurredAt: new Date(), amount: '0.20', updatedAt: new Date(),
          items: { create: [{ id: randomUUID(), serviceId: b.serviceId,
            quantity: 1, unitPrice: '0.20', totalAmount: '0.20' }] },
        } }),
      ]);
      expect(first.id).toBeDefined();
      expect(other.amount.toString()).toBe('0.2');
    } finally {
      await second.$disconnect();
    }
  });

  it('supports financial writes only at READ COMMITTED while allowing nonfinancial updates at stronger isolation', async () => {
    const defaultIsolation = await db.$queryRaw<Array<{ default_transaction_isolation: string }>>`
      SHOW default_transaction_isolation
    `;
    expect(defaultIsolation).toEqual([{ default_transaction_isolation: 'read committed' }]);

    const f = await fixture();
    const sale = await createSale(f);
    const readCommittedId = randomUUID();
    await db.$transaction(async (tx) => {
      const isolation = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`
        SHOW transaction_isolation
      `;
      expect(isolation).toEqual([{ transaction_isolation: 'read committed' }]);
      await tx.ledgerTransaction.create({ data: {
        id: readCommittedId, salonId: f.salonId, customerId: f.customerId,
        occurredAt: new Date(), amount: '1.00', updatedAt: new Date(),
        items: { create: [{ id: randomUUID(), serviceId: f.serviceId,
          quantity: 1, unitPrice: '1.00', totalAmount: '1.00' }] },
      } });
    }, { isolationLevel: 'ReadCommitted' });

    for (const isolationLevel of ['RepeatableRead', 'Serializable'] as const) {
      const expected = isolationLevel === 'RepeatableRead' ? 'repeatable read' : 'serializable';
      await db.$transaction(async (tx) => {
        const isolation = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`
          SHOW transaction_isolation
        `;
        expect(isolation).toEqual([{ transaction_isolation: expected }]);
        await tx.ledgerTransaction.update({ where: { id: sale.id }, data: { status: 'VOIDED' } });
        await tx.ledgerTransaction.update({ where: { id: sale.id }, data: { updatedAt: new Date() } });
      }, { isolationLevel });

      await expect(db.$transaction(async (tx) => {
        await tx.ledgerTransaction.update({ where: { id: sale.id }, data: { amount: '10.00' } });
      }, { isolationLevel })).rejects.toThrow('financial writes require read committed isolation');

      await expect(db.$transaction(async (tx) => {
        await tx.transactionItem.update({ where: { id: sale.itemId }, data: { totalAmount: '10.00' } });
      }, { isolationLevel })).rejects.toThrow('financial writes require read committed isolation');

      const rejectedId = randomUUID();
      await expect(db.$transaction(async (tx) => {
        await tx.ledgerTransaction.create({ data: {
          id: rejectedId, salonId: f.salonId, customerId: f.customerId,
          occurredAt: new Date(), amount: '1.00', updatedAt: new Date(),
          items: { create: [{ id: randomUUID(), serviceId: f.serviceId,
            quantity: 1, unitPrice: '1.00', totalAmount: '1.00' }] },
        } });
      }, { isolationLevel })).rejects.toThrow('financial writes require read committed isolation');
      expect(await db.ledgerTransaction.findUnique({ where: { id: rejectedId } })).toBeNull();
    }
  });
});
