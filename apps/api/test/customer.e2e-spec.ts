import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

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
      .post('/customers')
      .send({ firstName: 'Sara', lastName: 'Ahmadi', phoneNumber: '09121234567' })
      .expect(401);
  });

  it('creates, searches, updates, and isolates customers by tenant', async () => {
    const salonA = await registerOwner('cust-a');
    const salonB = await registerOwner('cust-b');
    const phone = `0912${Date.now().toString().slice(-7)}`;

    const created = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        firstName: 'Sara',
        lastName: 'Ahmadi',
        phoneNumber: ` ${phone} `,
        salonId: salonB.tenantId,
      })
      .expect(400);

    expect(created.body.message).toBeDefined();

    const customer = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        firstName: 'Sara',
        lastName: 'Ahmadi',
        phoneNumber: ` ${phone} `,
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

    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(customer.body.id);

    const otherList = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(otherList.body.map((row: { id: string }) => row.id)).not.toContain(customer.body.id);

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
  });
});
