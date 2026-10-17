import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import {
  createPlatformAdminSession,
  createProductOwnerSession,
  loginWithPhone,
  staffRequest,
} from './support/phone-account';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Salon and users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerOwner(label: string) {
    const registered = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: `${label} Salon`,
      ownerName: `${label} Owner`,
      password,
    });

    return {
      token: registered.body.accessToken,
      userId: registered.body.user.id,
      tenantId: registered.body.user.tenantId,
    };
  }

  async function login(phone: string) {
    const response = await loginWithPhone(app.getHttpServer(), phone, password);
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  it('lets OWNER manage salon profile and records an audit event', async () => {
    const owner = await registerOwner('salon-profile');

    const profile = await request(app.getHttpServer())
      .get('/salon')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(profile.body.id).toBe(owner.tenantId);
    expect(profile.body.name).toBe('salon-profile Salon');

    const updated = await request(app.getHttpServer())
      .patch('/salon')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Updated Studio', phone: '02100000000', salonId: 'forged-tenant' })
      .expect(400);

    expect(updated.body.message).toBeDefined();

    const allowed = await request(app.getHttpServer())
      .patch('/salon')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Updated Studio', phone: '02100000000' })
      .expect(200);

    expect(allowed.body.name).toBe('Updated Studio');
    expect(allowed.body.phone).toBe('02100000000');

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: owner.tenantId,
        action: 'SALON_UPDATED',
        resourceId: owner.tenantId,
      },
    });
    expect(audit?.actorId).toBe(owner.userId);
    expect(JSON.stringify(audit?.metadata ?? {})).not.toMatch(/password|token|jwt/i);
  });

  it('enforces OWNER / MANAGER / STAFF authorization and tenant isolation', async () => {
    const salonA = await registerOwner('tenant-a');
    const salonB = await registerOwner('tenant-b');

    const managerEmail = `manager-${Date.now()}@example.test`;
    const staffEmail = `staff-${Date.now()}@example.test`;
    const manager = staffRequest({
      name: 'Manager A',
      email: managerEmail,
      password,
      role: 'MANAGER',
    });
    const staff = staffRequest({
      name: 'Staff A',
      email: staffEmail,
      password,
      role: 'STAFF',
    });

    const managerCreated = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send(manager)
      .expect(201);

    expect(managerCreated.body.passwordHash).toBeUndefined();
    expect(managerCreated.body.password).toBeUndefined();
    expect(managerCreated.body.role).toBe('MANAGER');

    const storedManager = await prisma.client.user.findUniqueOrThrow({
      where: { email: managerEmail },
    });
    expect(storedManager.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(storedManager.passwordHash, password)).toBe(true);

    const staffCreated = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send(staff)
      .expect(201);

    const managerToken = await login(manager.phone);
    const staffToken = await login(staff.phone);

    await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    const adminEmail = `salon-user-admin-${Date.now()}@example.test`;
    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Platform Admin',
      password,
      email: adminEmail,
    });
    const adminToken = admin.accessToken;
    expect(admin.body.accountKind).toBe('PLATFORM_ADMIN');
    expect(admin.body.admin.id).toBe(admin.adminId);
    await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ email: managerEmail }),
            expect.objectContaining({ email: staffEmail }),
          ]),
        );
        expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2id\$/);
      });

    await request(app.getHttpServer())
      .get('/salon')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch('/salon')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Hijack' })
      .expect(403);

    await request(app.getHttpServer())
      .patch('/salon')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Manager Hijack' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(
        staffRequest({
          name: 'Blocked',
          email: `blocked-${Date.now()}@example.test`,
          password,
          role: 'STAFF',
        }),
      )
      .expect(403);

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(
        staffRequest({
          name: 'Another Manager',
          email: `mgr2-${Date.now()}@example.test`,
          password,
          role: 'MANAGER',
        }),
      )
      .expect(403);

    const managerStaff = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(
        staffRequest({
          name: 'Staff From Manager',
          email: `staff-from-mgr-${Date.now()}@example.test`,
          password,
          role: 'STAFF',
        }),
      )
      .expect(201);
    expect(managerStaff.body.role).toBe('STAFF');

    await request(app.getHttpServer())
      .patch(`/users/${staffCreated.body.id}/role`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'MANAGER' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/users/${staffCreated.body.id}/role`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ role: 'OWNER' })
      .expect(403);

    const promoted = await request(app.getHttpServer())
      .patch(`/users/${staffCreated.body.id}/role`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ role: 'MANAGER' })
      .expect(200);
    expect(promoted.body.role).toBe('MANAGER');

    const roleAudit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'USER_ROLE_CHANGED',
        resourceId: staffCreated.body.id,
      },
    });
    expect(roleAudit?.actorId).toBe(salonA.userId);

    await request(app.getHttpServer())
      .patch(`/users/${managerCreated.body.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'DISABLED' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/users/${salonB.userId}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/users/${salonB.userId}/role`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ role: 'STAFF' })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/users/${salonB.userId}/status`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ status: 'DISABLED' })
      .expect(404);

    const salonBProfile = await request(app.getHttpServer())
      .get('/salon')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(salonBProfile.body.id).toBe(salonB.tenantId);
    expect(salonBProfile.body.name).not.toBe('Updated Studio');

    await request(app.getHttpServer())
      .patch(`/users/${salonA.userId}/role`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ role: 'STAFF' })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/users/${salonA.userId}/status`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ status: 'DISABLED' })
      .expect(409);

    const createAudit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'USER_CREATED',
        resourceId: managerCreated.body.id,
      },
    });
    expect(createAudit?.result).toBe('SUCCESS');
    expect(JSON.stringify(createAudit?.metadata ?? {})).not.toMatch(/password|argon2/i);
  });

  it('lets OWNER deactivate STAFF and rejects the disabled user on login', async () => {
    const owner = await registerOwner('deactivate');
    const staffBody = staffRequest({
      name: 'Soon Disabled',
      email: `disabled-${Date.now()}@example.test`,
      password,
      role: 'STAFF',
    });

    const staff = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.token}`)
      .send(staffBody)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/users/${staff.body.id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'DISABLED' })
      .expect(200);

    const statusAudit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: owner.tenantId,
        action: 'USER_STATUS_CHANGED',
        resourceId: staff.body.id,
      },
    });
    expect(statusAudit?.metadata).toMatchObject({ to: 'DISABLED' });

    await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: staffBody.phone, password })
      .expect(401);
  });

  it('keeps at least one OWNER when two owners demote each other concurrently', async () => {
    const ownerA = await registerOwner('owner-race');
    const ownerB = staffRequest({
      name: 'Second Owner',
      email: `owner-b-${Date.now()}@example.test`,
      password,
      role: 'OWNER',
    });
    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send(ownerB)
      .expect(201);
    const ownerBToken = await login(ownerB.phone);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/users/${created.body.id}/role`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ role: 'STAFF' }),
      request(app.getHttpServer())
        .patch(`/users/${ownerA.userId}/role`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ role: 'STAFF' }),
    ]);

    expect([200, 403, 409].includes(first.status)).toBe(true);
    expect([200, 403, 409].includes(second.status)).toBe(true);
    expect(first.status === 200 || second.status === 200).toBe(true);

    const owners = await prisma.client.user.count({
      where: { salonId: ownerA.tenantId, role: 'OWNER', status: 'ACTIVE' },
    });
    expect(owners).toBeGreaterThanOrEqual(1);
  });
});
