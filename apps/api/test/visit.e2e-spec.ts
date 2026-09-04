import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

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
    await request(app.getHttpServer()).get('/visits/not-a-real-id').expect(401);
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
    expect(history.body.map((row: { id: string }) => row.id)).toContain(created.body.id);

    await request(app.getHttpServer())
      .get(`/customers/${customerA}/visits`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    const otherHistory = await request(app.getHttpServer())
      .get(`/customers/${customerB}/visits`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(otherHistory.body.map((row: { id: string }) => row.id)).not.toContain(created.body.id);

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
    expect(history.body).toHaveLength(2);
    expect(history.body[0].id).toBe(staffVisit.body.id);
  });
});
