import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { ShutdownState } from '../src/infrastructure/observability/shutdown-state';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Phase B observability (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;

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

    const email = `phase-b-${Date.now()}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Phase B Salon',
        ownerName: 'Phase B Owner',
        email,
        password: 'correct-horse-battery',
      })
      .expect(201);
    ownerToken = response.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes a safe request id and generates one when the header is unsafe', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const accepted = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', id)
      .set('x-correlation-id', id)
      .expect(200);
    expect(accepted.headers['x-request-id']).toBe(id);
    expect(accepted.headers['x-correlation-id']).toBe(id);

    const generated = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'not-safe')
      .expect(200);
    expect(generated.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(generated.headers['x-request-id']).not.toBe('not-safe');
  });

  it('includes requestId on authenticated error responses', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    expect(response.body.error).toBe('NOT_FOUND');
    expect(response.body.requestId).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toMatch(/prisma|P20/i);
  });

  it('exposes process liveness and postgres-only readiness', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
    expect(ready.body.checks.postgres).toBe('up');
    expect(ready.body.checks.redis).toBeUndefined();
  });

  it('returns prometheus metrics without high-cardinality labels', async () => {
    await request(app.getHttpServer())
      .get('/salon')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(metrics.text).toContain('http_requests_total');
    expect(metrics.text).toContain('outbox_events');
    expect(metrics.text).not.toContain(ownerToken);
  });
});

describeIfDb('Phase B shutdown readiness (e2e)', () => {
  it('fails readiness after drain is marked', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    app.get(ShutdownState).markDraining();
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(ready.body.reason).toBe('shutting_down');
    await app.close();
    expect(app.get(PrismaService)).toBeDefined();
  });
});
