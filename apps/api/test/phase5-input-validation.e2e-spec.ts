import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Phase 5 input validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let salonId: string;
  let customerId: string;
  let serviceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Phase 5 validation salon',
        ownerName: 'Validation Owner',
        email: `phase5-${Date.now()}@example.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);
    token = response.body.accessToken as string;
    salonId = response.body.user.tenantId as string;
    const customer = await request(app.getHttpServer()).post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Sara', lastName: 'Validation', phoneNumber: `0912${Date.now().toString().slice(-7)}` })
      .expect(201);
    customerId = customer.body.id as string;
    const service = await request(app.getHttpServer()).post('/services')
      .set('Authorization', `Bearer ${token}`).send({ name: 'Phase 5 service' }).expect(201);
    serviceId = service.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an explicit null salon name before writing audit or outbox', async () => {
    const before = await prisma.client.salon.findUniqueOrThrow({ where: { id: salonId } });
    const audits = await prisma.client.auditLog.count({ where: { tenantId: salonId } });
    const events = await prisma.client.outboxEvent.count({ where: { tenantId: salonId } });
    const response = await request(app.getHttpServer())
      .patch('/salon')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: null });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect((await prisma.client.salon.findUniqueOrThrow({ where: { id: salonId } })).name).toBe(before.name);
    expect(await prisma.client.auditLog.count({ where: { tenantId: salonId } })).toBe(audits);
    expect(await prisma.client.outboxEvent.count({ where: { tenantId: salonId } })).toBe(events);
  });

  it('distinguishes omitted, clearable null, whitespace and wrong types on salon PATCH', async () => {
    const auth = `Bearer ${token}`;
    await request(app.getHttpServer()).patch('/salon').set('Authorization', auth)
      .send({ name: '  Phase 5 renamed  ', phone: '  02112345678  ' }).expect(200);
    const omitted = await request(app.getHttpServer()).patch('/salon').set('Authorization', auth)
      .send({ address: 'Tehran' }).expect(200);
    expect(omitted.body.name).toBe('Phase 5 renamed');
    expect(omitted.body.phone).toBe('02112345678');
    const cleared = await request(app.getHttpServer()).patch('/salon').set('Authorization', auth)
      .send({ phone: null, address: null }).expect(200);
    expect(cleared.body.phone).toBeNull();
    expect(cleared.body.address).toBeNull();
    for (const name of ['   ', [], {}, true]) {
      const result = await request(app.getHttpServer()).patch('/salon').set('Authorization', auth)
        .send({ name }).expect(400);
      expect(result.body.error).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects null and wrong types on customer and service PATCH without changing rows', async () => {
    const auth = `Bearer ${token}`;
    for (const body of [{ firstName: null }, { firstName: {} }, { phoneNumber: false }]) {
      await request(app.getHttpServer()).patch(`/customers/${customerId}`)
        .set('Authorization', auth).send(body).expect(400);
    }
    for (const body of [{ name: null }, { name: '   ' }, { status: null }]) {
      await request(app.getHttpServer()).patch(`/services/${serviceId}`)
        .set('Authorization', auth).send(body).expect(400);
    }
    expect((await prisma.client.customer.findUniqueOrThrow({ where: { id: customerId } })).firstName).toBe('Sara');
    expect((await prisma.client.service.findUniqueOrThrow({ where: { id: serviceId } })).name).toBe('Phase 5 service');
  });

  it('bounds money before idempotency or business writes and accepts the maximum', async () => {
    const auth = `Bearer ${token}`;
    const base = {
      customerId, occurredAt: '2024-02-29T10:00:00+03:30',
      amount: '99999999999999999.99',
      items: [{ serviceId, quantity: 1, unitPrice: '99999999999999999.99' }],
    };
    const before = {
      transactions: await prisma.client.ledgerTransaction.count({ where: { salonId } }),
      audits: await prisma.client.auditLog.count({ where: { tenantId: salonId } }),
      events: await prisma.client.outboxEvent.count({ where: { tenantId: salonId } }),
      claims: await prisma.client.idempotencyRecord.count({ where: { tenantId: salonId } }),
    };
    const invalid = [
      { ...base, amount: '100000000000000000.00' },
      { ...base, amount: '1.001' },
      { ...base, items: [{ serviceId, quantity: 2, unitPrice: base.amount }] },
      { ...base, items: [{ serviceId, quantity: '1', unitPrice: base.amount }] },
      { ...base, occurredAt: '2024-02-30T10:00:00Z' },
      { ...base, occurredAt: '2024-02-29T10:00:00' },
    ];
    for (const payload of invalid) {
      const result = await request(app.getHttpServer()).post('/transactions')
        .set('Authorization', auth).set('Idempotency-Key', 'phase5-corrected-money')
        .send(payload).expect(400);
      expect(result.body.error).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.client.ledgerTransaction.count({ where: { salonId } })).toBe(before.transactions);
    expect(await prisma.client.auditLog.count({ where: { tenantId: salonId } })).toBe(before.audits);
    expect(await prisma.client.outboxEvent.count({ where: { tenantId: salonId } })).toBe(before.events);
    expect(await prisma.client.idempotencyRecord.count({ where: { tenantId: salonId } })).toBe(before.claims);
    const created = await request(app.getHttpServer()).post('/transactions')
      .set('Authorization', auth).set('Idempotency-Key', 'phase5-corrected-money')
      .send(base).expect(201);
    expect(created.body.amount).toBe(base.amount);
  });

  it('rejects malformed cursor encoding, timestamp and identifier with a validation envelope', async () => {
    const auth = `Bearer ${token}`;
    const malformed = ['@@@', Buffer.from('bad').toString('base64url'),
      Buffer.from('2024-02-30T10:00:00Z\n' + customerId).toString('base64url'),
      Buffer.from('2024-02-29T10:00:00Z\nnot-a-uuid').toString('base64url')];
    for (const cursor of malformed) {
      const result = await request(app.getHttpServer()).get('/transactions')
        .set('Authorization', auth).query({ cursor }).expect(400);
      expect(result.body.error).toBe('VALIDATION_ERROR');
    }
    await request(app.getHttpServer()).get('/visits').set('Authorization', auth)
      .query({ date: '2024-02-30' }).expect(400);
    await request(app.getHttpServer()).get('/visits').set('Authorization', auth)
      .query({ date: '2024-02-29' }).expect(200);
  });
});
