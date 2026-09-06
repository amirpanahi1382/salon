import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CUSTOMER_IMPORT_MAX_FILE_BYTES } from '../src/customer/customer-import.constants';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { DOMAIN_EVENT_TYPES } from '@salon/shared';
import { listItems } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

async function xlsx(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  for (const row of rows) {
    sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describeIfDb('Customer import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let salonA: { email: string; token: string; userId: string; tenantId: string };

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

  it('rejects unauthenticated import', async () => {
    await request(app.getHttpServer())
      .post('/customers/import')
      .attach('file', await xlsx([['Name', 'Phone'], ['Sara Ahmadi', '09120000001']]), 'customers.xlsx')
      .expect(401);
  });

  it('imports valid rows, skips duplicates, and reports invalid rows without overwriting', async () => {
    salonA = await registerOwner('imp-a');
    const salonB = await registerOwner('imp-b');
    const existingPhone = `0912${Date.now().toString().slice(-7)}`;

    await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ firstName: 'Existing', lastName: 'Customer', phoneNumber: existingPhone })
      .expect(201);

    const uniquePhone = `0935${Date.now().toString().slice(-7)}`;
    const file = await xlsx([
      ['Name', 'Phone'],
      ['Sara Ahmadi', uniquePhone],
      ['Sara Duplicate', uniquePhone],
      ['Existing Person', existingPhone],
      ['', uniquePhone],
      ['No Phone', ''],
      ['Bad Phone', '123'],
      ['Missing Zero', '9121111111'],
      ['Plus98', '+989121111111'],
      ['ZeroZero98', '00989121111111'],
      ['Spaces', '0912 111 1111'],
      ['Hyphens', '0912-111-1111'],
      ['Numeric Lost Zero', 9121111111],
      ['Leading Space', ' 09121111111'],
      ['Trailing Space', '09121111111 '],
      ['Neda Hosseini', `0921${Date.now().toString().slice(-7)}`],
    ]);

    const imported = await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${salonA.token}`)
      .attach('file', file, 'customers.xlsx')
      .expect(200);

    expect(imported.body.imported).toBe(2);
    expect(imported.body.skipped).toBe(2);
    expect(imported.body.failed).toBe(11);
    expect(imported.body.results.find((row: { row: number }) => row.row === 2).status).toBe('IMPORTED');
    expect(imported.body.results.find((row: { row: number }) => row.row === 3).status).toBe(
      'DUPLICATE_IN_FILE',
    );
    expect(imported.body.results.find((row: { row: number }) => row.row === 4).status).toBe(
      'ALREADY_EXISTS',
    );
    expect(imported.body.results.find((row: { row: number }) => row.row === 16).status).toBe('IMPORTED');
    for (const rowNumber of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      const row = imported.body.results.find((item: { row: number }) => item.row === rowNumber);
      expect(row.status).toBe('INVALID');
    }
    expect(
      imported.body.results.find((item: { row: number }) => item.row === 9).errors.join(' '),
    ).toContain('11 digits');
    expect(JSON.stringify(imported.body)).not.toMatch(/0912|0935|0921/);

    const listed = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const names = listItems<{ firstName: string; lastName: string }>(listed.body).map(
      (row) => `${row.firstName} ${row.lastName}`.trim(),
    );
    expect(names).toContain('Sara Ahmadi');
    expect(names).toContain('Neda Hosseini');
    expect(names).toContain('Existing Customer');
    expect(names).not.toContain('Existing Person');

    const existing = listItems<{ firstName: string; lastName: string; phoneNumber: string }>(
      listed.body,
    ).find((row) => row.phoneNumber === existingPhone);
    expect(existing.firstName).toBe('Existing');
    expect(existing.lastName).toBe('Customer');

    const otherList = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(
      listItems<{ phoneNumber: string }>(otherList.body).map((row) => row.phoneNumber),
    ).not.toContain(uniquePhone);

    const samePhoneOtherSalon = await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${salonB.token}`)
      .attach(
        'file',
        await xlsx([['Name', 'Phone'], ['Other Salon', uniquePhone]]),
        'customers.xlsx',
      )
      .expect(200);
    expect(samePhoneOtherSalon.body.imported).toBe(1);

    const outbox = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salonA.tenantId, eventType: DOMAIN_EVENT_TYPES.CustomerCreated },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(outbox)).not.toMatch(new RegExp(uniquePhone));

    const audit = await prisma.client.auditLog.findFirst({
      where: { tenantId: salonA.tenantId, action: 'CUSTOMERS_IMPORTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.actorId).toBe(salonA.userId);
    expect(audit?.metadata).toMatchObject({ imported: 2, skipped: 2, failed: 11 });
    expect(JSON.stringify(audit ?? {})).not.toMatch(new RegExp(uniquePhone));
  });

  it('lets MANAGER and STAFF import, matching customer create permissions', async () => {
    const owner = await registerOwner('imp-roles');
    const managerEmail = `mgr-imp-${Date.now()}@example.test`;
    const staffEmail = `staff-imp-${Date.now()}@example.test`;

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

    const managerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: managerEmail, password })
      .expect(201);
    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(201);

    const managerImport = await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${managerLogin.body.accessToken}`)
      .attach(
        'file',
        await xlsx([['Name', 'Phone'], ['Manager Customer', `0913${Date.now().toString().slice(-7)}`]]),
        'customers.xlsx',
      )
      .expect(200);
    expect(managerImport.body.imported).toBe(1);

    const staffImport = await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .attach(
        'file',
        await xlsx([['Name', 'Phone'], ['Staff Customer', `0914${Date.now().toString().slice(-7)}`]]),
        'customers.xlsx',
      )
      .expect(200);
    expect(staffImport.body.imported).toBe(1);
  });

  it('rejects missing headers, empty files, unsupported types, oversized files, and malformed zip', async () => {
    const owner = await registerOwner('imp-val');

    await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', await xlsx([['Foo', 'Bar']]), 'customers.xlsx')
      .expect(400);

    await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', await xlsx([['Name', 'Phone']]), 'customers.xlsx')
      .expect(400);

    await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('not-excel'), 'customers.csv')
      .expect(400);

    const oversized = Buffer.alloc(CUSTOMER_IMPORT_MAX_FILE_BYTES + 1, 0x50);
    oversized[0] = 0x50;
    oversized[1] = 0x4b;
    await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', oversized, 'customers.xlsx')
      .expect(413);

    const bogus = Buffer.from('PK\u0003\u0004not-a-real-workbook');
    const malformed = await request(app.getHttpServer())
      .post('/customers/import')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', bogus, 'customers.xlsx')
      .expect(400);
    expect(malformed.body.error).toBe('VALIDATION_ERROR');
  });

  it('keeps unique phones when import races with customer create', async () => {
    const phone = `0912${Date.now().toString().slice(-7)}`.slice(0, 11);
    const file = await xlsx([
      ['Name', 'Phone'],
      ['Import Sara', phone],
    ]);

    const [importRes, createRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/customers/import')
        .set('Authorization', `Bearer ${salonA.token}`)
        .attach('file', file, 'customers.xlsx'),
      request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${salonA.token}`)
        .send({ firstName: 'Create', lastName: 'Sara', phoneNumber: phone }),
    ]);

    expect(importRes.status).not.toBe(500);
    expect(createRes.status).not.toBe(500);
    expect([200, 400]).toContain(importRes.status);
    expect([201, 409]).toContain(createRes.status);

    const customers = await prisma.client.customer.findMany({
      where: { salonId: salonA.tenantId, phoneNumber: phone },
    });
    expect(customers).toHaveLength(1);
  });

  it('serves an authenticated Excel template', async () => {
    const owner = await registerOwner('imp-tpl');
    await request(app.getHttpServer()).get('/customers/import/template').expect(401);

    const template = await request(app.getHttpServer())
      .get('/customers/import/template')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(template.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(Number(template.headers['content-length'])).toBeGreaterThan(0);
  });
});
