import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listItems, listPage } from './list-page';
import { formatJalaliDateTimeTehran } from '../src/visit/jalali-format';
import { VISIT_EXPORT_HEADERS, VISIT_EXPORT_SHEET_NAME } from '../src/visit/visit-export.constants';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Visit list enrichment and Excel export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
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
      tenantId: response.body.user.tenantId as string,
      userId: response.body.user.id as string,
    };
  }

  async function createCustomer(token: string, firstName: string, lastName: string) {
    const phone = `0912${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11);
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName, lastName, phoneNumber: phone })
      .expect(201);
    return response.body.id as string;
  }

  async function createService(token: string, name: string) {
    const response = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return { id: response.body.id as string, name: response.body.name as string };
  }

  async function login(email: string) {
    return (
      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)
    ).body.accessToken as string;
  }

  async function completeSale(
    token: string,
    body: { customerId: string; visitedAt: string; serviceId: string; amount: string },
  ) {
    return request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, currency: 'IRR' })
      .expect(201);
  }

  it('enriches visit lists for OWNER/MANAGER/STAFF and exports a tenant-scoped Persian workbook', async () => {
    const salonA = await registerOwner('vexp-a');
    const salonB = await registerOwner('vexp-b');
    const customerA = await createCustomer(salonA.token, 'Maryam', 'Ahmadi');
    const customerB = await createCustomer(salonA.token, 'Sara', 'Karimi');
    const otherCustomer = await createCustomer(salonB.token, 'Other', 'Salon');
    const hair = await createService(salonA.token, `Hair ${Date.now()}`);
    const nail = await createService(salonA.token, `Nail ${Date.now()}`);
    const otherService = await createService(salonB.token, `Other ${Date.now()}`);

    const staffEmail = `staff-vexp-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const staffToken = await login(staffEmail);

    const managerEmail = `mgr-vexp-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const managerToken = await login(managerEmail);

    const visitOnly = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerId: customerA, visitedAt: '2026-01-01T10:00:00.000Z' })
      .expect(201);

    const saleJan11 = await completeSale(salonA.token, {
      customerId: customerA,
      visitedAt: '2026-01-11T10:00:00.000Z',
      serviceId: hair.id,
      amount: '8000000.00',
    });
    const saleFeb10 = await completeSale(salonA.token, {
      customerId: customerA,
      visitedAt: '2026-02-10T10:00:00.000Z',
      serviceId: nail.id,
      amount: '1500000.00',
    });
    await completeSale(salonA.token, {
      customerId: customerB,
      visitedAt: '2026-01-11T12:00:00.000Z',
      serviceId: hair.id,
      amount: '200.00',
    });
    await completeSale(salonB.token, {
      customerId: otherCustomer,
      visitedAt: '2026-01-11T10:00:00.000Z',
      serviceId: otherService.id,
      amount: '999.00',
    });

    const voidedSale = await completeSale(salonA.token, {
      customerId: customerA,
      visitedAt: '2026-03-01T10:00:00.000Z',
      serviceId: hair.id,
      amount: '50.00',
    });
    await request(app.getHttpServer())
      .post(`/transactions/${voidedSale.body.transaction.id}/void`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(201);

    const txCountBefore = await prisma.client.ledgerTransaction.count({
      where: { salonId: salonA.tenantId },
    });

    for (const token of [salonA.token, managerToken, staffToken]) {
      const listed = await request(app.getHttpServer())
        .get('/visits')
        .query({ customerId: customerA })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const items = listItems<{
        id: string;
        firstName: string;
        lastName: string;
        serviceName: string | null;
        amountReceived: string | null;
      }>(listed.body);
      expect(items).toHaveLength(4);
      const byId = Object.fromEntries(items.map((row) => [row.id, row]));
      expect(byId[visitOnly.body.id]).toMatchObject({
        firstName: 'Maryam',
        lastName: 'Ahmadi',
        serviceName: null,
        amountReceived: null,
      });
      expect(byId[saleJan11.body.visit.id]).toMatchObject({
        serviceName: hair.name,
        amountReceived: '8000000.00',
      });
      expect(byId[saleFeb10.body.visit.id]).toMatchObject({
        serviceName: nail.name,
        amountReceived: '1500000.00',
      });
      expect(byId[voidedSale.body.visit.id]).toMatchObject({
        serviceName: hair.name,
        amountReceived: null,
      });
      expect(items.every((row) => row.serviceName !== otherService.name)).toBe(true);
    }

    await request(app.getHttpServer()).get('/visits/export').expect(401);

    const leaked = await request(app.getHttpServer())
      .get('/visits/export')
      .set('Authorization', `Bearer ${salonA.token}`)
      .query({ customerId: otherCustomer })
      .expect(404);
    expect(leaked.body).toBeDefined();

    const otherExport = await request(app.getHttpServer())
      .get('/visits/export')
      .set('Authorization', `Bearer ${salonB.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(200);
    const otherBook = new ExcelJS.Workbook();
    await otherBook.xlsx.load(otherExport.body as Buffer);
    const otherSheet = otherBook.getWorksheet(VISIT_EXPORT_SHEET_NAME);
    expect(otherSheet?.getRow(2).getCell(1).value).toBe('Other Salon');
    expect(otherSheet?.rowCount).toBe(2);

    const exported = await request(app.getHttpServer())
      .get('/visits/export')
      .query({ customerId: customerA })
      .set('Authorization', `Bearer ${salonA.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(200);

    expect(String(exported.headers['content-type'])).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    const sheet = workbook.getWorksheet(VISIT_EXPORT_SHEET_NAME);
    expect(sheet).toBeDefined();
    expect(sheet!.views?.[0]?.rightToLeft).toBe(true);
    expect(sheet!.getRow(1).font?.name).toBe('Tahoma');
    expect(sheet!.getRow(1).font?.bold).toBe(true);
    expect(VISIT_EXPORT_HEADERS.map((_, index) => String(sheet!.getRow(1).getCell(index + 1).value))).toEqual([
      ...VISIT_EXPORT_HEADERS,
    ]);

    const names: string[] = [];
    const daysByVisitedAt = new Map<string, number | null>();
    const amounts = new Map<string, number | null>();
    const services = new Map<string, string | null>();
    sheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      const name = String(row.getCell(1).value);
      names.push(name);
      expect(name).not.toBe('Other Salon');
      const visitedAt = String(row.getCell(4).value);
      daysByVisitedAt.set(visitedAt, (row.getCell(5).value as number | null) ?? null);
      amounts.set(visitedAt, (row.getCell(3).value as number | null) ?? null);
      services.set(visitedAt, (row.getCell(2).value as string | null) ?? null);
    });
    expect(names.every((name) => name === 'Maryam Ahmadi')).toBe(true);
    expect(daysByVisitedAt.get(formatJalaliDateTimeTehran(new Date('2026-01-01T10:00:00.000Z')))).toBeNull();
    expect(daysByVisitedAt.get(formatJalaliDateTimeTehran(new Date('2026-01-11T10:00:00.000Z')))).toBe(10);
    expect(daysByVisitedAt.get(formatJalaliDateTimeTehran(new Date('2026-02-10T10:00:00.000Z')))).toBe(30);
    expect(amounts.get(formatJalaliDateTimeTehran(new Date('2026-01-11T10:00:00.000Z')))).toBe(8000000);
    expect(amounts.get(formatJalaliDateTimeTehran(new Date('2026-03-01T10:00:00.000Z')))).toBeNull();
    expect(services.get(formatJalaliDateTimeTehran(new Date('2026-01-11T10:00:00.000Z')))).toBe(hair.name);
    expect(services.get(formatJalaliDateTimeTehran(new Date('2026-02-10T10:00:00.000Z')))).toBe(nail.name);

    const january = await request(app.getHttpServer())
      .get('/visits/export')
      .query({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' })
      .set('Authorization', `Bearer ${salonA.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(200);
    const janBook = new ExcelJS.Workbook();
    await janBook.xlsx.load(january.body as Buffer);
    const janSheet = janBook.getWorksheet(VISIT_EXPORT_SHEET_NAME)!;
    expect(janSheet.rowCount).toBe(4);
    const janDays = new Map<string, number | null>();
    janSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      const key = String(row.getCell(4).value);
      janDays.set(key, (row.getCell(5).value as number | null) ?? null);
    });
    expect(janDays.get(formatJalaliDateTimeTehran(new Date('2026-01-11T10:00:00.000Z')))).toBe(10);
    expect(janDays.has(formatJalaliDateTimeTehran(new Date('2026-02-10T10:00:00.000Z')))).toBe(false);

    const byDate = await request(app.getHttpServer())
      .get('/visits/export')
      .query({ date: '2026-01-11' })
      .set('Authorization', `Bearer ${salonA.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(200);
    const dateBook = new ExcelJS.Workbook();
    await dateBook.xlsx.load(byDate.body as Buffer);
    expect(dateBook.getWorksheet(VISIT_EXPORT_SHEET_NAME)!.rowCount).toBe(3);

    const intel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(intel.body.revenue.totalRevenue).toBe('9500000.00');
    expect(intel.body.revenue.transactionCount).toBe(2);

    const txCountAfter = await prisma.client.ledgerTransaction.count({
      where: { salonId: salonA.tenantId },
    });
    expect(txCountAfter).toBe(txCountBefore);

    const audit = await prisma.client.auditLog.findFirst({
      where: { tenantId: salonA.tenantId, action: 'VISITS_EXPORTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.result).toBe('SUCCESS');
    expect(JSON.stringify(audit ?? {})).not.toMatch(/Maryam|8000000|0912/);
  });

  it('GET /visits returns serviceName and amountReceived on the correct visit across pages', async () => {
    const salonA = await registerOwner('vlist-a');
    const salonB = await registerOwner('vlist-b');
    const maryam = await createCustomer(salonA.token, 'Maryam', 'Ahmadi');
    const sara = await createCustomer(salonA.token, 'Sara', 'Mohammadi');
    const otherCustomer = await createCustomer(salonB.token, 'Other', 'Salon');
    const hair = await createService(salonA.token, 'Hair Service');
    const nail = await createService(salonA.token, 'Nail Service');
    const otherService = await createService(salonB.token, 'Other Service');

    const visitOnly = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: maryam, visitedAt: '2026-06-01T10:00:00.000Z' })
      .expect(201);

    const hairSale = await completeSale(salonA.token, {
      customerId: maryam,
      visitedAt: '2026-06-10T10:00:00.000Z',
      serviceId: hair.id,
      amount: '8000000.00',
    });
    const nailSale = await completeSale(salonA.token, {
      customerId: sara,
      visitedAt: '2026-06-11T10:00:00.000Z',
      serviceId: nail.id,
      amount: '5000000.00',
    });
    await completeSale(salonB.token, {
      customerId: otherCustomer,
      visitedAt: '2026-06-10T10:00:00.000Z',
      serviceId: otherService.id,
      amount: '999.00',
    });

    type VisitRow = {
      id: string;
      firstName: string;
      lastName: string;
      visitedAt: string;
      serviceName: string | null;
      amountReceived: string | null;
    };

    const listed = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const items = listItems<VisitRow>(listed.body);
    expect(items).toHaveLength(3);
    const byId = Object.fromEntries(items.map((row) => [row.id, row]));
    expect(byId[hairSale.body.visit.id]).toMatchObject({
      firstName: 'Maryam',
      lastName: 'Ahmadi',
      visitedAt: '2026-06-10T10:00:00.000Z',
      serviceName: 'Hair Service',
      amountReceived: '8000000.00',
    });
    expect(byId[nailSale.body.visit.id]).toMatchObject({
      firstName: 'Sara',
      lastName: 'Mohammadi',
      visitedAt: '2026-06-11T10:00:00.000Z',
      serviceName: 'Nail Service',
      amountReceived: '5000000.00',
    });
    expect(byId[visitOnly.body.id]).toMatchObject({
      serviceName: null,
      amountReceived: null,
    });
    expect(items.every((row) => row.serviceName !== otherService.name)).toBe(true);

    const page1 = await request(app.getHttpServer())
      .get('/visits')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const firstPage = listPage<VisitRow>(page1.body);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.items[0]).toMatchObject({
      id: nailSale.body.visit.id,
      serviceName: 'Nail Service',
      amountReceived: '5000000.00',
    });

    const page2 = await request(app.getHttpServer())
      .get('/visits')
      .query({ limit: 1, cursor: firstPage.nextCursor })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const secondPage = listPage<VisitRow>(page2.body);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]).toMatchObject({
      id: hairSale.body.visit.id,
      serviceName: 'Hair Service',
      amountReceived: '8000000.00',
    });

    const otherList = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    const otherItems = listItems<VisitRow>(otherList.body);
    expect(otherItems.map((row) => row.id)).not.toContain(hairSale.body.visit.id);
    expect(otherItems.map((row) => row.id)).not.toContain(nailSale.body.visit.id);
    expect(otherItems.every((row) => row.serviceName === otherService.name || row.serviceName === null)).toBe(
      true,
    );
  });
});
