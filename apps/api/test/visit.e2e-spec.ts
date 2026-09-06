import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listItems, listPage } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Visits (e2e)', () => {
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
      token: response.body.accessToken as string,
      tenantId: response.body.user.tenantId as string,
      userId: response.body.user.id as string,
    };
  }

  async function createCustomer(token: string, lastName: string) {
    const phone = `0912${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 9)}`;
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Sara',
        lastName,
        phoneNumber: phone.slice(0, 11),
      })
      .expect(201);
    return response.body.id as string;
  }

  async function loginAs(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.accessToken as string;
  }

  it('rejects unauthenticated visit access', async () => {
    await request(app.getHttpServer()).post('/visits').send({}).expect(401);
    await request(app.getHttpServer()).get('/visits').expect(401);
    await request(app.getHttpServer()).get('/visits/not-a-real-id').expect(401);
    await request(app.getHttpServer()).delete('/visits/not-a-real-id').expect(401);
  });

  it('records completed visits, history, outbox, and tenant isolation', async () => {
    const salonA = await registerOwner('visit-a');
    const salonB = await registerOwner('visit-b');
    const customerA = await createCustomer(salonA.token, 'Ahmadi');
    const customerB = await createCustomer(salonB.token, 'Other');

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: customerA,
        visitedAt: '2026-09-01T10:00:00.000Z',
        salonId: salonB.tenantId,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: 'not-a-uuid',
        visitedAt: '2026-09-01T10:00:00.000Z',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: customerA,
        visitedAt: 'not-a-date',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: customerA,
        visitedAt: '2099-01-01T10:00:00.000Z',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: '00000000-0000-4000-8000-000000000000',
        visitedAt: '2026-09-01T10:00:00.000Z',
      })
      .expect(404);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: customerB,
        visitedAt: '2026-09-01T10:00:00.000Z',
      })
      .expect(404);

    const created = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        customerId: customerA,
        visitedAt: '2026-09-01T10:00:00.000Z',
      })
      .expect(201);

    expect(created.body.customerId).toBe(customerA);
    expect(created.body.visitedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(created.body.salonId).toBeUndefined();

    const fetched = await request(app.getHttpServer())
      .get(`/visits/${created.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(fetched.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .get(`/visits/${created.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    const history = await request(app.getHttpServer())
      .get(`/customers/${customerA}/visits`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems<{ id: string }>(history.body).map((row) => row.id)).toContain(created.body.id);

    await request(app.getHttpServer())
      .get(`/customers/${customerA}/visits`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    const otherHistory = await request(app.getHttpServer())
      .get(`/customers/${customerB}/visits`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(listItems<{ id: string }>(otherHistory.body).map((row) => row.id)).not.toContain(created.body.id);

    const outbox = await prisma.client.outboxEvent.findMany({
      where: {
        tenantId: salonA.tenantId,
        eventType: 'VisitCompleted',
      },
    });
    expect(
      outbox.some((event) => {
        const payload = event.payload as { visitId?: string };
        return payload.visitId === created.body.id;
      }),
    ).toBe(true);

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'VISIT_CREATED',
        resourceId: created.body.id,
      },
    });
    expect(audit?.result).toBe('SUCCESS');

    const customerKarimi = await createCustomer(salonA.token, 'Karimi');
    const first = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: customerA, visitedAt: '2026-08-05T10:00:00.000Z' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: customerA, visitedAt: '2026-08-05T15:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: customerKarimi, visitedAt: '2026-08-04T12:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonB.token}`)
      .send({ customerId: customerB, visitedAt: '2026-08-05T11:00:00.000Z' })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const listedItems = listItems<{ id: string }>(listed.body);
    expect(listedItems).toHaveLength(4);
    expect(listedItems[0].id).toBe(created.body.id);
    expect(listedItems.map((row) => row.id)).toContain(second.body.id);

    const otherList = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(listItems<{ id: string }>(otherList.body)).toHaveLength(1);
    expect(listItems<{ id: string }>(otherList.body).map((row) => row.id)).not.toContain(created.body.id);

    const byDate = await request(app.getHttpServer())
      .get('/visits')
      .query({ date: '2026-08-05' })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(byDate.body)).toHaveLength(2);

    const byCustomer = await request(app.getHttpServer())
      .get('/visits')
      .query({ customerId: customerA })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(byCustomer.body)).toHaveLength(3);

    const combined = await request(app.getHttpServer())
      .get('/visits')
      .query({ date: '2026-08-05', customerId: customerA })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(combined.body)).toHaveLength(2);

    const limited = await request(app.getHttpServer())
      .get('/visits')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const limitedPage = listPage<{ id: string }>(limited.body);
    expect(limitedPage.items).toHaveLength(1);
    expect(limitedPage.hasMore).toBe(true);
    expect(limitedPage.items[0].id).toBe(created.body.id);

    await request(app.getHttpServer())
      .get('/visits')
      .query({ limit: 201 })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/visits')
      .query({ date: '05-09-2026' })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/visits')
      .query({ customerId: customerB })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);

    const before = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(before.body.behavior.visitCount).toBe(3);

    await request(app.getHttpServer())
      .delete(`/visits/${first.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/visits/${first.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/visits/${first.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);

    const historyAfterDelete = await request(app.getHttpServer())
      .get(`/customers/${customerA}/visits`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems<{ id: string }>(historyAfterDelete.body).map((row) => row.id)).not.toContain(first.body.id);

    const afterList = await request(app.getHttpServer())
      .get('/visits')
      .query({ customerId: customerA })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(afterList.body)).toHaveLength(2);

    const after = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(after.body.behavior.visitCount).toBe(2);

    const deletedAudit = await prisma.client.auditLog.findFirst({
      where: { tenantId: salonA.tenantId, action: 'VISIT_DELETED', resourceId: first.body.id },
    });
    expect(deletedAudit?.result).toBe('SUCCESS');
    expect(JSON.stringify(deletedAudit ?? {})).not.toMatch(/0912/);

    const deletedOutbox = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salonA.tenantId, eventType: 'VisitDeleted' },
    });
    expect(
      deletedOutbox.some((event) => (event.payload as { visitId?: string }).visitId === first.body.id),
    ).toBe(true);

    await request(app.getHttpServer())
      .delete(`/visits/${first.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);
  });

  it('lets MANAGER and STAFF record completed visits', async () => {
    const owner = await registerOwner('visit-roles');
    const customerId = await createCustomer(owner.token, 'Roles');
    const managerEmail = `mgr-visit-${Date.now()}@example.test`;
    const staffEmail = `staff-visit-${Date.now()}@example.test`;

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);

    const managerToken = await loginAs(managerEmail);
    const staffToken = await loginAs(staffEmail);

    const managerVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ customerId, visitedAt: '2026-08-01T09:00:00.000Z' })
      .expect(201);

    const staffVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerId, visitedAt: '2026-08-15T09:00:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/visits/${managerVisit.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    const history = await request(app.getHttpServer())
      .get(`/customers/${customerId}/visits`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(listItems(history.body)).toHaveLength(2);
    expect(listItems<{ id: string }>(history.body)[0].id).toBe(staffVisit.body.id);

    await request(app.getHttpServer())
      .delete(`/visits/${staffVisit.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/visits/${staffVisit.body.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(204);
  });
});
