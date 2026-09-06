import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listItems } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describeIfDb('Intelligence (e2e)', () => {
  let app: INestApplication;

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
      email,
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

  async function recordVisit(token: string, customerId: string, visitedAt: string) {
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, visitedAt })
      .expect(201);
  }

  it('rejects unauthenticated intelligence access', async () => {
    await request(app.getHttpServer()).get('/intelligence/summary').expect(401);
    await request(app.getHttpServer()).get('/intelligence/opportunities').expect(401);
    await request(app.getHttpServer()).get('/intelligence/segments').expect(401);
  });

  it('derives visit-based status, opportunities, and tenant isolation', async () => {
    const salonA = await registerOwner('intel-a');
    const salonB = await registerOwner('intel-b');

    const newCustomer = await createCustomer(salonA.token, 'New');
    const activeCustomer = await createCustomer(salonA.token, 'Active');
    const returningCustomer = await createCustomer(salonA.token, 'Returning');
    const atRiskCustomer = await createCustomer(salonA.token, 'AtRisk');
    const inactiveCustomer = await createCustomer(salonA.token, 'Inactive');
    const otherCustomer = await createCustomer(salonB.token, 'Other');

    await recordVisit(salonA.token, activeCustomer, daysAgoIso(5));
    await recordVisit(salonA.token, returningCustomer, daysAgoIso(40));
    await recordVisit(salonA.token, returningCustomer, daysAgoIso(5));
    await recordVisit(salonA.token, atRiskCustomer, daysAgoIso(87));
    await recordVisit(salonA.token, atRiskCustomer, daysAgoIso(52));
    await recordVisit(salonA.token, inactiveCustomer, daysAgoIso(115));
    await recordVisit(salonA.token, inactiveCustomer, daysAgoIso(80));
    await recordVisit(salonB.token, otherCustomer, daysAgoIso(87));
    await recordVisit(salonB.token, otherCustomer, daysAgoIso(52));

    const newIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${newCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(newIntel.body.status).toBe('NEW');
    expect(newIntel.body.behavior.visitCount).toBe(0);
    expect(newIntel.body).not.toHaveProperty('phoneNumber');

    const activeIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${activeCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(activeIntel.body.status).toBe('ACTIVE');

    const returningIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${returningCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(returningIntel.body.status).toBe('RETURNING');

    const atRiskIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${atRiskCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(atRiskIntel.body.status).toBe('AT_RISK');
    expect(atRiskIntel.body.opportunities[0].type).toBe('REACTIVATION');
    expect(atRiskIntel.body.explanation).toMatch(/past the expected return window/i);

    const inactiveIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${inactiveCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(inactiveIntel.body.status).toBe('INACTIVE');

    await request(app.getHttpServer())
      .get(`/intelligence/customers/${otherCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/intelligence/customers/${atRiskCustomer}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    const summary = await request(app.getHttpServer())
      .get('/intelligence/summary')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(summary.body).toMatchObject({
      customers: 5,
      new: 1,
      active: 1,
      returning: 1,
      atRisk: 1,
      inactive: 1,
      reactivationOpportunities: 2,
      customerReturnOpportunities: 0,
      hasMore: false,
    });

    const opportunities = await request(app.getHttpServer())
      .get('/intelligence/opportunities')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const opportunityIds = listItems<{ customerId: string }>(opportunities.body).map(
      (item) => item.customerId,
    );
    expect(opportunityIds).toEqual(expect.arrayContaining([atRiskCustomer, inactiveCustomer]));
    expect(opportunityIds).not.toContain(otherCustomer);
    expect(JSON.stringify(opportunities.body)).not.toMatch(/phone/i);

    const reactivationOnly = await request(app.getHttpServer())
      .get('/intelligence/opportunities?type=REACTIVATION')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(reactivationOnly.body)).toHaveLength(2);

    const atRiskSegment = await request(app.getHttpServer())
      .get('/intelligence/segments?status=AT_RISK')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(atRiskSegment.body)).toHaveLength(1);
    expect(listItems<{ customerId: string }>(atRiskSegment.body)[0].customerId).toBe(atRiskCustomer);

    const salonBOpportunities = await request(app.getHttpServer())
      .get('/intelligence/opportunities')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(listItems(salonBOpportunities.body)).toHaveLength(1);
    expect(listItems<{ customerId: string }>(salonBOpportunities.body)[0].customerId).toBe(otherCustomer);

    const staffEmail = `staff-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({
        name: 'Staff Member',
        email: staffEmail,
        password,
        role: 'STAFF',
      })
      .expect(201);
    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(201);

    await request(app.getHttpServer())
      .get('/intelligence/summary')
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(200);
  });
});
