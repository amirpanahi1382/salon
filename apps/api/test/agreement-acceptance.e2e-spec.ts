import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { decode } from 'jsonwebtoken';
import { createPrismaClient } from '@salon/database';
import { createId } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionSalonOwner } from '../src/auth/provision-salon-owner';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { createPlatformAdminSession, createProductOwnerSession } from './support/phone-account';

const databaseUrl = process.env.AGREEMENT_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const container = process.env.DISPOSABLE_POSTGRES_CONTAINER ?? '';
const disposable =
  Boolean(databaseUrl) &&
  process.env.DATABASE_URL === databaseUrl &&
  databaseName.startsWith('salon_agreement_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;

describeIfDisposable('agreement acceptance on a disposable database', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let disabled: INestApplication;
  let prisma: PrismaService;
  const national = nationalId('001354241');
  const password = 'agreement-owner-password';

  beforeAll(async () => {
    if (!disposable || !databaseUrl) return;
    const target = new URL(databaseUrl);
    if (
      (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') ||
      databaseName === 'salon' ||
      databaseName === 'salon_preview'
    ) {
      throw new Error('Agreement tests refused a non-disposable database target');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configure(app);
    await app.init();
    prisma = app.get(PrismaService);
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Agreement tests refused a database other than the disposable target');
    }
    const config = app.get(AppConfigService);
    if (!config.values.AGREEMENT_ACCEPTANCE_ENABLED || !config.values.AGREEMENT_EVIDENCE_KEY) {
      throw new Error('Agreement tests require AGREEMENT_ACCEPTANCE_ENABLED and an evidence key');
    }
    if (config.values.PHONE_SIGNUP_ENABLED) {
      throw new Error('Agreement tests must leave phone signup disabled');
    }
    const disabledRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({ values: { ...config.values, AGREEMENT_ACCEPTANCE_ENABLED: false } })
      .compile();
    disabled = disabledRef.createNestApplication();
    configure(disabled);
    await disabled.init();
  });

  afterAll(async () => {
    if (disabled) await disabled.close();
    if (app) await app.close();
  });

  beforeEach(() => {
    resetThrottle(app);
    resetThrottle(disabled);
  });

  it('fails closed when acceptance is disabled or no version is published', async () => {
    const owner = await phoneOwner();
    const token = await login(owner.phone);
    await request(disabled.getHttpServer())
      .get('/agreement/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/agreement/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } });
    expect(salon.accessState).toBe('AWAITING_AGREEMENT');
    expect(await prisma.client.agreementAcceptance.count({ where: { salonId: owner.salonId } })).toBe(0);
  });

  it('accepts once, replays, and keeps every other path restricted', async () => {
    const admin = await platformAdmin();
    const published = await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    const again = await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(again.body).toEqual(published.body);
    expect(published.body.versionKey).toBe('CONTRACT_V1');

    const owner = await phoneOwner();
    const other = await phoneOwner();
    const token = await login(owner.phone);
    const legacy = await legacyOwner();
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${legacy.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/agreement/current')
      .set('Authorization', `Bearer ${legacy.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const current = await request(app.getHttpServer())
      .get('/agreement/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.versionKey).toBe('CONTRACT_V1');
    expect(current.body.amountIrr).toBe('50000000.00');
    expect(current.body.buttonWording).toBe('تأیید قرارداد و ادامه به راهنمای واریز');
    expect(current.body.verifiedPhone).toBe(owner.phone);

    await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: ' ', nationalId: national, salonName: 'سالن', phone: owner.phone })
      .expect(400);
    await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'نرگس رضایی', nationalId: '0000000000', salonName: 'سالن', phone: owner.phone })
      .expect(400);
    const latinName = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Narges Rezaei', nationalId: national, salonName: 'سالن', phone: owner.phone })
      .expect(400);
    expect(latinName.body.message).toMatch(/Persian full name/i);
    const badChecksum = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'نرگس رضایی',
        nationalId: `${national.slice(0, 9)}0`,
        salonName: 'سالن',
        phone: owner.phone,
      })
      .expect(400);
    expect(badChecksum.body.message).toMatch(/checksum/i);
    const mismatch = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'نرگس رضایی', nationalId: national, salonName: 'سالن نرگس', phone: '09121111111' })
      .expect(409);
    expect(mismatch.body.error).toBe('AGREEMENT_PHONE_UNVERIFIED');

    const presented = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'نرگس رضایی',
        nationalId: national,
        salonName: 'سالن Glow Beauty <نرگس>',
        phone: owner.phone,
      })
      .expect(201);
    expect(presented.body.canonicalDocument).toContain('نرگس رضایی');
    expect(presented.body.canonicalDocument).toContain(national);
    expect(presented.body.canonicalDocument).toContain('سالن Glow Beauty <نرگس>');
    expect(presented.body.canonicalDocument).toContain('نام و نام خانوادگی:');
    expect(presented.body.canonicalDocument).toContain('کد ملی:');
    expect(presented.body.canonicalDocument).toContain('نام سالن آرایشگاهی:');
    expect(presented.body.templateDigest).toBe(published.body.templateDigest);

    const key = `accept-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ presentationId: presented.body.presentationId, accepted: false })
      .expect(400);

    const stale = await insertPresentation({
      salonId: owner.salonId,
      userId: owner.userId,
      versionId: published.body.id,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - 120_000),
    });
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `stale-${randomUUID()}`)
      .send({ presentationId: stale, accepted: true })
      .expect(409);

    const otherVersion = await prisma.client.agreementVersion.create({
      data: {
        id: createId(),
        versionKey: `CONTRACT_OTHER_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        templateDigest: 'a'.repeat(64),
        canonicalText: 'other',
        checkboxWording: 'other',
        buttonWording: 'other',
        amountIrr: '1.00',
        scopeSnapshot: { currency: 'IRR' },
        publishedByAdminId: admin.id,
      },
    });
    const wrongVersion = await insertPresentation({
      salonId: owner.salonId,
      userId: owner.userId,
      versionId: otherVersion.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `version-${randomUUID()}`)
      .send({ presentationId: wrongVersion, accepted: true })
      .expect(409);

    const accepted = await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .set('X-Forwarded-For', '203.0.113.9')
      .set('X-App-Version', '1.0.0')
      .set('X-App-Build', '1')
      .set('User-Agent', 'agreement-test')
      .send({ presentationId: presented.body.presentationId, accepted: true })
      .expect(201);
    expect(accepted.body.accessState).toBe('AWAITING_PAYMENT');
    expect(accepted.body.replayed).toBe(false);
    expect(accepted.body.statement).toContain('Payment instructions are not available');
    const replay = await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ presentationId: presented.body.presentationId, accepted: true })
      .expect(201);
    expect(replay.body).toEqual({ ...accepted.body, replayed: true });
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ presentationId: wrongVersion, accepted: true })
      .expect(409);
    expect(await prisma.client.agreementAcceptance.count({ where: { salonId: owner.salonId } })).toBe(1);

    const row = await prisma.client.agreementAcceptance.findFirstOrThrow({
      where: { salonId: owner.salonId },
    });
    expect(row.checkboxConfirmed).toBe(true);
    expect(row.buttonWording).toBe('تأیید قرارداد و ادامه به راهنمای واریز');
    expect(row.clientIpSource).toBe('socket');
    expect(row.clientIp).not.toBe('203.0.113.9');
    expect(row.appVersion).toBe('1.0.0');
    expect(row.apiRevision).toBe(app.get(AppConfigService).values.API_REVISION);
    expect(row.phoneOwnerCompletionId).toBe(owner.completionId);
    expect(row.sessionJti).toBe((decode(token) as { jti?: string }).jti);
    const stored = await prisma.client.$queryRaw<Array<{ found: number }>>`
      SELECT position(convert_to(${national}, 'UTF8') IN snapshot_ciphertext) AS found
      FROM agreement_acceptances
      WHERE id = ${row.id}::uuid
    `;
    expect(stored[0]?.found).toBe(0);
    const audits = await prisma.client.auditLog.findMany({
      where: { tenantId: owner.salonId, action: { in: ['AGREEMENT_DOCUMENT_PRESENTED', 'AGREEMENT_DOCUMENT_ACCEPTED'] } },
    });
    expect(audits.map((item) => item.action).sort()).toEqual([
      'AGREEMENT_DOCUMENT_ACCEPTED',
      'AGREEMENT_DOCUMENT_PRESENTED',
    ]);
    expect(JSON.stringify(audits)).not.toContain(national);
    expect(JSON.stringify(audits)).not.toContain(password);

    const user = await prisma.client.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.status).toBe('ACTIVE');
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } });
    expect(salon.accessState).toBe('AWAITING_PAYMENT');
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const fresh = await login(owner.phone);
    expect((decode(fresh) as { scp?: string }).scp).toBe('onboarding');
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(403);
    const receipt = await request(app.getHttpServer())
      .get('/agreement/acceptance/receipt')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(200);
    expect(receipt.body.versionKey).toBe('CONTRACT_V1');
    expect(receipt.body.renderedDigest).toBe(accepted.body.renderedDigest);
    expect(receipt.body.statement).not.toMatch(/card|IR[0-9]{24}/i);
    const document = await request(app.getHttpServer())
      .get('/agreement/acceptance/document')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(document.headers['content-type']).toContain('text/plain');
    expect(createHash('sha256').update(document.text).digest('hex')).toBe(accepted.body.renderedDigest);
    const html = await request(app.getHttpServer())
      .get('/agreement/acceptance/document.html')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(html.text).toContain('سالن Glow Beauty &lt;نرگس&gt;');
    expect(html.text).not.toContain('<نرگس>');
    expect(html.text).toContain('نام و نام خانوادگی:');
    expect(html.text).toContain('کد ملی:');
    expect(html.text).toContain('نام سالن آرایشگاهی:');
    await request(app.getHttpServer())
      .get('/agreement/acceptance/document')
      .set('Authorization', `Bearer ${await login(other.phone)}`)
      .expect(404);

    const evidence = await request(app.getHttpServer())
      .get(`/admin/agreements/acceptances/${row.id}/evidence`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(evidence.body.canonicalDocument).toContain(national);
    expect(evidence.body.verification.statement).toContain('not WORM');
    expect(evidence.body.hashManifest.recomputedRenderedSha256).toBe(row.renderedDigest);
    expect(evidence.body.technicalContext.clientIpSource).toBe('socket');
    expect(evidence.body.technicalContext.clientIpIsObservedSocket).toBe(true);
    expect(evidence.body.technicalContext.forwardedClientIpVerified).toBe(false);
    expect(evidence.body.technicalContext.observedSocketIp).toBe(evidence.body.technicalContext.clientIp);
    expect(evidence.body.technicalContext.observedSocketIp).not.toBe('203.0.113.9');
    expect(evidence.body.technicalContext.clientReported).toEqual({
      userAgent: 'agreement-test',
      appVersion: '1.0.0',
      appBuild: '1',
    });
    expect(evidence.body.verification.howToVerify.join(' ')).toContain('observedSocketIp');
    expect(JSON.stringify(evidence.body)).not.toContain(password);
    expect(JSON.stringify(evidence.body)).not.toContain(other.salonId);
    await request(app.getHttpServer())
      .get(`/admin/agreements/acceptances/${row.id}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const exportAudit = await prisma.client.auditLog.findFirstOrThrow({
      where: { action: 'AGREEMENT_EVIDENCE_EXPORTED', resourceId: row.id },
    });
    expect(JSON.stringify(exportAudit.metadata)).not.toContain(national);

    await expect(
      prisma.client.agreementVersion.update({
        where: { id: published.body.id },
        data: { buttonWording: 'changed' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.client.agreementAcceptance.delete({ where: { id: row.id } }),
    ).rejects.toThrow(/immutable/);

    const legacySalon = await prisma.client.salon.findUniqueOrThrow({ where: { id: legacy.salonId } });
    expect(legacySalon.accessState).toBe('PRODUCT');
    expect(await prisma.client.messageRequest.count({ where: { salonId: owner.salonId } })).toBe(0);
  });

  it('keeps accepted evidence readable after new acceptances are closed', async () => {
    const admin = await platformAdmin();
    await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    const owner = await phoneOwner();
    const other = await phoneOwner();
    const token = await login(owner.phone);
    const presented = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'نرگس رضایی', nationalId: national, salonName: 'سالن نرگس', phone: owner.phone })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `closed-${randomUUID()}`)
      .send({ presentationId: presented.body.presentationId, accepted: true })
      .expect(201);
    const row = await prisma.client.agreementAcceptance.findFirstOrThrow({
      where: { salonId: owner.salonId },
    });
    const fresh = await login(owner.phone);
    const otherToken = await login(other.phone);

    await request(disabled.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(404);
    await request(disabled.getHttpServer())
      .get('/agreement/current')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(404);
    await request(disabled.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${fresh}`)
      .send({ fullName: 'نرگس رضایی', nationalId: national, salonName: 'سالن نرگس', phone: owner.phone })
      .expect(404);
    await request(disabled.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${fresh}`)
      .set('Idempotency-Key', `closed-again-${randomUUID()}`)
      .send({ presentationId: presented.body.presentationId, accepted: true })
      .expect(404);
    expect(await prisma.client.agreementAcceptance.count({ where: { salonId: owner.salonId } })).toBe(1);

    const receipt = await request(disabled.getHttpServer())
      .get('/agreement/acceptance/receipt')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(200);
    expect(receipt.body.renderedDigest).toBe(accepted.body.renderedDigest);
    expect(receipt.body.statement).not.toMatch(/card|IR[0-9]{24}/i);
    const document = await request(disabled.getHttpServer())
      .get('/agreement/acceptance/document')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(200);
    expect(createHash('sha256').update(document.text).digest('hex')).toBe(accepted.body.renderedDigest);
    await request(disabled.getHttpServer())
      .get('/agreement/acceptance/document.html')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(200);
    await request(disabled.getHttpServer()).get('/agreement/acceptance/receipt').expect(401);
    await request(disabled.getHttpServer())
      .get('/agreement/acceptance/document')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    const evidence = await request(disabled.getHttpServer())
      .get(`/admin/agreements/acceptances/${row.id}/evidence`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(evidence.body.canonicalDocument).toContain(national);
    expect(evidence.body.technicalContext.observedSocketIp).toBe(evidence.body.technicalContext.clientIp);
    expect(evidence.body.technicalContext.clientIpIsObservedSocket).toBe(true);
    expect(evidence.body.technicalContext.clientReported.appVersion).toBeNull();
    expect(evidence.body.technicalContext.clientReported.userAgent).not.toBe(
      evidence.body.technicalContext.observedSocketIp,
    );
    await request(disabled.getHttpServer())
      .get(`/admin/agreements/acceptances/${row.id}/evidence`)
      .set('Authorization', `Bearer ${fresh}`)
      .expect(403);
    await request(disabled.getHttpServer())
      .get(`/admin/agreements/acceptances/${row.id}/evidence`)
      .expect(401);
    const exportAudit = await prisma.client.auditLog.findFirstOrThrow({
      where: { action: 'AGREEMENT_EVIDENCE_EXPORTED', resourceId: row.id },
    });
    expect(JSON.stringify(exportAudit.metadata)).not.toContain(national);

    const config = app.get(AppConfigService);
    const sealedRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({
        values: {
          ...config.values,
          AGREEMENT_ACCEPTANCE_ENABLED: false,
          AGREEMENT_EVIDENCE_KEY: undefined,
          AGREEMENT_EVIDENCE_DECRYPT_KEYS: undefined,
        },
      })
      .compile();
    const sealed = sealedRef.createNestApplication();
    configure(sealed);
    await sealed.init();
    try {
      const stillThere = await request(sealed.getHttpServer())
        .get('/agreement/acceptance/receipt')
        .set('Authorization', `Bearer ${fresh}`)
        .expect(200);
      expect(stillThere.body.renderedDigest).toBe(accepted.body.renderedDigest);
      const hidden = await request(sealed.getHttpServer())
        .get('/agreement/acceptance/document')
        .set('Authorization', `Bearer ${fresh}`)
        .expect(500);
      expect(JSON.stringify(hidden.body)).not.toContain(national);
      const hiddenExport = await request(sealed.getHttpServer())
        .get(`/admin/agreements/acceptances/${row.id}/evidence`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(500);
      expect(JSON.stringify(hiddenExport.body)).not.toContain(national);
    } finally {
      await sealed.close();
    }
  });

  it('rejects a second concurrent acceptance and rolls back a failed write', async () => {
    const owner = await phoneOwner();
    const token = await login(owner.phone);
    const presented = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'نرگس رضایی', nationalId: national, salonName: 'سالن نرگس', phone: owner.phone })
      .expect(201);
    const firstKey = `race-a-${randomUUID()}`;
    const secondKey = `race-b-${randomUUID()}`;
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/agreement/acceptance')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', firstKey)
        .send({ presentationId: presented.body.presentationId, accepted: true }),
      request(app.getHttpServer())
        .post('/agreement/acceptance')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', secondKey)
        .send({ presentationId: presented.body.presentationId, accepted: true }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.client.agreementAcceptance.count({ where: { salonId: owner.salonId } })).toBe(1);

    const pending = await phoneOwner();
    await expect(
      prisma.client.$transaction(async (tx) => {
        await tx.salon.update({
          where: { id: pending.salonId },
          data: { accessState: 'AWAITING_PAYMENT' },
        });
        throw new Error('rollback-acceptance');
      }),
    ).rejects.toThrow('rollback-acceptance');
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: pending.salonId } });
    expect(salon.accessState).toBe('AWAITING_AGREEMENT');
    expect(await prisma.client.agreementAcceptance.count({ where: { salonId: pending.salonId } })).toBe(0);
  });

  it('does not let an old product token survive a downgrade', async () => {
    const legacy = await legacyOwner();
    await prisma.client.salon.update({
      where: { id: legacy.salonId },
      data: { accessState: 'AWAITING_PAYMENT' },
    });
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${legacy.token}`)
      .expect(401);
    const jwt = app.get(JwtService);
    const oldOnboarding = await jwt.signAsync({
      sub: legacy.userId,
      tid: legacy.salonId,
      role: 'OWNER',
      scp: 'onboarding',
    });
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${oldOnboarding}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${oldOnboarding}`)
      .set('Idempotency-Key', `nojti-${randomUUID()}`)
      .send({ presentationId: createId(), accepted: true })
      .expect(401);
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: legacy.salonId } });
    expect(salon.accessState).toBe('AWAITING_PAYMENT');
  });

  it('upgrades a predecessor database without rewriting historical rows', async () => {
    if (!container || !databaseUrl) {
      throw new Error('DISPOSABLE_POSTGRES_CONTAINER is required for the upgrade test');
    }
    const upgradeName = `salon_agreement_upgrade_${randomUUID().replace(/-/g, '')}`;
    const upgradeUrl = new URL(databaseUrl);
    upgradeUrl.pathname = `/${upgradeName}`;
    await psql(container, 'postgres', `CREATE DATABASE ${upgradeName}`);
    try {
      const migrationsDir = path.resolve(__dirname, '../../../packages/database/prisma/migrations');
      const directories = (await readdir(migrationsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const directory of directories) {
        if (directory >= '20261015180000_salon_access_awaiting_payment') continue;
        const sql = await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8');
        await psql(container, upgradeName, sql);
      }
      const upgrade = createPrismaClient(upgradeUrl.toString());
      const salonId = createId();
      const ownerId = createId();
      const email = `upgrade-${randomUUID()}@example.com`;
      await upgrade.salon.create({
        data: { id: salonId, name: 'Historical', status: 'ACTIVE', updatedAt: new Date() },
      });
      await upgrade.$executeRaw`
        INSERT INTO users (id, salon_id, name, email, password_hash, role, status, updated_at)
        VALUES (${ownerId}::uuid, ${salonId}::uuid, 'Historical Owner', ${email}, 'hash', 'OWNER', 'ACTIVE', clock_timestamp())
      `;
      const customerId = createId();
      await upgrade.customer.create({
        data: {
          id: customerId,
          salonId,
          firstName: 'Old',
          lastName: 'Customer',
          phoneNumber: '09120001111',
          updatedAt: new Date(),
        },
      });
      await upgrade.$disconnect();

      const phoneFirst = '20261017150000_phone_first_identity';
      for (const directory of directories.filter(
        (item) => item >= '20261015180000_salon_access_awaiting_payment' && item < phoneFirst,
      )) {
        const sql = await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8');
        await psql(container, upgradeName, sql);
      }
      const upgraded = createPrismaClient(upgradeUrl.toString());
      const salon = await upgraded.salon.findUniqueOrThrow({ where: { id: salonId } });
      const owner = await upgraded.$queryRaw<Array<{ email: string; phone: string | null }>>`
        SELECT email, phone FROM users WHERE id = ${ownerId}::uuid
      `;
      const customer = await upgraded.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(salon.accessState).toBe('PRODUCT');
      expect(salon.name).toBe('Historical');
      expect(owner[0]?.email).toBe(email);
      expect(owner[0]?.phone).toBeNull();
      expect(customer.phoneNumber).toBe('09120001111');
      expect(await upgraded.agreementAcceptance.count()).toBe(0);
      expect(await upgraded.agreementVersion.count()).toBe(0);
      await upgraded.$disconnect();
      const phoneFirstSql = await readFile(path.join(migrationsDir, phoneFirst, 'migration.sql'), 'utf8');
      await expect(psql(container, upgradeName, phoneFirstSql)).rejects.toThrow(
        /phone_first_refuses_nonempty_database/,
      );
      const refused = createPrismaClient(upgradeUrl.toString());
      const ownerAfter = await refused.$queryRaw<Array<{ phone: string | null }>>`
        SELECT phone FROM users WHERE id = ${ownerId}::uuid
      `;
      expect(ownerAfter[0]?.phone).toBeNull();
      expect((await refused.customer.findUniqueOrThrow({ where: { id: customerId } })).phoneNumber).toBe(
        '09120001111',
      );
      await refused.$disconnect();
    } finally {
      await psql(container, 'postgres', `DROP DATABASE IF EXISTS ${upgradeName} WITH (FORCE)`);
    }
  });

  async function phoneOwner(): Promise<{ phone: string; salonId: string; userId: string; completionId: string }> {
    const phone = `0912${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const salonId = createId();
    const userId = createId();
    const completionId = createId();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.client.$transaction(async (tx) => {
      await provisionSalonOwner(tx, {
        salonId,
        userId,
        salonName: 'سالن قرارداد',
        ownerName: 'نرگس رضایی',
        passwordHash,
        email: null,
        phone,
        accessState: 'AWAITING_AGREEMENT',
        additionalUsersAllowed: false,
        now: new Date(),
      });
      await tx.phoneOwnerCompletion.create({
        data: {
          id: completionId,
          idempotencyKey: `completion-${randomUUID()}`,
          requestHash: 'a'.repeat(64),
          salonId,
          userId,
        },
      });
    });
    return { phone, salonId, userId, completionId };
  }

  async function login(phone: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone, password })
      .expect(201);
    return response.body.accessToken as string;
  }

  async function legacyOwner(): Promise<{ token: string; salonId: string; userId: string }> {
    const session = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Legacy Salon',
      ownerName: 'Legacy Owner',
      password,
    });
    return { token: session.accessToken, salonId: session.salonId, userId: session.userId };
  }

  async function platformAdmin(): Promise<{ id: string; token: string }> {
    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Agreement Operator',
      password,
    });
    return { id: admin.adminId, token: admin.accessToken };
  }

  async function insertPresentation(input: {
    salonId: string;
    userId: string;
    versionId: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<string> {
    const id = createId();
    await prisma.client.agreementPresentation.create({
      data: {
        id,
        salonId: input.salonId,
        userId: input.userId,
        versionId: input.versionId,
        renderedDigest: 'b'.repeat(64),
        evidenceKeyId: 'env-1',
        declaredFieldsCiphertext: Buffer.alloc(17, 1),
        declaredFieldsNonce: Buffer.alloc(12, 2),
        renderedDocumentCiphertext: Buffer.alloc(17, 3),
        renderedDocumentNonce: Buffer.alloc(12, 4),
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      },
    });
    return id;
  }
});

function nationalId(base9: string): string {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(base9[index]) * (10 - index);
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return `${base9}${check}`;
}

function configure(nest: INestApplication): void {
  nest.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  nest.useGlobalFilters(new HttpExceptionFilter());
}

function resetThrottle(nest: INestApplication | undefined): void {
  const storage = nest?.get(ThrottlerStorage) as
    | { storage: Map<string, { totalHits: Map<string, number>; isBlocked: boolean }> }
    | undefined;
  if (!storage) return;
  for (const record of storage.storage.values()) {
    record.isBlocked = false;
    for (const name of record.totalHits.keys()) {
      record.totalHits.set(name, 0);
    }
  }
}

function psql(containerName: string, database: string, sql: string): Promise<void> {
  if (!/^salon_agreement_[a-z0-9_]+$/.test(database) && database !== 'postgres') {
    throw new Error('Refusing to run SQL against an unexpected database');
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['exec', '-i', containerName, 'psql', '-U', 'salon', '-d', database, '-v', 'ON_ERROR_STOP=1'],
      { maxBuffer: 20_000_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      },
    );
    child.stdin?.end(sql);
  });
}
