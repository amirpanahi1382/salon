import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Phase A reliability (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: { email: string; token: string; tenantId: string; userId: string };

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
    owner = await registerOwner('phase-a');
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

  it('returns NOT_FOUND for a well-formed UUID that does not exist', async () => {
    const missing = '11111111-1111-4111-8111-111111111111';
    const response = await request(app.getHttpServer())
      .get(`/customers/${missing}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
    expect(response.body.error).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toMatch(/prisma|P20/i);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ customerId: missing, visitedAt: '2026-07-01T10:00:00.000Z' })
      .expect(404);
  });

  it('rejects invalid UUID path parameters with VALIDATION_ERROR', async () => {
    const invalid = await request(app.getHttpServer())
      .get('/customers/not-a-real-id')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
    expect(invalid.body.error).toBe('VALIDATION_ERROR');

    await request(app.getHttpServer())
      .get('/visits/not-a-uuid')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
  });

  it('replays the same visit for the same Idempotency-Key and rejects key reuse with a different payload', async () => {
    const customerId = await createCustomer(owner.token, 'Idem');
    const payload = { customerId, visitedAt: '2026-07-01T10:00:00.000Z' };

    const first = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', 'visit-retry-key-01')
      .send(payload)
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', 'visit-retry-key-01')
      .send(payload)
      .expect(201);

    expect(replay.body.id).toBe(first.body.id);

    const visits = await prisma.client.visit.findMany({
      where: { salonId: owner.tenantId, customerId },
    });
    expect(visits).toHaveLength(1);

    const events = await prisma.client.outboxEvent.findMany({
      where: { tenantId: owner.tenantId, eventType: 'VisitCompleted' },
    });
    expect(events.filter((event) => (event.payload as { visitId?: string }).visitId === first.body.id)).toHaveLength(
      1,
    );

    const conflict = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', 'visit-retry-key-01')
      .send({ customerId, visitedAt: '2026-07-01T11:00:00.000Z' })
      .expect(409);
    expect(conflict.body.error).toBe('CONFLICT');

    const secondKey = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', 'visit-retry-key-02')
      .send(payload)
      .expect(201);
    expect(secondKey.body.id).not.toBe(first.body.id);
  });

  it('creates exactly one visit when the same idempotency key races', async () => {
    const customerId = await createCustomer(owner.token, 'Race');
    const payload = { customerId, visitedAt: '2026-06-15T08:00:00.000Z' };

    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post('/visits')
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', 'same-race-key-aa')
          .send(payload),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    expect(created.length).toBe(3);
    const ids = new Set(created.map((response) => response.body.id as string));
    expect(ids.size).toBe(1);

    const visits = await prisma.client.visit.findMany({
      where: { salonId: owner.tenantId, customerId },
    });
    expect(visits).toHaveLength(1);
  });

  it('maps concurrent visit delete and customer delete without a 500', async () => {
    const customerId = await createCustomer(owner.token, 'Both');
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ customerId, visitedAt: '2026-03-01T10:00:00.000Z' })
      .expect(201);

    const [visitDel, customerDel] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/visits/${visit.body.id}`)
        .set('Authorization', `Bearer ${owner.token}`),
      request(app.getHttpServer())
        .delete(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${owner.token}`),
    ]);

    expect(visitDel.status).not.toBe(500);
    expect(customerDel.status).not.toBe(500);
    expect([204, 404, 409]).toContain(visitDel.status);
    expect([204, 404]).toContain(customerDel.status);
  });

  it('maps customer-delete vs visit-create races to 404 instead of 500', async () => {
    const customerId = await createCustomer(owner.token, 'Gone');

    const [visitRes, deleteRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/visits')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerId, visitedAt: '2026-05-01T10:00:00.000Z' }),
      request(app.getHttpServer())
        .delete(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${owner.token}`),
    ]);

    expect([201, 404]).toContain(visitRes.status);
    expect(visitRes.status).not.toBe(500);
    expect([204, 404]).toContain(deleteRes.status);

    if (visitRes.status === 201 && deleteRes.status === 204) {
      await request(app.getHttpServer())
        .get(`/visits/${visitRes.body.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
    }
  });

  it('lets only one of two concurrent duplicate-phone creates succeed', async () => {
    const phone = `0912${Date.now().toString().slice(-7)}`.slice(0, 11);

    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/customers')
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ firstName: 'Sara', lastName: 'Dup', phoneNumber: phone }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    const customers = await prisma.client.customer.findMany({
      where: { salonId: owner.tenantId, phoneNumber: phone },
    });
    expect(customers).toHaveLength(1);
  });

  it('treats repeated customer and visit deletes as 404 after the first success', async () => {
    const customerId = await createCustomer(owner.token, 'Repeat');
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ customerId, visitedAt: '2026-04-01T10:00:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/visits/${visit.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/visits/${visit.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
  });

  it('returns the same generic login error for missing users and wrong passwords', async () => {
    const missing = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `missing-${Date.now()}@example.test`, password })
      .expect(401);
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: owner.email, password: 'wrong-password-1' })
      .expect(401);
    expect(missing.body.error).toBe('UNAUTHENTICATED');
    expect(wrong.body.error).toBe('UNAUTHENTICATED');
    expect(missing.body.message).toBe(wrong.body.message);
  });
});
