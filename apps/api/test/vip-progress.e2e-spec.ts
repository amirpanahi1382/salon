import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '@salon/database';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { syntheticMobile } from './support/phone-account';

const expectedName = process.env.VIP_PROGRESS_E2E_DATABASE_NAME ?? '';
const expectedPort = process.env.VIP_PROGRESS_E2E_HOST_PORT ?? '';
const expectedSystemIdentifier = process.env.VIP_PROGRESS_E2E_SYSTEM_IDENTIFIER ?? '';
const expectedComment = process.env.VIP_PROGRESS_E2E_DATABASE_COMMENT ?? '';
const proofRequested = Boolean(expectedName && expectedPort && expectedSystemIdentifier && expectedComment);
const FORBIDDEN_PORTS = new Set(['5432', '15442']);

function databaseTarget(): { name: string; port: string } {
  const raw = process.env.DATABASE_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('vip-progress e2e refused an unreadable database target');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] ?? '');
  const port = url.port;
  const host = url.hostname;
  if (name === 'salon' || name === 'salon_preview') {
    throw new Error('vip-progress e2e refused a persistent database name');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('vip-progress e2e refused a non-loopback database host');
  }
  if (!port || FORBIDDEN_PORTS.has(port)) {
    throw new Error('vip-progress e2e refused a persistent or preview database port');
  }
  if (!name.startsWith('salon_vip_progress_') || name !== expectedName || port !== expectedPort) {
    throw new Error('vip-progress e2e database target does not match the explicit disposable proof');
  }
  return { name, port };
}

if (proofRequested) {
  databaseTarget();
}

async function proveDisposableIdentity(): Promise<void> {
  databaseTarget();
  const db = createPrismaClient(process.env.DATABASE_URL ?? '');
  try {
    const rows = await db.$queryRaw<Array<{ current: string; sid: bigint; comment: string | null }>>`
      SELECT current_database() AS current,
             (SELECT system_identifier FROM pg_control_system()) AS sid,
             (
               SELECT shobj_description(d.oid, 'pg_database')
               FROM pg_database d
               WHERE d.datname = current_database()
             ) AS comment
    `;
    const row = rows[0];
    if (!row || row.current !== expectedName) {
      throw new Error('vip-progress e2e connected database does not match the explicit name');
    }
    if (String(row.sid) !== expectedSystemIdentifier || row.comment !== expectedComment) {
      throw new Error('vip-progress e2e database identity proof did not match');
    }
  } finally {
    await db.$disconnect();
  }
}

const describeIfDb = proofRequested ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';

type ProgressBody = {
  headline: string;
  explanation: string;
  nextActor: string;
  nextActorLabel: string;
  reservationStillValid: boolean;
  countLines: Array<{ key: string; label: string; count: number }>;
  countsOmittedReason: string | null;
  activeStopNote: string | null;
  listReservationNote: string | null;
  requestedCountNote: string | null;
  latestActionLabel: string | null;
};

function countOf(progress: ProgressBody, key: string): number | undefined {
  return progress.countLines.find((line) => line.key === key)?.count;
}

