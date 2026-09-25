import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('message request constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedSalon() {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    const actionId = randomUUID();
    await prisma.salon.create({
      data: { id: salonId, name: 'Msg Salon', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `msg-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        salonId,
        firstName: 'Sara',
        lastName: 'A',
        phoneNumber: `09${Math.floor(Math.random() * 1_000_000_000)
          .toString()
          .padStart(9, '0')}`,
        updatedAt: new Date(),
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: actionId,
        salonId,
        customerId,
        opportunityType: 'REVENUE_DECLINE',
        status: 'OPEN',
        createdBy: userId,
        updatedAt: new Date(),
      },
    });
    return { salonId, userId, customerId, actionId };
  }

  async function seedVipRequest(seeded: Awaited<ReturnType<typeof seedSalon>>) {
    const adminId = randomUUID();
    await prisma.platformAdmin.create({
      data: {
        id: adminId,
        email: `msg-vip-admin-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: new Date(),
      },
    });
    const listId = randomUUID();
    const requestId = randomUUID();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: 'msg-vip-list',
        status: 'IN_USE',
        contactCount: 30,
        createdByAdminId: adminId,
        reservedBySalonId: seeded.salonId,
        reservedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.vipRequest.create({
      data: {
        id: requestId,
        salonId: seeded.salonId,
        listId,
        createdByUserId: seeded.userId,
        requestedCount: 30,
        geographicRange: 'ونک',
        status: 'SUBMITTED',
        reservedUntil: new Date(),
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { requestId };
  }

  function requestData(
    seeded: Awaited<ReturnType<typeof seedSalon>>,
    overrides: Record<string, unknown>,
  ) {
    return {
      id: randomUUID(),
      salonId: seeded.salonId,
      customerId: seeded.customerId,
      actionId: seeded.actionId,
      createdByUserId: seeded.userId,
      opportunityType: 'REVENUE_DECLINE' as const,
      recipientPhoneNumber: '09121111111',
      messageText: 'سلام',
      messageBusinessDate: new Date('2026-09-10T00:00:00.000Z'),
      countsTowardDailyLimit: true,
      status: 'QUEUED' as const,
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('rejects a request whose customer belongs to another salon', async () => {
    const a = await seedSalon();
    const b = await seedSalon();
    await expect(
      prisma.messageRequest.create({
        data: requestData(a, { customerId: b.customerId }),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a second request for the same customer on the same business day', async () => {
    const seeded = await seedSalon();
    const day = new Date('2026-09-10T00:00:00.000Z');
    await prisma.messageRequest.create({
      data: requestData(seeded, { messageText: 'اول', messageBusinessDate: day }),
    });
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          opportunityType: 'REACTIVATION',
          messageText: 'دوم',
          messageBusinessDate: day,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows historical backfill rows to share a Tehran day and still accept one new request', async () => {
    const seeded = await seedSalon();
    const day = new Date('2026-09-10T00:00:00.000Z');
    await prisma.messageRequest.create({
      data: requestData(seeded, {
        messageText: 'legacy-1',
        messageBusinessDate: day,
        countsTowardDailyLimit: false,
      }),
    });
    await prisma.messageRequest.create({
      data: requestData(seeded, {
        messageText: 'legacy-2',
        messageBusinessDate: day,
        countsTowardDailyLimit: false,
      }),
    });
    await prisma.messageRequest.create({
      data: requestData(seeded, {
        messageText: 'new-1',
        messageBusinessDate: day,
        countsTowardDailyLimit: true,
      }),
    });
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          messageText: 'new-2',
          messageBusinessDate: day,
          countsTowardDailyLimit: true,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same customer on a different business day', async () => {
    const seeded = await seedSalon();
    await prisma.messageRequest.create({
      data: requestData(seeded, { messageText: 'روز اول' }),
    });
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          messageText: 'روز دوم',
          messageBusinessDate: new Date('2026-09-11T00:00:00.000Z'),
        }),
      }),
    ).resolves.toMatchObject({ messageText: 'روز دوم' });
  });

  it('rejects concurrent same-day inserts for one customer', async () => {
    const seeded = await seedSalon();
    const day = new Date('2026-09-12T00:00:00.000Z');
    const write = () =>
      prisma.messageRequest.create({
        data: requestData(seeded, {
          messageText: `همزمان ${randomUUID()}`,
          messageBusinessDate: day,
        }),
      });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => write()));
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((result) => result.status === 'rejected' && result.reason.code === 'P2002')).toBe(
      true,
    );
  });

  it('rolls back request and outbox together', async () => {
    const seeded = await seedSalon();
    const requestId = randomUUID();
    const outboxId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.messageRequest.create({
          data: requestData(seeded, {
            id: requestId,
            messageBusinessDate: new Date('2026-09-13T00:00:00.000Z'),
          }),
        });
        await tx.outboxEvent.create({
          data: {
            id: outboxId,
            tenantId: seeded.salonId,
            eventType: 'MessageRequested',
            payload: { messageRequestId: requestId },
          },
        });
        throw new Error('forced-failure');
      }),
    ).rejects.toThrow('forced-failure');

    expect(await prisma.messageRequest.findUnique({ where: { id: requestId } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
  });

  it('allows a request without an OpportunityAction for manual outreach', async () => {
    const seeded = await seedSalon();
    const created = await prisma.messageRequest.create({
      data: requestData(seeded, { actionId: null, opportunityType: null, messageText: 'دستی' }),
    });
    expect(created.actionId).toBeNull();
    expect(created.opportunityType).toBeNull();
  });

  it.each([null, '', '9121111111', '0912 1111111', '0912111111a'])(
    'rejects a new request with noncanonical destination %s',
    async (recipientPhoneNumber) => {
      const seeded = await seedSalon();
      await expect(prisma.messageRequest.create({
        data: requestData(seeded, { recipientPhoneNumber }),
      })).rejects.toThrow(/Message destination snapshot is required/);
      expect(await prisma.messageRequest.count({ where: { salonId: seeded.salonId } })).toBe(0);
    },
  );

  it('keeps a valid request destination immutable while allowing other updates', async () => {
    const seeded = await seedSalon();
    const phone = (await prisma.customer.findUniqueOrThrow({ where: { id: seeded.customerId } })).phoneNumber;
    const created = await prisma.messageRequest.create({
      data: requestData(seeded, { recipientPhoneNumber: phone }),
    });
    await expect(prisma.messageRequest.update({
      where: { id: created.id }, data: { recipientPhoneNumber: '09129999999' },
    })).rejects.toThrow(/Message destination snapshot is immutable/);
    await expect(prisma.messageRequest.update({
      where: { id: created.id }, data: { recipientPhoneNumber: null },
    })).rejects.toThrow(/Message destination snapshot is immutable/);
    await prisma.messageRequest.update({ where: { id: created.id }, data: { status: 'DISPATCHED' } });
    await prisma.customer.update({ where: { id: seeded.customerId }, data: { phoneNumber: '09129999998' } });
    const historical = await prisma.messageRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(historical.recipientPhoneNumber).toBe(phone);
    expect(historical.status).toBe('DISPATCHED');
  });

  it('requires a customer XOR a VIP request, never both or neither', async () => {
    const seeded = await seedSalon();
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, { customerId: null, messageText: 'بدون گیرنده' }),
      }),
    ).rejects.toThrow(/message_requests_recipient_origin_consistent/);

    const vip = await seedVipRequest(seeded);
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          vipRequestId: vip.requestId,
          recipientDisplayName: 'مریم',
          recipientPhoneNumber: '09121111111',
          messageText: 'هر دو',
        }),
      }),
    ).rejects.toThrow(/message_requests_recipient_origin_consistent/);

    const unnamed = await prisma.messageRequest.create({
      data: requestData(seeded, {
        customerId: null, actionId: null, opportunityType: null,
        vipRequestId: vip.requestId, recipientDisplayName: null,
        recipientPhoneNumber: '09121111111', countsTowardDailyLimit: false,
        messageText: 'بدون نام',
      }),
    });
    expect(unnamed.recipientPhoneNumber).toBe('09121111111');
  });

  it('allows opportunity and manual customer messages only with a non-null customer', async () => {
    const seeded = await seedSalon();
    const opportunity = await prisma.messageRequest.create({
      data: requestData(seeded, { messageText: 'فرصت' }),
    });
    expect(opportunity.customerId).toBe(seeded.customerId);
    expect(opportunity.vipRequestId).toBeNull();

    const manual = await prisma.messageRequest.create({
      data: requestData(seeded, {
        actionId: null,
        opportunityType: null,
        messageText: 'دستی',
        messageBusinessDate: new Date('2026-09-11T00:00:00.000Z'),
      }),
    });
    expect(manual.customerId).toBe(seeded.customerId);
    expect(manual.vipRequestId).toBeNull();
  });

  it('allows a VIP message only with vipRequestId and a snapshot phone, not a customer', async () => {
    const seeded = await seedSalon();
    const vip = await seedVipRequest(seeded);
    const created = await prisma.messageRequest.create({
      data: requestData(seeded, {
        customerId: null,
        actionId: null,
        opportunityType: null,
        vipRequestId: vip.requestId,
        recipientDisplayName: 'مریم',
        recipientPhoneNumber: '09121111111',
        countsTowardDailyLimit: false,
        messageText: 'وی آی پی',
      }),
    });
    expect(created.customerId).toBeNull();
    expect(created.vipRequestId).toBe(vip.requestId);
    expect(created.recipientPhoneNumber).toBe('09121111111');

    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          customerId: null,
          actionId: null,
          opportunityType: null,
          vipRequestId: vip.requestId,
          recipientDisplayName: 'مریم',
          recipientPhoneNumber: '09121111111',
          countsTowardDailyLimit: false,
          messageText: 'تکراری',
        }),
      }),
    ).rejects.toThrow(/vip_request_id|message_requests_one_per_vip_recipient_phone/);
  });

  it('rejects mixed opportunity context on a message request', async () => {
    const seeded = await seedSalon();
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, { opportunityType: null, messageText: 'بدون نوع' }),
      }),
    ).rejects.toThrow(/message_requests_opportunity_context_consistent/);
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, { actionId: null, messageText: 'بدون اقدام' }),
      }),
    ).rejects.toThrow(/message_requests_opportunity_context_consistent/);
  });
});
