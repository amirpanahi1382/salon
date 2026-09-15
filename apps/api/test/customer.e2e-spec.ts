import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { encodeCursor } from '../src/infrastructure/http/list-page';
import { listItems, listPage } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Customers (e2e)', () => {
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
    const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: `${label} Salon`,
        ownerName: `${label} Owner`,
        email,
        password,
      })
      .expect(201);

    return {
      email,
      token: response.body.accessToken as string,
      userId: response.body.user.id as string,
      tenantId: response.body.user.tenantId as string,
    };
  }

  it('rejects unauthenticated customer access', async () => {
    await request(app.getHttpServer()).get('/customers').expect(401);
    await request(app.getHttpServer())
      .get('/customers/11111111-1111-4111-8111-111111111111/activity')
      .expect(401);
    await request(app.getHttpServer())
      .post('/customers')
      .send({ firstName: 'Sara', lastName: 'Ahmadi', phoneNumber: '09121234567' })
      .expect(401);
    await request(app.getHttpServer()).delete('/customers/not-a-real-id').expect(401);
  });

  it('creates, searches, updates, and isolates customers by tenant', async () => {
    const salonA = await registerOwner('cust-a');
    const salonB = await registerOwner('cust-b');
    const phone = `0912${Date.now().toString().slice(-7)}`;

    const forbiddenSalonId = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        firstName: 'Sara',
        lastName: 'Ahmadi',
        phoneNumber: phone,
        salonId: salonB.tenantId,
      })
      .expect(400);

    expect(forbiddenSalonId.body.message).toBeDefined();

    const customer = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        firstName: 'Sara',
        lastName: 'Ahmadi',
        phoneNumber: phone,
      })
      .expect(201);

    expect(customer.body.firstName).toBe('Sara');
    expect(customer.body.phoneNumber).toBe(phone);
    expect(customer.body.salonId).toBeUndefined();

    await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        firstName: 'Sara',
        lastName: 'Duplicate',
        phoneNumber: phone,
      })
      .expect(409);

    const otherSalonSamePhone = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonB.token}`)
      .send({
        firstName: 'Sara',
        lastName: 'OtherSalon',
        phoneNumber: phone,
      })
      .expect(201);
    expect(otherSalonSamePhone.body.id).not.toBe(customer.body.id);

    const listed = await request(app.getHttpServer())
      .get('/customers')
      .query({ q: 'Ahmadi' })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);

    expect(listItems(listed.body)).toHaveLength(1);
    expect(listItems<{ id: string }>(listed.body)[0].id).toBe(customer.body.id);

    const secondSearch = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        firstName: 'Ali',
        lastName: 'Ahmadi',
        phoneNumber: `0935${Date.now().toString().slice(-7)}`,
      })
      .expect(201);
    const qPage = listPage<{ id: string; lastName: string; createdAt: string }>(
      (
        await request(app.getHttpServer())
          .get('/customers')
          .query({ q: 'Ahmadi' })
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(qPage.items).toHaveLength(2);
    const newest = qPage.items[0]!;
    const cursor = encodeCursor([newest.createdAt, newest.id]);
    const cursorOnly = listPage<{ id: string }>(
      (
        await request(app.getHttpServer())
          .get('/customers')
          .query({ cursor })
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(cursorOnly.items.map((row) => row.id)).not.toContain(newest.id);
    const qAndCursor = listPage<{ id: string; lastName: string }>(
      (
        await request(app.getHttpServer())
          .get('/customers')
          .query({ q: 'Ahmadi', cursor })
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(qAndCursor.items.every((row) => row.lastName === 'Ahmadi')).toBe(true);
    expect(qAndCursor.items.map((row) => row.id)).not.toContain(newest.id);
    const otherTenant = listPage<{ id: string }>(
      (
        await request(app.getHttpServer())
          .get('/customers')
          .query({ q: 'Ahmadi', cursor })
          .set('Authorization', `Bearer ${salonB.token}`)
          .expect(200)
      ).body,
    );
    expect(otherTenant.items.map((row) => row.id)).not.toContain(customer.body.id);
    expect(otherTenant.items.map((row) => row.id)).not.toContain(secondSearch.body.id);

    const otherList = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(listItems<{ id: string }>(otherList.body).map((row) => row.id)).not.toContain(customer.body.id);

    await request(app.getHttpServer())
      .get(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .send({ lastName: 'Hijack' })
      .expect(404);

    const updated = await request(app.getHttpServer())
      .patch(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ lastName: 'Karimi' })
      .expect(200);
    expect(updated.body.lastName).toBe('Karimi');

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'CUSTOMER_CREATED',
        resourceId: customer.body.id,
      },
    });
    expect(audit?.actorId).toBe(salonA.userId);
    expect(JSON.stringify(audit ?? {})).not.toMatch(/0912/);

    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: customer.body.id, visitedAt: '2026-08-01T10:00:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/visits/${visit.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/intelligence/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);

    const deletedAudit = await prisma.client.auditLog.findFirst({
      where: { tenantId: salonA.tenantId, action: 'CUSTOMER_DELETED', resourceId: customer.body.id },
    });
    expect(deletedAudit?.actorId).toBe(salonA.userId);
  });

  it('lets STAFF create and view customers but not update them', async () => {
    const owner = await registerOwner('cust-staff');
    const staffEmail = `staff-cust-${Date.now()}@example.test`;

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        name: 'Staff',
        email: staffEmail,
        password,
        role: 'STAFF',
      })
      .expect(201);

    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .send({
        firstName: 'Niloofar',
        lastName: 'StaffCreated',
        phoneNumber: `0935${Date.now().toString().slice(-7)}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .send({ lastName: 'Blocked' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(403);

    const managerEmail = `mgr-cust-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: managerEmail, password })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
      .expect(204);
  });

  it('rejects non-canonical phone numbers on create', async () => {
    const owner = await registerOwner('cust-phone');
    const invalidPhones = [
      '9121111111',
      '+989121111111',
      '00989121111111',
      '0912 111 1111',
      '0912-111-1111',
      '0912111111',
      '091211111111',
      '981211111111',
      ' 09121111111',
      '09121111111 ',
      '',
    ];

    for (const phoneNumber of invalidPhones) {
      const response = await request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ firstName: 'Sara', lastName: 'Ahmadi', phoneNumber })
        .expect(400);
      expect(JSON.stringify(response.body.message)).toMatch(/phone|11 digits|must be longer/i);
    }

    await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ firstName: 'Sara', lastName: 'Ahmadi', phoneNumber: null })
      .expect(400);

    const valid = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ firstName: 'سارا', lastName: 'احمدی', phoneNumber: '09121111111' })
      .expect(201);
    expect(valid.body.phoneNumber).toBe('09121111111');
    expect(valid.body.firstName).toBe('سارا');

    await request(app.getHttpServer())
      .patch(`/customers/${valid.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phoneNumber: ' 09121111111' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/customers/${valid.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phoneNumber: '09121111111 ' })
      .expect(400);

    const updated = await request(app.getHttpServer())
      .patch(`/customers/${valid.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phoneNumber: '09121111112' })
      .expect(200);
    expect(updated.body.phoneNumber).toBe('09121111112');
  });
});
