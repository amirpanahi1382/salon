import { randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createPrismaClient } from '@salon/database';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import {
  ADMIN_SUPPORT_MESSAGE_OPERATION,
  SALON_SUPPORT_MESSAGE_OPERATION,
  SUPPORT_PAGE_LIMIT,
} from '../src/support/support.constants';
import { SupportRepository } from '../src/support/support.repository';

const databaseUrl = process.env.SUPPORT_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const disposable =
  Boolean(databaseUrl) &&
  databaseUrl === process.env.DATABASE_URL &&
  databaseName.startsWith('salon_support_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;
const password = randomBytes(24).toString('hex');
const adminPassword = randomBytes(24).toString('hex');
const bodyMarker = 'SUPPORT_BODY_MARKER_zx81';

describeIfDisposable('salon user support conversations', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  const captured: string[] = [];

  beforeAll(async () => {
    if (!disposable) {
      return;
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Support tests refused to use a database other than the disposable target');
    }

    const adminEmail = `support-admin-${Date.now()}@example.test`;
    adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: adminEmail,
        name: 'اپراتور',
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminToken = login.body.accessToken as string;

    jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      captured.push(JSON.stringify(message));
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      captured.push(JSON.stringify(message));
    });
    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      captured.push(String(chunk));
      return stdout(chunk);
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      captured.push(String(chunk));
      return stderr(chunk);
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  async function createUser(salonId: string, role: 'OWNER' | 'MANAGER' | 'STAFF', label: string) {
    const userId = randomUUID();
    const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId,
        name: label,
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role,
        updatedAt: new Date(),
      },
    });
    const token = await app.get(JwtService).signAsync({ sub: userId, tid: salonId, role });
    return { userId, email, token, role };
  }

  async function createSalon(name: string) {
    const salonId = randomUUID();
    await prisma.client.salon.create({
      data: { id: salonId, name, updatedAt: new Date() },
    });
    const owner = await createUser(salonId, 'OWNER', `${name} owner`);
    const staff = await createUser(salonId, 'STAFF', `${name} staff`);
    return { salonId, owner, staff };
  }

  function authed(token: string) {
    return request(app.getHttpServer()).get('/support/conversation').set('Authorization', `Bearer ${token}`);
  }

  function send(token: string, text: string, key: string) {
    return request(app.getHttpServer())
      .post('/support/conversation/messages')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ text });
  }

  it('keeps conversations private, idempotent, and independent of messaging', async () => {
    const salonA = await createSalon('Salon A');
    const salonB = await createSalon('Salon B');
    const phone = `0912${Date.now().toString().slice(-7)}`.slice(0, 11);
    const customer = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.owner.token}`)
      .send({ firstName: 'Sara', lastName: 'A', phoneNumber: phone })
      .expect(201);
    const queued = await request(app.getHttpServer())
      .post(`/customers/${customer.body.id}/messages`)
      .set('Authorization', `Bearer ${salonA.owner.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ text: 'ordinary outreach' })
      .expect(201);
    const beforeMessage = await prisma.client.messageRequest.findUniqueOrThrow({
      where: { id: queued.body.id as string },
    });
    const beforeRequests = await prisma.client.messageRequest.count({ where: { salonId: salonA.salonId } });
    const beforeVip = await prisma.client.vipRequest.count({ where: { salonId: salonA.salonId } });
    const beforeOutbox = await prisma.client.outboxEvent.count({ where: { tenantId: salonA.salonId } });

    const emptyStaff = await authed(salonA.staff.token).expect(200);
    expect(emptyStaff.body.conversation).toBeNull();
    expect(emptyStaff.body.items).toEqual([]);

    const first = await send(salonA.owner.token, bodyMarker, 'support-key-01').expect(201);
    const replay = await send(salonA.owner.token, bodyMarker, 'support-key-01').expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await send(salonA.owner.token, `${bodyMarker} changed`, 'support-key-01').expect(409);
    expect(
      await prisma.client.supportMessage.count({
        where: { authorUserId: salonA.owner.userId },
      }),
    ).toBe(1);

    const staffMessage = await send(salonA.staff.token, 'staff only', 'support-key-staff').expect(201);
    const ownerView = await authed(salonA.owner.token).expect(200);
    const staffView = await authed(salonA.staff.token).expect(200);
    const otherView = await authed(salonB.owner.token).expect(200);
    expect(ownerView.body.items.map((item: { id: string }) => item.id)).toEqual([first.body.id]);
    expect(staffView.body.items.map((item: { id: string }) => item.id)).toEqual([staffMessage.body.id]);
    expect(JSON.stringify(otherView.body)).not.toContain(bodyMarker);
    expect(JSON.stringify(staffView.body)).not.toContain(bodyMarker);

    const ownerConversations = await prisma.client.supportConversation.count({
      where: { salonId: salonA.salonId, userId: salonA.owner.userId },
    });
    expect(ownerConversations).toBe(1);

    const [parallelA, parallelB] = await Promise.all([
      send(salonB.owner.token, 'one', 'parallel-key-01'),
      send(salonB.owner.token, 'two', 'parallel-key-02'),
    ]);
    expect(parallelA.status).toBe(201);
    expect(parallelB.status).toBe(201);
    expect(
      await prisma.client.supportConversation.count({ where: { userId: salonB.owner.userId } }),
    ).toBe(1);
    expect(
      await prisma.client.supportMessage.count({ where: { authorUserId: salonB.owner.userId } }),
    ).toBe(2);

    const inbox = await request(app.getHttpServer())
      .get('/admin/support/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const ownerRow = inbox.body.items.find(
      (item: { userEmail: string }) => item.userEmail === salonA.owner.email,
    );
    expect(ownerRow.salonName).toBe('Salon A');
    expect(ownerRow.userName).toBe(`${'Salon A'} owner`);
    expect(ownerRow.awaitingSupportReply).toBe(true);

    const reply = await request(app.getHttpServer())
      .post(`/admin/support/conversations/${ownerRow.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'admin-reply-key')
      .send({ text: 'پاسخ پشتیبانی' })
      .expect(201);
    expect(reply.body.authorKind).toBe('PLATFORM_ADMIN');
    expect(reply.body.authorName).toBe('اپراتور');
    const replyReplay = await request(app.getHttpServer())
      .post(`/admin/support/conversations/${ownerRow.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'admin-reply-key')
      .send({ text: 'پاسخ پشتیبانی' })
      .expect(201);
    expect(replyReplay.body.id).toBe(reply.body.id);

    const afterReply = await authed(salonA.owner.token).expect(200);
    expect(afterReply.body.items.map((item: { authorKind: string }) => item.authorKind)).toEqual([
      'PLATFORM_ADMIN',
      'SALON_USER',
    ]);
    const staffAfter = await authed(salonA.staff.token).expect(200);
    expect(JSON.stringify(staffAfter.body)).not.toContain('پاسخ پشتیبانی');

    await request(app.getHttpServer())
      .get('/admin/support/conversations')
      .set('Authorization', `Bearer ${salonA.owner.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/support/conversation')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    await send(salonA.owner.token, 'no', 'short').expect(400);
    await request(app.getHttpServer())
      .post('/support/conversation/messages')
      .set('Authorization', `Bearer ${salonA.owner.token}`)
      .set('Idempotency-Key', 'support-key-02')
      .send({ text: 'hello', salonId: salonB.salonId, userId: salonB.owner.userId })
      .expect(400);

    const audits = await prisma.client.auditLog.findMany({
      where: { resource: 'support_message', tenantId: salonA.salonId },
    });
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      expect(JSON.stringify(audit.metadata)).not.toContain(bodyMarker);
      expect(JSON.stringify(audit.metadata)).not.toContain('پاسخ پشتیبانی');
      expect(Object.keys(audit.metadata as object).sort()).toEqual([
        'authorKind',
        'conversationId',
        'messageId',
      ]);
    }
    const hashes = await prisma.client.idempotencyRecord.findMany({
      where: { operation: { in: ['support.salon_message', 'support.admin_message'] } },
    });
    for (const row of hashes) {
      expect(row.requestHash).not.toContain(bodyMarker);
    }
    expect(captured.join('\n')).not.toContain(bodyMarker);

    const message = await prisma.client.messageRequest.findUniqueOrThrow({
      where: { id: queued.body.id as string },
    });
    expect(message.status).toBe(beforeMessage.status);
    expect(message.updatedAt.toISOString()).toBe(beforeMessage.updatedAt.toISOString());
    expect(await prisma.client.messageRequest.count({ where: { salonId: salonA.salonId } })).toBe(
      beforeRequests,
    );
    expect(await prisma.client.vipRequest.count({ where: { salonId: salonA.salonId } })).toBe(beforeVip);
    expect(await prisma.client.outboxEvent.count({ where: { tenantId: salonA.salonId } })).toBe(
      beforeOutbox,
    );
  });

  it('pages messages and admin conversations in a stable order', async () => {
    const salon = await createSalon('Paged');
    const created = await send(salon.owner.token, 'newest api', 'page-key-newest').expect(201);
    const conversation = await prisma.client.supportConversation.findFirstOrThrow({
      where: { userId: salon.owner.userId },
    });
    const base = new Date('2026-01-01T00:00:00.000Z');
    for (let index = 0; index < SUPPORT_PAGE_LIMIT; index += 1) {
      await prisma.client.supportMessage.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          salonId: salon.salonId,
          authorUserId: salon.owner.userId,
          body: `older-${index}`,
          createdAt: new Date(base.getTime() + index * 1000),
        },
      });
    }

    const firstPage = await authed(salon.owner.token).expect(200);
    const secondPage = await request(app.getHttpServer())
      .get('/support/conversation')
      .query({ cursor: firstPage.body.nextCursor })
      .set('Authorization', `Bearer ${salon.owner.token}`)
      .expect(200);
    const again = await authed(salon.owner.token).expect(200);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.items).toHaveLength(SUPPORT_PAGE_LIMIT);
    expect(firstPage.body.items[0].id).toBe(created.body.id);
    expect(secondPage.body.hasMore).toBe(false);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].body).toBe('older-0');
    expect(again.body.items.map((item: { id: string }) => item.id)).toEqual(
      firstPage.body.items.map((item: { id: string }) => item.id),
    );
    const ids = [...firstPage.body.items, ...secondPage.body.items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(ids).size).toBe(ids.length);

    for (let index = 0; index < SUPPORT_PAGE_LIMIT; index += 1) {
      const user = await createUser(salon.salonId, 'MANAGER', `paged-${index}`);
      const conversationId = randomUUID();
      const at = new Date(base.getTime() + index * 1000);
      await prisma.client.supportConversation.create({
        data: {
          id: conversationId,
          salonId: salon.salonId,
          userId: user.userId,
          lastMessageAt: at,
          awaitingSupportReply: index % 2 === 0,
          updatedAt: at,
        },
      });
      await prisma.client.supportMessage.create({
        data: {
          id: randomUUID(),
          conversationId,
          salonId: salon.salonId,
          authorUserId: user.userId,
          body: `row-${index}`,
          createdAt: at,
        },
      });
    }
    const adminFirst = await request(app.getHttpServer())
      .get('/admin/support/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminSecond = await request(app.getHttpServer())
      .get('/admin/support/conversations')
      .query({ cursor: adminFirst.body.nextCursor })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminAgain = await request(app.getHttpServer())
      .get('/admin/support/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminFirst.body.hasMore).toBe(true);
    expect(adminFirst.body.items).toHaveLength(SUPPORT_PAGE_LIMIT);
    expect(adminSecond.body.items.length).toBeGreaterThan(0);
    const adminIds = [...adminFirst.body.items, ...adminSecond.body.items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(adminIds).size).toBe(adminIds.length);
    expect(adminAgain.body.items.map((item: { id: string }) => item.id)).toEqual(
      adminFirst.body.items.map((item: { id: string }) => item.id),
    );
  });

  it('orders concurrent salon and admin sends by the commit that acquired the lock', async () => {
    const salon = await createSalon('Race');
    const repository = new SupportRepository();
    const left = createPrismaClient(databaseUrl!);
    const right = createPrismaClient(databaseUrl!);

    async function waitingLocks(): Promise<number> {
      const rows = await prisma.client.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND cardinality(pg_blocking_pids(pid)) > 0
      `;
      return rows[0]?.waiting ?? 0;
    }

    async function waitForLockWaiter(): Promise<void> {
      const baseline = await waitingLocks();
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await waitingLocks()) > baseline) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Timed out waiting for the second support send to block on the conversation lock');
    }

    async function interleave(direction: 'salon-waits' | 'admin-waits') {
      const user = direction === 'salon-waits' ? salon.owner : salon.staff;
      const opened = await send(user.token, `anchor-${direction}`, `race-anchor-${direction}`).expect(201);
      const conversation = await prisma.client.supportConversation.findFirstOrThrow({
        where: { userId: user.userId },
      });
      let releaseHolder: () => void = () => undefined;
      const holderHasLock = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });
      const holderIsSalon = direction === 'admin-waits';
      const holderPromise = left.$transaction(async (tx) => {
        await repository.lockConversation(tx, conversation.id);
        releaseHolder();
        await waitForLockWaiter();
        return repository.commitMessage(tx, {
          conversationId: conversation.id,
          salonId: salon.salonId,
          actorId: holderIsSalon ? user.userId : adminId,
          tenantId: salon.salonId,
          operation: holderIsSalon ? SALON_SUPPORT_MESSAGE_OPERATION : ADMIN_SUPPORT_MESSAGE_OPERATION,
          idempotencyKey: `race-holder-${direction}`,
          requestHash: `hash-holder-${direction}`,
          authorUserId: holderIsSalon ? user.userId : null,
          authorPlatformAdminId: holderIsSalon ? null : adminId,
          body: holderIsSalon ? `holder-salon-${direction}` : `holder-admin-${direction}`,
        });
      }, { timeout: 20_000, maxWait: 5_000 });
      await holderHasLock;
      const waiterPromise = right.$transaction(async (tx) => {
        await repository.lockConversation(tx, conversation.id);
        const waiterIsSalon = !holderIsSalon;
        return repository.commitMessage(tx, {
          conversationId: conversation.id,
          salonId: salon.salonId,
          actorId: waiterIsSalon ? user.userId : adminId,
          tenantId: salon.salonId,
          operation: waiterIsSalon ? SALON_SUPPORT_MESSAGE_OPERATION : ADMIN_SUPPORT_MESSAGE_OPERATION,
          idempotencyKey: `race-waiter-${direction}`,
          requestHash: `hash-waiter-${direction}`,
          authorUserId: waiterIsSalon ? user.userId : null,
          authorPlatformAdminId: waiterIsSalon ? null : adminId,
          body: waiterIsSalon ? `waiter-salon-${direction}` : `waiter-admin-${direction}`,
        });
      }, { timeout: 20_000, maxWait: 5_000 });
      const [holderMessage, waiterMessage] = await Promise.all([holderPromise, waiterPromise]);
      const stored = await prisma.client.supportConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      const thread = await request(app.getHttpServer())
        .get(`/admin/support/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const chronology = [...thread.body.items].reverse() as Array<{
        id: string;
        authorKind: string;
        createdAt: string;
      }>;
      expect(chronology.map((item) => item.id)).toEqual([
        opened.body.id,
        holderMessage.id,
        waiterMessage.id,
      ]);
      expect(waiterMessage.createdAt.getTime()).toBeGreaterThan(holderMessage.createdAt.getTime());
      expect(stored.lastMessageAt.toISOString()).toBe(waiterMessage.createdAt.toISOString());
      expect(stored.awaitingSupportReply).toBe(!holderIsSalon);
      expect(thread.body.conversation.awaitingSupportReply).toBe(!holderIsSalon);
      expect(chronology[chronology.length - 1]?.authorKind).toBe(holderIsSalon ? 'PLATFORM_ADMIN' : 'SALON_USER');
    }

    try {
      await interleave('salon-waits');
      await interleave('admin-waits');
    } finally {
      await left.$disconnect();
      await right.$disconnect();
    }
  });

  it('does not move the latest message when an older send is replayed', async () => {
    const salon = await createSalon('Replay');
    const first = await send(salon.owner.token, 'first', 'replay-salon-1').expect(201);
    const conversation = await prisma.client.supportConversation.findFirstOrThrow({
      where: { userId: salon.owner.userId },
    });
    const reply = await request(app.getHttpServer())
      .post(`/admin/support/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'replay-admin-1')
      .send({ text: 'answered' })
      .expect(201);
    const answered = await prisma.client.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(answered.awaitingSupportReply).toBe(false);
    const salonReplay = await send(salon.owner.token, 'first', 'replay-salon-1').expect(201);
    expect(salonReplay.body.id).toBe(first.body.id);
    const afterSalonReplay = await prisma.client.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(afterSalonReplay.lastMessageAt.toISOString()).toBe(answered.lastMessageAt.toISOString());
    expect(afterSalonReplay.awaitingSupportReply).toBe(false);
    expect(await prisma.client.supportMessage.count({ where: { conversationId: conversation.id } })).toBe(2);

    const later = await send(salon.owner.token, 'later', 'replay-salon-2').expect(201);
    const needsReply = await prisma.client.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(needsReply.awaitingSupportReply).toBe(true);
    const adminReplay = await request(app.getHttpServer())
      .post(`/admin/support/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'replay-admin-1')
      .send({ text: 'answered' })
      .expect(201);
    expect(adminReplay.body.id).toBe(reply.body.id);
    const afterAdminReplay = await prisma.client.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(afterAdminReplay.lastMessageAt.toISOString()).toBe(needsReply.lastMessageAt.toISOString());
    expect(afterAdminReplay.lastMessageAt.toISOString()).toBe(later.body.createdAt);
    expect(afterAdminReplay.awaitingSupportReply).toBe(true);
    expect(await prisma.client.supportMessage.count({ where: { conversationId: conversation.id } })).toBe(3);
  });

  it('keeps a new message after the stored millisecond for salon and admin authors', async () => {
    const salon = await createSalon('Same millisecond');
    await send(salon.owner.token, 'anchor', 'milli-anchor').expect(201);
    const conversation = await prisma.client.supportConversation.findFirstOrThrow({
      where: { userId: salon.owner.userId },
    });

    async function pin(aheadMs: number): Promise<Date> {
      const rows = await prisma.client.$queryRaw<Array<{ at: Date }>>`
        WITH pinned AS (
          SELECT date_trunc('milliseconds', clock_timestamp())
            + (${aheadMs}::int * interval '1 millisecond') AS at
        ),
        moved AS (
          UPDATE support_messages
          SET created_at = (SELECT at FROM pinned)
          WHERE conversation_id = ${conversation.id}::uuid
          RETURNING 1
        )
        UPDATE support_conversations
        SET last_message_at = (SELECT at FROM pinned)
        WHERE id = ${conversation.id}::uuid
        RETURNING last_message_at AS at
      `;
      const at = rows[0]?.at;
      if (!at) {
        throw new Error('Pinned support timestamp missing');
      }
      return at;
    }

    async function latestAuthor(): Promise<{ id: string; authorKind: string; awaiting: boolean }> {
      const thread = await request(app.getHttpServer())
        .get(`/admin/support/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const newest = thread.body.items[0] as { id: string; authorKind: string };
      return {
        id: newest.id,
        authorKind: newest.authorKind,
        awaiting: thread.body.conversation.awaitingSupportReply as boolean,
      };
    }

    const equalPin = await pin(0);
    const salonEqual = await send(salon.owner.token, 'salon-equal', 'milli-salon-equal').expect(201);
    expect(Date.parse(salonEqual.body.createdAt)).toBeGreaterThan(equalPin.getTime());
    const afterEqual = await latestAuthor();
    expect(afterEqual).toEqual({
      id: salonEqual.body.id,
      authorKind: 'SALON_USER',
      awaiting: true,
    });

    const salonAhead = await pin(60_000);
    const salonMessage = await send(salon.owner.token, 'salon-ahead', 'milli-salon-ahead').expect(201);
    expect(Date.parse(salonMessage.body.createdAt)).toBe(salonAhead.getTime() + 1);
    const afterSalon = await latestAuthor();
    expect(afterSalon).toEqual({
      id: salonMessage.body.id,
      authorKind: 'SALON_USER',
      awaiting: true,
    });
    const salonReplay = await send(salon.owner.token, 'salon-ahead', 'milli-salon-ahead').expect(201);
    expect(salonReplay.body.id).toBe(salonMessage.body.id);
    expect(salonReplay.body.createdAt).toBe(salonMessage.body.createdAt);
    const afterSalonReplay = await prisma.client.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(afterSalonReplay.lastMessageAt.toISOString()).toBe(salonMessage.body.createdAt);
    expect(afterSalonReplay.awaitingSupportReply).toBe(true);

    const adminAhead = await pin(120_000);
    const adminMessage = await request(app.getHttpServer())
      .post(`/admin/support/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'milli-admin-ahead')
      .send({ text: 'admin-ahead' })
      .expect(201);
    expect(Date.parse(adminMessage.body.createdAt)).toBe(adminAhead.getTime() + 1);
    const afterAdmin = await latestAuthor();
    expect(afterAdmin).toEqual({
      id: adminMessage.body.id,
      authorKind: 'PLATFORM_ADMIN',
      awaiting: false,
    });
    const adminReplay = await request(app.getHttpServer())
      .post(`/admin/support/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'milli-admin-ahead')
      .send({ text: 'admin-ahead' })
      .expect(201);
    expect(adminReplay.body.id).toBe(adminMessage.body.id);
    expect(adminReplay.body.createdAt).toBe(adminMessage.body.createdAt);
    const afterAdminReplay = await prisma.client.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(afterAdminReplay.lastMessageAt.toISOString()).toBe(adminMessage.body.createdAt);
    expect(afterAdminReplay.awaitingSupportReply).toBe(false);
    expect(
      await prisma.client.supportMessage.count({ where: { conversationId: conversation.id } }),
    ).toBe(4);
  });

  it('does not write support text when a message insert fails the author check', async () => {
    const marker = 'SUPPORT_LOG_MARKER_q7m4';
    const salon = await createSalon('Log boundary');
    await send(salon.owner.token, 'anchor', 'log-anchor').expect(201);
    const conversation = await prisma.client.supportConversation.findFirstOrThrow({
      where: { userId: salon.owner.userId },
    });
    const before = captured.length;
    await expect(
      prisma.client.supportMessage.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          salonId: salon.salonId,
          authorUserId: salon.owner.userId,
          authorPlatformAdminId: adminId,
          body: marker,
          createdAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    const logged = captured.slice(before).join('\n');
    expect(logged).not.toContain(marker);
    expect(logged).not.toContain('Failing row');
    expect(logged).not.toContain('ConnectorError');
    expect(logged).toContain('"code":"23514"');
    expect(logged).toContain('"operation":"supportMessage.create"');
    expect(await prisma.client.supportMessage.count({ where: { conversationId: conversation.id } })).toBe(1);
  });

  it('rejects a second conversation and an author that is not exactly one side', async () => {
    const salon = await createSalon('Constraints');
    await send(salon.owner.token, 'anchor', 'constraint-key').expect(201);
    const conversation = await prisma.client.supportConversation.findFirstOrThrow({
      where: { userId: salon.owner.userId },
    });
    await expect(
      prisma.client.supportConversation.create({
        data: {
          id: randomUUID(),
          salonId: salon.salonId,
          userId: salon.owner.userId,
          lastMessageAt: new Date(),
          awaitingSupportReply: true,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.client.$executeRaw`
        INSERT INTO support_messages (
          id, conversation_id, salon_id, author_user_id, author_platform_admin_id, body, created_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${conversation.id}::uuid,
          ${salon.salonId}::uuid,
          ${salon.owner.userId}::uuid,
          ${adminId}::uuid,
          'both',
          NOW()
        )
      `,
    ).rejects.toThrow();
    await expect(
      prisma.client.$executeRaw`
        INSERT INTO support_messages (
          id, conversation_id, salon_id, author_user_id, author_platform_admin_id, body, created_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${conversation.id}::uuid,
          ${salon.salonId}::uuid,
          NULL,
          NULL,
          'none',
          NOW()
        )
      `,
    ).rejects.toThrow();
  });
});
