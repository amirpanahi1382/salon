import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Phase 6 admin salon selection pagination (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let salonToken: string;
  const ids: string[] = [];
  const scope = `Phase6-${randomUUID()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const email = `phase6-admin-${randomUUID()}@example.test`;
    await prisma.client.platformAdmin.create({ data: {
      id: randomUUID(), email, name: 'Phase 6 admin',
      passwordHash: await argon2.hash('phase6-test-password', { type: argon2.argon2id }),
    } });
    const login = await request(app.getHttpServer()).post('/admin/auth/login')
      .send({ email, password: 'phase6-test-password' }).expect(201);
    token = login.body.accessToken as string;
    const sameTime = new Date('2026-01-01T00:00:00.000Z');
    const older = new Date('2025-01-01T00:00:00.000Z');
    const data = Array.from({ length: 201 }, (_, index) => {
      const id = randomUUID(); ids.push(id);
      return { id, name: `${scope} Batch`, createdAt: sameTime, updatedAt: sameTime };
    });
    const target = randomUUID(); ids.push(target);
    data.push({ id: target, name: `${scope} Target`, createdAt: older, updatedAt: older });
    await prisma.client.salon.createMany({ data });
    const salonUserId = randomUUID();
    await prisma.client.user.create({ data: {
      id: salonUserId, salonId: ids[0]!, name: 'Salon owner',
      email: `${salonUserId}@example.test`, passwordHash: 'unused', role: 'OWNER',
    } });
    salonToken = await app.get(JwtService).signAsync({ sub: salonUserId, tid: ids[0], role: 'OWNER' });
  });

  afterAll(async () => { await app.close(); });

  it('traverses 202 rows without duplicates and finds the older salon beyond 200', async () => {
    const seen: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await request(app.getHttpServer()).get('/admin/vip/salons')
        .set('Authorization', `Bearer ${token}`)
        .query({ q: scope, ...(cursor ? { cursor } : {}) }).expect(200);
      seen.push(...response.body.items.map((item: { id: string }) => item.id));
      if (!response.body.hasMore) {
        expect(response.body.nextCursor).toBeNull();
        break;
      }
      expect(typeof response.body.nextCursor).toBe('string');
      expect(cursors.has(response.body.nextCursor)).toBe(false);
      cursors.add(response.body.nextCursor);
      cursor = response.body.nextCursor;
    } while (cursors.size < 10);
    expect(seen).toHaveLength(202);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen.at(-1)).toBe(ids.at(-1));
    const search = await request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${token}`).query({ q: `${scope} Target` }).expect(200);
    expect(search.body.items.map((item: { id: string }) => item.id)).toEqual([ids.at(-1)]);
    expect(search.body.hasMore).toBe(false);
    expect(search.body.nextCursor).toBeNull();
  });

  it('returns empty and malformed-cursor contracts and blocks salon JWTs', async () => {
    const empty = await request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${token}`).query({ q: `${scope} missing` }).expect(200);
    expect(empty.body).toEqual({ items: [], hasMore: false, nextCursor: null });
    for (const cursor of ['@@@', Buffer.from('2026-01-01T00:00:00Z\nnot-uuid').toString('base64url')]) {
      const response = await request(app.getHttpServer()).get('/admin/vip/salons')
        .set('Authorization', `Bearer ${token}`).query({ cursor }).expect(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    await request(app.getHttpServer()).get('/admin/vip/salons').expect(401);
    await request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${salonToken}`).expect(403);
  });

  it('handles one row, an exact page, and a page plus one without false continuation', async () => {
    const auth = () => request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${token}`);
    const timestamp = new Date('2026-02-01T00:00:00.000Z');
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: randomUUID(), name: `${scope} Boundary ${index < 50 ? 'Exact' : 'Extra'}`,
      createdAt: timestamp, updatedAt: timestamp,
    }));
    await prisma.client.salon.createMany({ data: rows });

    const single = await auth().query({ q: `${scope} Boundary Extra` }).expect(200);
    expect(single.body.items.map((item: { id: string }) => item.id)).toEqual([rows[50]!.id]);
    expect(single.body.hasMore).toBe(false);
    expect(single.body.nextCursor).toBeNull();

    const exact = await auth().query({ q: `${scope} Boundary Exact` }).expect(200);
    expect(exact.body.items).toHaveLength(50);
    expect(new Set(exact.body.items.map((item: { id: string }) => item.id)))
      .toEqual(new Set(rows.slice(0, 50).map((row) => row.id)));
    expect(exact.body.hasMore).toBe(false);
    expect(exact.body.nextCursor).toBeNull();

    const first = await auth().query({ q: `${scope} Boundary` }).expect(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.hasMore).toBe(true);
    expect(typeof first.body.nextCursor).toBe('string');
    const last = await auth().query({ q: `${scope} Boundary`, cursor: first.body.nextCursor }).expect(200);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
    expect(last.body.nextCursor).toBeNull();
    expect(new Set([...first.body.items, ...last.body.items].map((item: { id: string }) => item.id)))
      .toEqual(new Set(rows.map((row) => row.id)));
  });

  it('uses live keyset pages when rows are inserted or deleted between requests', async () => {
    const timestamp = new Date('2026-03-01T00:00:00.000Z');
    const rows = Array.from({ length: 51 }, () => ({
      id: randomUUID(), name: `${scope} Live`, createdAt: timestamp, updatedAt: timestamp,
    }));
    await prisma.client.salon.createMany({ data: rows });
    const first = await request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${token}`).query({ q: `${scope} Live` }).expect(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.hasMore).toBe(true);
    const remainingId = rows.map((row) => row.id)
      .find((id) => !first.body.items.some((item: { id: string }) => item.id === id));
    expect(remainingId).toBeDefined();
    await prisma.client.salon.delete({ where: { id: remainingId! } });
    const inserted = randomUUID();
    await prisma.client.salon.create({ data: {
      id: inserted, name: `${scope} Live`,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    } });
    const next = await request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${token}`)
      .query({ q: `${scope} Live`, cursor: first.body.nextCursor }).expect(200);
    expect(next.body).toEqual({ items: [], hasMore: false, nextCursor: null });
    const refreshed = await request(app.getHttpServer()).get('/admin/vip/salons')
      .set('Authorization', `Bearer ${token}`).query({ q: `${scope} Live` }).expect(200);
    expect(refreshed.body.items[0].id).toBe(inserted);
  });
});