describeIfDb('VIP request progress (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let jwt: JwtService;
  let phoneSerial = 1_000_000 + Math.floor(Math.random() * 7_000_000);
  const bodyMarker = `progress-body-${randomUUID()}`;
  const phones: string[] = [];

  const ids = {
    salonA: '',
    salonB: '',
    tokenA: '',
    tokenB: '',
    userA: '',
    adminId: '',
    awaiting: '',
    submitted: '',
    manual: '',
    bale: '',
    cancelled: '',
    empty: '',
    expired: '',
    closedNone: '',
    closedSent: '',
  };

  function nextPhone(): string {
    phoneSerial += 1;
    const phone = `0912${String(phoneSerial).padStart(7, '0')}`;
    phones.push(phone);
    return phone;
  }

  beforeAll(async () => {
    await proveDisposableIdentity();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new MemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const adminEmail = `vip-progress-${Date.now()}@example.test`;
    const adminPhone = syntheticMobile();
    ids.adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: ids.adminId,
        email: adminEmail,
        phone: adminPhone,
        name: 'Ops',
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: adminPhone, password: adminPassword })
      .expect(201);
    adminToken = login.body.accessToken as string;

    const salonA = await createSalon('progress-a');
    const salonB = await createSalon('progress-b');
    ids.salonA = salonA.tenantId;
    ids.salonB = salonB.tenantId;
    ids.tokenA = salonA.token;
    ids.tokenB = salonB.token;
    ids.userA = salonA.userId;
    await entitle(ids.salonA);
    await entitle(ids.salonB);

    const now = new Date();
    ids.awaiting = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: new Date(now.getTime() + 20 * 60_000),
      createdAt: new Date(now.getTime() - 60_000),
    });
    await seedRecipients(ids.awaiting, ids.salonA, 1);

    ids.submitted = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'SUBMITTED',
      reservedUntil: new Date(now.getTime() - 60_000),
      submittedAt: new Date(now.getTime() - 50_000),
      createdAt: new Date(now.getTime() - 70_000),
    });
    await seedRecipients(ids.submitted, ids.salonA, 2);

    ids.manual = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'MANUAL_QUEUED',
      reservedUntil: new Date(now.getTime() - 120_000),
      submittedAt: new Date(now.getTime() - 110_000),
      createdAt: new Date(now.getTime() - 130_000),
    });
    await seedManualRecipients(ids.manual, ids.salonA, salonA.userId);

    ids.bale = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'BALE_NOT_IMPLEMENTED',
      reservedUntil: new Date(now.getTime() - 180_000),
      submittedAt: new Date(now.getTime() - 170_000),
      createdAt: new Date(now.getTime() - 190_000),
    });
    await seedRecipients(ids.bale, ids.salonA, 1);

    ids.cancelled = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'CANCELLED',
      reservedUntil: new Date(now.getTime() - 240_000),
      cancelledAt: new Date(now.getTime() - 230_000),
      createdAt: new Date(now.getTime() - 250_000),
    });
    await seedRecipients(ids.cancelled, ids.salonA, 1);

    ids.empty = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'SUBMITTED',
      reservedUntil: new Date(now.getTime() - 300_000),
      submittedAt: new Date(now.getTime() - 290_000),
      createdAt: new Date(now.getTime() - 310_000),
    });

    ids.closedNone = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'MANUAL_QUEUED',
      reservedUntil: new Date(now.getTime() - 360_000),
      submittedAt: new Date(now.getTime() - 350_000),
      createdAt: new Date(now.getTime() - 370_000),
    });
    await seedManualRecipients(ids.closedNone, ids.salonA, salonA.userId, ['failed', 'cancelled', 'skipped']);

    ids.closedSent = await seedRequest({
      salonId: ids.salonA,
      userId: salonA.userId,
      status: 'MANUAL_QUEUED',
      reservedUntil: new Date(now.getTime() - 420_000),
      submittedAt: new Date(now.getTime() - 410_000),
      createdAt: new Date(now.getTime() - 430_000),
    });
    await seedManualRecipients(ids.closedSent, ids.salonA, salonA.userId, ['manual-sent', 'failed']);

    ids.expired = await seedRequest({
      salonId: ids.salonB,
      userId: salonB.userId,
      status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: new Date(now.getTime() - 60_000),
      createdAt: new Date(now.getTime() - 120_000),
    });
    await seedRecipients(ids.expired, ids.salonB, 1);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSalon(label: string) {
    const email = `${label}-${randomUUID()}@example.test`;
    const salonId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await prisma.client.salon.create({
      data: { id: salonId, name: `${label} salon`, updatedAt: now },
    });
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId,
        name: `${label} owner`,
        email,
        phone: syntheticMobile(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'OWNER',
        updatedAt: now,
      },
    });
    const token = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    return { token, userId, tenantId: salonId };
  }

  function entitle(salonId: string) {
    return prisma.client.vipSalonEntitlement.create({
      data: {
        id: randomUUID(),
        salonId,
        grantedByAdminId: ids.adminId,
        grantedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async function seedRequest(input: {
    salonId: string;
    userId: string;
    status: 'AWAITING_SAMPLE_WORK' | 'SUBMITTED' | 'MANUAL_QUEUED' | 'BALE_NOT_IMPLEMENTED' | 'CANCELLED';
    reservedUntil: Date;
    createdAt: Date;
    submittedAt?: Date;
    cancelledAt?: Date;
  }) {
    const listId = randomUUID();
    const requestId = randomUUID();
    const now = new Date();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: `list-${requestId.slice(0, 8)}`,
        status: 'IN_USE',
        contactCount: 30,
        regionCode: '01',
        catalogMembership: 'ORIGINAL_TEHRAN',
        createdByAdminId: ids.adminId,
        reservedBySalonId: input.salonId,
        reservedAt: input.createdAt,
        updatedAt: now,
      },
    });
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        listId,
        createdByUserId: input.userId,
        requestedCount: 30,
        geographicRange: 'منطقه آزمایش',
        status: input.status,
        reservedUntil: input.reservedUntil,
        submittedAt: input.submittedAt ?? null,
        cancelledAt: input.cancelledAt ?? null,
        createdAt: input.createdAt,
        updatedAt: now,
      },
    });
    return requestId;
  }

  async function seedRecipients(requestId: string, salonId: string, count: number) {
    const request = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { listId: true },
    });
    for (let index = 0; index < count; index += 1) {
      const contactId = randomUUID();
      const phone = nextPhone();
      await prisma.client.vipTargetContact.create({
        data: {
          id: contactId,
          listId: request.listId,
          sortOrder: index + 1,
          displayName: `hidden-${contactId.slice(0, 8)}`,
          phoneNumber: phone,
        },
      });
      await prisma.client.vipRequestRecipient.create({
        data: {
          id: randomUUID(),
          vipRequestId: requestId,
          salonId,
          sortOrder: index + 1,
          sourceContactId: contactId,
          displayName: `hidden-${contactId.slice(0, 8)}`,
          phoneNumber: phone,
          messageText: bodyMarker,
        },
      });
    }
  }

  async function seedManualRecipients(
    requestId: string,
    salonId: string,
    userId: string,
    kinds: ReadonlyArray<'queued' | 'manual-sent' | 'failed' | 'cancelled' | 'skipped' | 'active-stop'> = [
      'queued',
      'manual-sent',
      'failed',
      'cancelled',
      'skipped',
      'active-stop',
    ],
  ) {
    const request = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { listId: true },
    });
    for (let index = 0; index < kinds.length; index += 1) {
      const kind = kinds[index]!;
      const contactId = randomUUID();
      const recipientId = randomUUID();
      const phone = nextPhone();
      await prisma.client.vipTargetContact.create({
        data: {
          id: contactId,
          listId: request.listId,
          sortOrder: index + 1,
          displayName: `hidden-${kind}`,
          phoneNumber: phone,
        },
      });
      let messageRequestId: string | null = null;
      if (kind === 'queued' || kind === 'manual-sent' || kind === 'failed' || kind === 'cancelled') {
        messageRequestId = randomUUID();
        const status = kind === 'queued'
          ? 'QUEUED'
          : kind === 'manual-sent'
            ? 'SENT'
            : kind === 'failed'
              ? 'FAILED'
              : 'CANCELLED';
        await prisma.client.messageRequest.create({
          data: {
            id: messageRequestId,
            salonId,
            createdByUserId: userId,
            vipRequestId: requestId,
            recipientDisplayName: `hidden-${kind}`,
            recipientPhoneNumber: phone,
            messageText: bodyMarker,
            requestedAt: new Date('2026-10-14T08:00:00.000Z'),
            messageBusinessDate: new Date('2026-10-14T00:00:00.000Z'),
            countsTowardDailyLimit: false,
            status,
            updatedAt: new Date('2026-10-14T08:00:00.000Z'),
          },
        });
        if (kind === 'manual-sent') {
          await prisma.client.messageDelivery.create({
            data: {
              id: randomUUID(),
              salonId,
              messageRequestId,
              mode: 'MANUAL',
              channel: 'TEXT',
              status: 'SENT',
              providerRequestId: randomUUID(),
              createdBy: userId,
              submittedAt: new Date(Date.now() + 60_000),
              updatedAt: new Date(),
            },
          });
        }
      }
      await prisma.client.vipRequestRecipient.create({
        data: {
          id: recipientId,
          vipRequestId: requestId,
          salonId,
          sortOrder: index + 1,
          sourceContactId: contactId,
          displayName: `hidden-${kind}`,
          phoneNumber: phone,
          messageText: bodyMarker,
          messageRequestId,
        },
      });
      if (kind === 'skipped') {
        await prisma.client.platformMessageStop.create({
          data: {
            id: randomUUID(),
            phoneNumber: phone,
            active: false,
            reasonCode: 'RECIPIENT_REQUEST',
            registeredByAdminId: ids.adminId,
            registeredAt: new Date('2026-10-13T08:00:00.000Z'),
            liftedByAdminId: ids.adminId,
            liftedAt: new Date('2026-10-13T09:00:00.000Z'),
            updatedAt: new Date('2026-10-13T09:00:00.000Z'),
          },
        });
        await prisma.client.messageGlobalStopOutcome.create({
          data: {
            id: randomUUID(),
            salonId,
            phoneNumber: phone,
            reasonCode: 'RECIPIENT_REQUEST',
            vipRequestRecipientId: recipientId,
          },
        });
      }
      if (kind === 'active-stop') {
        await prisma.client.platformMessageStop.create({
          data: {
            id: randomUUID(),
            phoneNumber: phone,
            active: true,
            reasonCode: 'RECIPIENT_REQUEST',
            registeredByAdminId: ids.adminId,
            registeredAt: new Date('2026-10-14T07:00:00.000Z'),
            updatedAt: new Date('2026-10-14T07:00:00.000Z'),
          },
        });
      }
    }
  }

  function assertNoIdentity(payload: unknown) {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(bodyMarker);
    expect(serialized).not.toContain('phoneNumber');
    expect(serialized).not.toContain('displayName');
    expect(serialized).not.toContain('messageText');
    for (const phone of phones) {
      expect(serialized).not.toContain(phone);
    }
  }

  it('composes salon and admin progress without writing delivery or leaking identity', async () => {
    const adminBeforeExpiry = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/salons/${ids.salonB}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const expiredRow = adminBeforeExpiry.body.items.find(
      (item: { id: string }) => item.id === ids.expired,
    );
    expect(expiredRow.status).toBe('AWAITING_SAMPLE_WORK');
    expect(expiredRow.progress.headline).toBe('مهلت رزرو این پیش‌نویس گذشته است');
    expect(expiredRow.progress.explanation).toContain('نه شکست ارسال');
    expect(expiredRow.progress.nextActor).toBe('NONE');

    const capability = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${ids.tokenA}`)
      .expect(200);
    assertNoIdentity(capability.body);
    expect(JSON.stringify(capability.body)).not.toContain(ids.expired);

    const byId = new Map<string, { status: string; progress: ProgressBody }>();
    const draft = capability.body.activeDraft;
    byId.set(draft.id, draft);
    for (const row of capability.body.inProgressRequests) byId.set(row.id, row);
    byId.set(capability.body.latestCancelledRequest.id, capability.body.latestCancelledRequest);

    const awaiting = byId.get(ids.awaiting)!;
    expect(awaiting.status).toBe('AWAITING_SAMPLE_WORK');
    expect(awaiting.progress.headline).toBe('در انتظار ارسال نمونه‌کارهای شما');
    expect(awaiting.progress.nextActor).toBe('SALON');
    expect(awaiting.progress.nextActorLabel).toBe('اقدام بعدی با سالن است');
    expect(awaiting.progress.reservationStillValid).toBe(true);
    expect(awaiting.progress.listReservationNote).toContain('نگه داشته شده');
    expect(countOf(awaiting.progress, 'notYetQueued')).toBe(1);

    const submitted = byId.get(ids.submitted)!;
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.progress.headline).toBe('درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود');
    expect(submitted.progress.nextActor).toBe('PLATFORM_ADMIN');
    expect(submitted.progress.explanation).toContain('به معنای ارسال یا تحویل پیام نیست');
    expect(countOf(submitted.progress, 'notYetQueued')).toBe(2);
    expect(countOf(submitted.progress, 'manuallyMarkedSent')).toBe(0);

    const manual = byId.get(ids.manual)!;
    expect(manual.status).toBe('MANUAL_QUEUED');
    expect(manual.progress.headline).toBe('درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید');
    expect(manual.progress.explanation).toContain('تحویل قطعی پیام نیست');
    expect(manual.progress.explanation).toContain('حتی اگر توقف کلی برداشته شود');
    expect(manual.progress.countLines.find((line) => line.key === 'durablySkipped')?.label).toBe(
      'برای این درخواست دیگر پیام نمی‌گیرد',
    );
    expect(manual.progress.nextActor).toBe('PLATFORM_ADMIN');
    expect(countOf(manual.progress, 'notYetQueued')).toBe(1);
    expect(countOf(manual.progress, 'inHandling')).toBe(1);
    expect(countOf(manual.progress, 'manuallyMarkedSent')).toBe(1);
    expect(countOf(manual.progress, 'failed')).toBe(1);
    expect(countOf(manual.progress, 'cancelledMessage')).toBe(1);
    expect(countOf(manual.progress, 'durablySkipped')).toBe(1);
    expect(manual.progress.activeStopNote).toContain('جدا از شمارش');
    expect(manual.progress.latestActionLabel).toBe('آخرین علامت ارسال دستی');
    const manualTotal = manual.progress.countLines.reduce((sum, line) => sum + line.count, 0);
    expect(manualTotal).toBe(6);

    const bale = byId.get(ids.bale)!;
    expect(bale.progress.headline).toBe('درخواست شما ثبت شد، به محض تأیید ادمین ارسال می‌شود');
    expect(bale.progress.explanation).not.toContain('بله');
    expect(bale.progress.nextActor).toBe('PLATFORM_ADMIN');

    const cancelled = byId.get(ids.cancelled)!;
    expect(cancelled.progress.headline).toBe('اتمام مهلت ارسال درخواست');
    expect(cancelled.progress.explanation).toContain('نه ناموفق بودن یک ارسال');
    expect(cancelled.progress.nextActor).toBe('NONE');
    expect(cancelled.progress.latestActionLabel).toBe('بستن پیش‌نویس');

    const empty = byId.get(ids.empty)!;
    expect(empty.progress.countLines).toEqual([]);
    expect(empty.progress.countsOmittedReason).toBeNull();
    expect(empty.progress.requestedCountNote).toContain('عدد درخواستی');

    const foreign = await request(app.getHttpServer())
      .get(`/vip/requests/${ids.submitted}`)
      .set('Authorization', `Bearer ${ids.tokenB}`)
      .expect(404);
    expect(JSON.stringify(foreign.body)).not.toContain(bodyMarker);

    const own = await request(app.getHttpServer())
      .get(`/vip/requests/${ids.manual}`)
      .set('Authorization', `Bearer ${ids.tokenA}`)
      .expect(200);
    assertNoIdentity(own.body);
    expect(own.body.progress.headline).toBe('درخواست شما در حال رسیدگی است؛ وضعیت هر گیرنده را پایین ببینید');

    const closedNone = byId.get(ids.closedNone)!;
    expect(closedNone.status).toBe('MANUAL_QUEUED');
    expect(closedNone.progress.headline).toBe('رسیدگی پایان یافت؛ ارسالی برای این درخواست ثبت نشد');
    expect(countOf(closedNone.progress, 'failed')).toBe(1);
    expect(countOf(closedNone.progress, 'cancelledMessage')).toBe(1);
    expect(countOf(closedNone.progress, 'durablySkipped')).toBe(1);
    expect(countOf(closedNone.progress, 'manuallyMarkedSent')).toBe(0);
    expect(countOf(closedNone.progress, 'inHandling')).toBe(0);
    const closedSent = byId.get(ids.closedSent)!;
    expect(closedSent.status).toBe('MANUAL_QUEUED');
    expect(closedSent.progress.headline).toBe('رسیدگی به این درخواست پایان یافت؛ نتیجهٔ هر گیرنده را پایین ببینید');
    expect(countOf(closedSent.progress, 'manuallyMarkedSent')).toBe(1);
    expect(countOf(closedSent.progress, 'failed')).toBe(1);
    expect(closedSent.progress.explanation).toContain('تحویل قطعی پیام نیست');

    const adminFolder = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/salons/${ids.salonA}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminManual = adminFolder.body.items.find((item: { id: string }) => item.id === ids.manual);
    expect(adminManual.progress.headline).toBe('رسیدگی دستی شروع شده');
    expect(adminManual.progress.headline).not.toBe(manual.progress.headline);
    expect(countOf(adminManual.progress, 'manuallyMarkedSent')).toBe(1);
    expect(countOf(adminManual.progress, 'durablySkipped')).toBe(1);
    expect(JSON.stringify(adminManual.progress)).not.toContain(bodyMarker);
    expect(adminManual.canDispatchManual).toBe(false);
    const adminBale = adminFolder.body.items.find((item: { id: string }) => item.id === ids.bale);
    expect(adminBale.progress.headline).toBe('ارسال با بله در دسترس نیست');
    expect(adminBale.canDispatchManual).toBe(true);
    const adminClosedNone = adminFolder.body.items.find((item: { id: string }) => item.id === ids.closedNone);
    expect(adminClosedNone.progress.headline).toBe('کار باز نمانده؛ ارسالی ثبت نشده است');
    expect(adminClosedNone.canDispatchManual).toBe(false);
    const adminClosedSent = adminFolder.body.items.find((item: { id: string }) => item.id === ids.closedSent);
    expect(adminClosedSent.progress.headline).toBe('رسیدگی پیام‌ها تمام شده');
    expect(adminClosedSent.progress.explanation).toContain('تحویل یا جذب را ثابت نمی‌کند');

    const adminDetail = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${ids.manual}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminDetail.body.request.progress.headline).toBe('رسیدگی دستی شروع شده');
    expect(JSON.stringify(adminDetail.body.request.progress)).not.toContain(bodyMarker);
    expect(adminDetail.body.request.status).toBe('MANUAL_QUEUED');

    const salonB = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${ids.tokenB}`)
      .expect(200);
    expect(salonB.body.latestCancelledRequest.id).toBe(ids.expired);
    expect(salonB.body.latestCancelledRequest.status).toBe('CANCELLED');
    expect(salonB.body.latestCancelledRequest.progress.headline).toBe('اتمام مهلت ارسال درخواست');
    expect(JSON.stringify(salonB.body)).not.toContain(ids.submitted);
    assertNoIdentity(salonB.body);

    const stored = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: ids.expired } });
    expect(stored.status).toBe('CANCELLED');
    expect(stored.cancelledAt).not.toBeNull();
    const manualStored = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: ids.manual } });
    expect(manualStored.status).toBe('MANUAL_QUEUED');
  });
});
