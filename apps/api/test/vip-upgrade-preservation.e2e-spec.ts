import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { createPlatformAdminSession } from './support/phone-account';

const submittedRequestId = '66666666-6666-4666-8666-666666666666';
const salonId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const listId = '44444444-4444-4444-8444-444444444444';
const auditId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const outboxId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const databaseUrl = process.env.DATABASE_URL ?? '';
const describeIfUpgrade = (() => {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.pathname === '/salon_vip_upgrade_gate20261031' && parsed.hostname === '127.0.0.1' && parsed.port === '55931'
      ? describe
      : describe.skip;
  } catch {
    return describe.skip;
  }
})();

describeIfUpgrade('historical VIP rows survive the quantity migrations (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new MemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const identity = await prisma.client.$queryRaw<Array<{ name: string; comment: string | null; sysid: string }>>`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment,
             (SELECT system_identifier::text FROM pg_control_system()) AS sysid
      FROM pg_database WHERE datname = current_database()
    `;
    const row = identity[0];
    if (row?.name !== 'salon_vip_upgrade_gate20261031' || row.comment !== 'vip-upgrade-disposable:gate20261031' || row.sysid !== '7702523359876800547') {
      throw new Error('Refusing VIP upgrade preservation tests outside the prepared disposable database');
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps historical quantities readable and dispatchable, and does not reopen the list', async () => {
    const stored = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: submittedRequestId },
      include: { recipients: true },
    });
    expect(stored.requestedCount).toBe(30);
    expect(stored.status).toBe('SUBMITTED');
    expect(stored.recipients).toHaveLength(30);
    const list = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.nextReservationOpen).toBe(false);
    expect(list.status).toBe('IN_USE');
    expect(list.reservedBySalonId).toBe(salonId);
    expect(await prisma.client.auditLog.findUniqueOrThrow({ where: { id: auditId } })).toMatchObject({
      action: 'VIP_REQUEST_CREATED',
      resourceId: submittedRequestId,
    });
    expect(await prisma.client.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } })).toMatchObject({
      eventType: 'VipRequestCreated',
    });

    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Upgrade Ops',
      password: 'platform-admin-pass',
    });
    const dispatched = await request(app.getHttpServer())
      .post(`/admin/vip/requests/${submittedRequestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'upgrade-dispatch-once')
      .expect(201);
    expect(dispatched.body.status).toBe('MANUAL_QUEUED');
    expect(dispatched.body.requestedCount).toBe(30);
    const replay = await request(app.getHttpServer())
      .post(`/admin/vip/requests/${submittedRequestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'upgrade-dispatch-once')
      .expect(201);
    expect(replay.body.id).toBe(submittedRequestId);
    expect(await prisma.client.vipRequestRecipient.count({ where: { vipRequestId: submittedRequestId } })).toBe(30);

    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'upgrade-grant')
      .send({ salonId })
      .expect(201);
    const jwt = app.get(JwtService);
    const token = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    const duplicate = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'upgrade-duplicate')
      .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' });
    expect(duplicate.status).toBe(409);
    expect(await prisma.client.vipRequest.count({ where: { salonId, listId } })).toBe(1);
  });
});
