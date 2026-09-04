import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { createId } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Auth (e2e)', () => {
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

  it('rejects unauthenticated access to /auth/me', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('registers, logs in, and returns a server-derived tenant principal', async () => {
    const email = `owner-${Date.now()}@example.test`;
    const password = 'correct-horse-battery';

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Niloofar Salon',
        ownerName: 'Owner',
        email,
        password,
      })
      .expect(201);

    expect(registered.body.accessToken).toBeDefined();
    expect(registered.body.user.tenantId).toBeDefined();
    expect(registered.body.user.role).toBe('OWNER');

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);

    expect(me.body.userId).toBe(registered.body.user.id);
    expect(me.body.tenantId).toBe(registered.body.user.tenantId);
    expect(me.body.role).toBe('OWNER');

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(login.body.user.tenantId).toBe(registered.body.user.tenantId);
  });

  it('executes RolesGuard at runtime and rejects STAFF on an OWNER-only route', async () => {
    const ownerEmail = `owner-roles-${Date.now()}@example.test`;
    const password = 'correct-horse-battery';

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Roles Guard Salon',
        ownerName: 'Owner',
        email: ownerEmail,
        password,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/auth/owner')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);

    const staffEmail = `staff-roles-${Date.now()}@example.test`;
    await prisma.client.user.create({
      data: {
        id: createId(),
        salonId: registered.body.user.tenantId,
        name: 'Staff',
        email: staffEmail,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'STAFF',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    });

    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(201);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(200);

    const forbidden = await request(app.getHttpServer())
      .get('/auth/owner')
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(403);

    expect(forbidden.body.error).toBe('FORBIDDEN');
  });
});
