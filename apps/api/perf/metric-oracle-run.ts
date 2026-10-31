/**
 * Disposable correctness and baseline runner.
 *
 * Refuses every canonical database identity. Does not read root .env.
 * Does not change production query code. Prints current calculator output
 * beside an independent expected fixture.
 *
 *   tsx perf/metric-oracle-run.ts --destructive-reset
 *
 * Truncates only salon_metric_oracle_edge_20261031 on 127.0.0.1:55931.
 * Refuses the populated benchmark database and every canonical identity.
 * Migrations must already be applied. Does not read root .env.
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Prisma, createPrismaClient, type PrismaClient } from '@salon/database';
import { comparableJalaliMonthWindows, type AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SalonOverallPerformanceRepository } from '../src/salon/salon-overall-performance.repository';
import { ListRevenueDropsUseCase } from '../src/intelligence/list-revenue-drops.use-case';
import { GetIntelligenceSummaryUseCase } from '../src/intelligence/get-intelligence-summary.use-case';
import { IntelligenceQueryService } from '../src/intelligence/intelligence-query.service';
import { VipRepository } from '../src/vip/vip.repository';
import {
  ordinaryRequestedMessageQuantityExcludingCancelled,
  ordinaryRequestedMessageQuantityIncludingCancelled,
  recordedSendCount,
  vipRequestedMessageQuantity,
  vipRequestedMessageQuantityIncludingOpenDrafts,
  type OrdinaryRequestFact,
  type RecordedSendFact,
  type VipRequestQuantityFact,
} from '../src/salon/metric-oracle/message-quantity';

const SUPER_URL = 'postgresql://salon@127.0.0.1:55931/salon_metric_oracle_edge_20261031';
const APP_URL = 'postgresql://salon_app@127.0.0.1:55931/salon_metric_oracle_edge_20261031';
const EXPECTED_DATABASE = 'salon_metric_oracle_edge_20261031';
const EXPECTED_PORT = '55931';
const EXPECTED_COMMENT = 'metric-oracle-edge-disposable:20261031';
const PROTECTED_BENCHMARK = 'salon_metric_oracle_20261030';
const REFUSED_SYSTEM_IDS = new Set([
  '7700113693112733735',
  '7683163620851879970',
]);
const REFUSED_DATABASES = new Set([
  'salon',
  'salon-db',
  'salon_preview',
  'phone_first_product',
]);

const EDGE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SCALE_SMALL = '33333333-3333-4333-8333-333333333331';
const SCALE_MEDIUM = '33333333-3333-4333-8333-333333333335';
const ADMIN = '00000000-0000-4000-8000-0000000000aa';
const EDGE_USER = '11111111-1111-4111-8111-1111111111aa';
const OTHER_USER = '22222222-2222-4222-8222-2222222222aa';
const SCALE_USER = '33333333-3333-4333-8333-3333333333aa';

type MoneyFact = { status: 'COMPLETED' | 'VOIDED'; occurredAt: Date; amount: string };
type DeliveryFact = RecordedSendFact & { kind: 'ordinary' | 'vip' };

function assertTarget(url: string): URL {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== EXPECTED_PORT) {
    throw new Error('Refusing a database that is not the disposable loopback target');
  }
  if (REFUSED_DATABASES.has(database) || database === PROTECTED_BENCHMARK || database !== EXPECTED_DATABASE) {
    throw new Error('Refusing a database name that is not the disposable edge oracle');
  }
  return parsed;
}

function minorUnits(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  const frac = `${fraction}00`.slice(0, 2);
  return BigInt(whole) * 100n + BigInt(frac);
}

function formatMinor(value: bigint): string {
  const whole = value / 100n;
  const fraction = value % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function assertIdentity(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRaw<Array<{
    databaseName: string;
    systemIdentifier: string;
    databaseComment: string | null;
  }>>`
    SELECT current_database() AS "databaseName",
           (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
           (SELECT description
              FROM pg_catalog.pg_shdescription
              JOIN pg_catalog.pg_database ON objoid = pg_database.oid
             WHERE datname = current_database()) AS "databaseComment"
  `;
  const row = rows[0];
  if (!row || row.databaseName !== EXPECTED_DATABASE || row.databaseComment !== EXPECTED_COMMENT) {
    throw new Error('Disposable database identity does not match the oracle marker');
  }
  if (REFUSED_SYSTEM_IDS.has(row.systemIdentifier)) {
    throw new Error('Refusing a canonical PostgreSQL system identifier');
  }
  return row.systemIdentifier;
}

function instrument(url: string): {
  client: PrismaClient;
  counts: () => number;
  reset: () => void;
  lastQuery: () => { text: string; values: unknown[] } | null;
} {
  const base = createPrismaClient(url, { connectionLimit: 10, poolTimeoutSeconds: 10 });
  let queries = 0;
  let captured: { text: string; values: unknown[] } | null = null;
  const client = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === '$queryRaw') {
        return async (query: { text?: string; values?: unknown[] }, ...rest: unknown[]) => {
          queries += 1;
          if (query && typeof query.text === 'string') {
            captured = { text: query.text, values: query.values ?? [] };
          }
          return (target.$queryRaw as (...args: unknown[]) => Promise<unknown>)(query, ...rest);
        };
      }
      if (prop === '$executeRaw') {
        return async (...args: unknown[]) => {
          queries += 1;
          return (target.$executeRaw as (...inner: unknown[]) => Promise<unknown>)(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]) => {
        if (typeof prop === 'string' && prop.startsWith('$')) {
          queries += 1;
        }
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as PrismaClient;
  return {
    client,
    counts: () => queries,
    reset: () => {
      queries = 0;
    },
    lastQuery: () => captured,
  };
}

async function seedEdge(db: PrismaClient, now: Date): Promise<{
  ordinary: OrdinaryRequestFact[];
  vip: VipRequestQuantityFact[];
  ordinaryDeliveries: RecordedSendFact[];
  vipDeliveries: RecordedSendFact[];
  money: MoneyFact[];
  commitments: number;
  openCommitments: number;
  openIntentions: number;
  messageAssociatedCustomers: number;
  returningCustomers: number;
  customers: number;
}> {
  const windows = comparableJalaliMonthWindows(now);
  const inMonth = new Date(windows.currentStart.getTime() + 3_600_000);
  const beforeMonth = new Date(windows.currentStart.getTime() - 86_400_000);
  const sentAt = new Date(now.getTime() - 10 * 86_400_000);
  const afterSend = new Date(sentAt.getTime() + 2 * 86_400_000);
  const beforeSend = new Date(sentAt.getTime() - 2 * 86_400_000);

  await db.platformAdmin.create({
    data: {
      id: ADMIN,
      phone: '09120000003',
      passwordHash: 'not-a-login',
      name: 'Oracle Admin',
      updatedAt: now,
    },
  });
  await db.salon.createMany({
    data: [
      { id: EDGE, name: 'Edge Salon', updatedAt: now },
      { id: OTHER, name: 'Other Salon', updatedAt: now },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: EDGE_USER,
        salonId: EDGE,
        name: 'Edge Owner',
        phone: '09120000001',
        passwordHash: 'not-a-login',
        role: 'OWNER',
        updatedAt: now,
      },
      {
        id: OTHER_USER,
        salonId: OTHER,
        name: 'Other Owner',
        phone: '09120000002',
        passwordHash: 'not-a-login',
        role: 'OWNER',
        updatedAt: now,
      },
    ],
  });

  const sara = '11111111-1111-4111-8111-0000000000a1';
  const neda = '11111111-1111-4111-8111-0000000000a2';
  const lila = '11111111-1111-4111-8111-0000000000a3';
  const dana = '11111111-1111-4111-8111-0000000000a4';
  const otherCustomer = '22222222-2222-4222-8222-0000000000b1';
  await db.customer.createMany({
    data: [
      { id: sara, salonId: EDGE, firstName: 'Sara', lastName: 'A', phoneNumber: '09121000001', updatedAt: now },
      { id: neda, salonId: EDGE, firstName: 'Neda', lastName: 'B', phoneNumber: '09121000002', updatedAt: now },
      { id: lila, salonId: EDGE, firstName: 'Lila', lastName: 'C', phoneNumber: '09121000003', updatedAt: now },
      { id: dana, salonId: EDGE, firstName: 'Dana', lastName: 'D', phoneNumber: '09121000004', updatedAt: now },
      { id: otherCustomer, salonId: OTHER, firstName: 'Other', lastName: 'X', phoneNumber: '09122000001', updatedAt: now },
    ],
  });

  const saraOld = '11111111-1111-4111-8111-0000000000c1';
  const saraReturn = '11111111-1111-4111-8111-0000000000c2';
  const nedaVisit = '11111111-1111-4111-8111-0000000000c3';
  const lilaVisit = '11111111-1111-4111-8111-0000000000c4';
  const otherVisit = '22222222-2222-4222-8222-0000000000c5';
  await db.visit.createMany({
    data: [
      { id: saraOld, salonId: EDGE, customerId: sara, visitedAt: beforeSend, updatedAt: now },
      { id: saraReturn, salonId: EDGE, customerId: sara, visitedAt: afterSend, updatedAt: now },
      { id: nedaVisit, salonId: EDGE, customerId: neda, visitedAt: afterSend, updatedAt: now },
      { id: lilaVisit, salonId: EDGE, customerId: lila, visitedAt: beforeSend, updatedAt: now },
      { id: otherVisit, salonId: OTHER, customerId: otherCustomer, visitedAt: afterSend, updatedAt: now },
    ],
  });

  const money: MoneyFact[] = [
    { status: 'COMPLETED', occurredAt: inMonth, amount: '1500.50' },
    { status: 'VOIDED', occurredAt: inMonth, amount: '999.99' },
    { status: 'COMPLETED', occurredAt: beforeMonth, amount: '100.00' },
    { status: 'COMPLETED', occurredAt: inMonth, amount: '0.01' },
    { status: 'COMPLETED', occurredAt: inMonth, amount: '12345678901234567.89' },
  ];
  await db.service.createMany({
    data: [
      { id: '11111111-1111-4111-8111-0000000000aa', salonId: EDGE, name: 'Cut', updatedAt: now },
      { id: '22222222-2222-4222-8222-0000000000aa', salonId: OTHER, name: 'Cut', updatedAt: now },
    ],
  });
  const edgeTransactions = [
    { id: '11111111-1111-4111-8111-0000000000d1', salonId: EDGE, customerId: sara, occurredAt: inMonth, amount: '1500.50', status: 'COMPLETED' as const },
    { id: '11111111-1111-4111-8111-0000000000d2', salonId: EDGE, customerId: sara, occurredAt: inMonth, amount: '999.99', status: 'VOIDED' as const },
    { id: '11111111-1111-4111-8111-0000000000d3', salonId: EDGE, customerId: sara, occurredAt: beforeMonth, amount: '100.00', status: 'COMPLETED' as const },
    { id: '11111111-1111-4111-8111-0000000000d4', salonId: EDGE, customerId: neda, occurredAt: inMonth, amount: '0.01', status: 'COMPLETED' as const },
    { id: '11111111-1111-4111-8111-0000000000d5', salonId: EDGE, customerId: lila, occurredAt: inMonth, amount: '12345678901234567.89', status: 'COMPLETED' as const },
    { id: '22222222-2222-4222-8222-0000000000d6', salonId: OTHER, customerId: otherCustomer, occurredAt: inMonth, amount: '500.00', status: 'COMPLETED' as const },
  ];
  await db.$transaction(async (tx) => {
    await tx.ledgerTransaction.createMany({
      data: edgeTransactions.map((row) => ({ ...row, updatedAt: now })),
    });
    await tx.transactionItem.createMany({
      data: edgeTransactions.map((row, index) => ({
        id: `11111111-1111-4111-8111-000000000a${index.toString(16).padStart(2, '0')}`,
        salonId: row.salonId,
        transactionId: row.id,
        serviceId: row.salonId === EDGE
          ? '11111111-1111-4111-8111-0000000000aa'
          : '22222222-2222-4222-8222-0000000000aa',
        quantity: 1,
        unitPrice: row.amount,
        totalAmount: row.amount,
      })),
    });
  });

  async function ordinaryMessage(input: {
    id: string;
    deliveryId?: string;
    customerId: string;
    phone: string;
    status: OrdinaryRequestFact['status'];
    day: string;
    delivery?: RecordedSendFact;
  }): Promise<void> {
    await db.messageRequest.create({
      data: {
        id: input.id,
        salonId: EDGE,
        customerId: input.customerId,
        createdByUserId: EDGE_USER,
        recipientPhoneNumber: input.phone,
        messageText: 'fixture',
        messageBusinessDate: new Date(`${input.day}T00:00:00.000Z`),
        countsTowardDailyLimit: true,
        status: input.status,
        requestedAt: sentAt,
        updatedAt: now,
      },
    });
    if (!input.delivery || !input.deliveryId) {
      return;
    }
    await db.messageDelivery.create({
      data: {
        id: input.deliveryId,
        salonId: EDGE,
        messageRequestId: input.id,
        customerId: input.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: input.delivery.status,
        providerRequestId: input.id,
        attempts: input.delivery.attempts,
        createdBy: EDGE_USER,
        submittedAt: input.delivery.submittedAt,
        updatedAt: now,
      },
    });
  }

  const saraSent: RecordedSendFact = { status: 'SENT', submittedAt: sentAt, attempts: 1 };
  const nedaSent: RecordedSendFact = { status: 'SENT', submittedAt: sentAt, attempts: 1 };
  const lilaSent: RecordedSendFact = { status: 'SENT', submittedAt: sentAt, attempts: 1 };
  await ordinaryMessage({
    id: '11111111-1111-4111-8111-0000000000e1',
    deliveryId: '11111111-1111-4111-8111-0000000001e1',
    customerId: sara,
    phone: '09121000001',
    status: 'SENT',
    day: '2026-10-01',
    delivery: saraSent,
  });
  await ordinaryMessage({
    id: '11111111-1111-4111-8111-0000000000e2',
    deliveryId: '11111111-1111-4111-8111-0000000001e2',
    customerId: neda,
    phone: '09121000002',
    status: 'SENT',
    day: '2026-10-02',
    delivery: nedaSent,
  });
  await ordinaryMessage({
    id: '11111111-1111-4111-8111-0000000000e3',
    customerId: neda,
    phone: '09121000002',
    status: 'QUEUED',
    day: '2026-10-03',
  });
  await ordinaryMessage({
    id: '11111111-1111-4111-8111-0000000000e4',
    customerId: neda,
    phone: '09121000002',
    status: 'CANCELLED',
    day: '2026-10-04',
  });
  await ordinaryMessage({
    id: '11111111-1111-4111-8111-0000000000e5',
    deliveryId: '11111111-1111-4111-8111-0000000001e5',
    customerId: lila,
    phone: '09121000003',
    status: 'SENT',
    day: '2026-10-06',
    delivery: lilaSent,
  });

  await db.returnCommitment.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f1',
      salonId: EDGE,
      customerId: neda,
      sourceMessageRequestId: '11111111-1111-4111-8111-0000000000e2',
      sourceMessageDeliveryId: '11111111-1111-4111-8111-0000000001e2',
      expectedAt: new Date(sentAt.getTime() + 86_400_000),
      actualVisitId: nedaVisit,
      createdByUserId: EDGE_USER,
      updatedByUserId: EDGE_USER,
      updatedAt: now,
    },
  });
  await db.returnCommitment.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f2',
      salonId: EDGE,
      customerId: lila,
      sourceMessageRequestId: '11111111-1111-4111-8111-0000000000e5',
      sourceMessageDeliveryId: '11111111-1111-4111-8111-0000000001e5',
      expectedAt: new Date(sentAt.getTime() + 86_400_000),
      createdByUserId: EDGE_USER,
      updatedByUserId: EDGE_USER,
      updatedAt: now,
    },
  });

  await db.returnCommitment.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f4',
      salonId: EDGE,
      customerId: sara,
      sourceMessageRequestId: '11111111-1111-4111-8111-0000000000e1',
      sourceMessageDeliveryId: '11111111-1111-4111-8111-0000000001e1',
      expectedAt: new Date(sentAt.getTime() + 86_400_000),
      createdByPlatformAdminId: ADMIN,
      updatedByPlatformAdminId: ADMIN,
      updatedAt: now,
    },
  });

  await db.visitIntention.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f3',
      salonId: EDGE,
      subject: 'CUSTOMER',
      customerId: dana,
      timePrecision: 'UNKNOWN',
      reportChannel: 'SALON_STAFF',
      contactBasis: 'WITHHELD',
      createdByUserId: EDGE_USER,
      updatedByUserId: EDGE_USER,
      updatedAt: now,
    },
  });
  await db.visitIntention.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f7',
      salonId: EDGE,
      subject: 'CUSTOMER',
      customerId: sara,
      timePrecision: 'INSTANT',
      agreedInstant: afterSend,
      reportChannel: 'SALON_STAFF',
      contactBasis: 'WITHHELD',
      linkedVisitId: saraOld,
      linkedCustomerId: sara,
      createdByUserId: EDGE_USER,
      updatedByUserId: EDGE_USER,
      updatedAt: now,
    },
  });

  const vipFacts: VipRequestQuantityFact[] = [
    { status: 'AWAITING_SAMPLE_WORK', requestedCount: 30 },
    { status: 'SUBMITTED', requestedCount: 50 },
    { status: 'BALE_NOT_IMPLEMENTED', requestedCount: 30 },
    { status: 'MANUAL_QUEUED', requestedCount: 50 },
    { status: 'CANCELLED', requestedCount: 30 },
  ];
  const vipIds = [
    '11111111-1111-4111-8111-000000000101',
    '11111111-1111-4111-8111-000000000102',
    '11111111-1111-4111-8111-000000000103',
    '11111111-1111-4111-8111-000000000104',
    '11111111-1111-4111-8111-000000000105',
  ];
  for (let index = 0; index < vipFacts.length; index += 1) {
    const fact = vipFacts[index]!;
    const listId = `11111111-1111-4111-8111-00000000020${index}`;
    await db.vipTargetList.create({
      data: {
        id: listId,
        name: `List ${index}`,
        status: fact.status === 'AWAITING_SAMPLE_WORK' ? 'IN_USE' : 'ACTIVE',
        contactCount: fact.requestedCount,
        createdByAdminId: ADMIN,
        reservedBySalonId: fact.status === 'AWAITING_SAMPLE_WORK' ? EDGE : null,
        reservedAt: fact.status === 'AWAITING_SAMPLE_WORK' ? now : null,
        updatedAt: now,
      },
    });
    await db.vipRequest.create({
      data: {
        id: vipIds[index]!,
        salonId: EDGE,
        listId,
        createdByUserId: EDGE_USER,
        requestedCount: fact.requestedCount,
        geographicRange: 'fixture',
        status: fact.status,
        reservedUntil: fact.status === 'AWAITING_SAMPLE_WORK'
          ? new Date(now.getTime() + 86_400_000)
          : new Date(now.getTime() - 86_400_000),
        submittedAt: fact.status === 'AWAITING_SAMPLE_WORK' || fact.status === 'CANCELLED'
          ? null
          : now,
        cancelledAt: fact.status === 'CANCELLED' ? now : null,
        updatedAt: now,
      },
    });
  }

  const manualId = vipIds[3]!;
  const vipDeliveries: RecordedSendFact[] = [];
  for (let index = 0; index < 48; index += 1) {
    const requestId = `11111111-1111-4111-8112-${index.toString(16).padStart(12, '0')}`;
    const sent = index < 10;
    const failed = index === 10;
    const cancelled = index === 11;
    const status = cancelled ? 'CANCELLED' : sent ? 'SENT' : failed ? 'FAILED' : 'QUEUED';
    await db.messageRequest.create({
      data: {
        id: requestId,
        salonId: EDGE,
        createdByUserId: EDGE_USER,
        vipRequestId: manualId,
        recipientPhoneNumber: `0913${index.toString().padStart(7, '0')}`,
        messageText: 'fixture',
        messageBusinessDate: new Date('2026-10-05T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status,
        requestedAt: now,
        updatedAt: now,
      },
    });
    if (sent || failed) {
      const delivery: RecordedSendFact = {
        status: sent ? 'SENT' : 'FAILED',
        submittedAt: sent ? now : null,
        attempts: sent && index === 0 ? 3 : 1,
      };
      vipDeliveries.push(delivery);
      await db.messageDelivery.create({
        data: {
          id: `11111111-1111-4111-8113-${index.toString(16).padStart(12, '0')}`,
          salonId: EDGE,
          messageRequestId: requestId,
          mode: 'MANUAL',
          channel: 'TEXT',
          status: delivery.status,
          providerRequestId: requestId,
          attempts: delivery.attempts,
          createdBy: EDGE_USER,
          submittedAt: delivery.submittedAt,
          failedAt: delivery.status === 'FAILED' ? now : null,
          updatedAt: now,
        },
      });
    }
  }

  const otherList = '22222222-2222-4222-8222-000000000201';
  await db.vipTargetList.create({
    data: {
      id: otherList,
      name: 'Other stale list',
      status: 'IN_USE',
      contactCount: 30,
      createdByAdminId: ADMIN,
      reservedBySalonId: OTHER,
      reservedAt: now,
      updatedAt: now,
    },
  });
  await db.vipRequest.create({
    data: {
      id: '22222222-2222-4222-8222-000000000301',
      salonId: OTHER,
      listId: otherList,
      createdByUserId: OTHER_USER,
      requestedCount: 100,
      geographicRange: 'other',
      status: 'SUBMITTED',
      reservedUntil: new Date(now.getTime() + 86_400_000),
      submittedAt: now,
      updatedAt: now,
    },
  });
  await db.vipRequest.create({
    data: {
      id: '22222222-2222-4222-8222-000000000302',
      salonId: OTHER,
      listId: otherList,
      createdByUserId: OTHER_USER,
      requestedCount: 30,
      geographicRange: 'stale',
      status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: new Date(now.getTime() - 3_600_000),
      updatedAt: now,
    },
  });

  const submittedRequest = vipIds[1]!;
  await db.visitIntention.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f5',
      salonId: EDGE,
      subject: 'CUSTOMER',
      customerId: neda,
      timePrecision: 'DATE',
      agreedDate: new Date('2026-11-02T00:00:00.000Z'),
      reportChannel: 'TOLD_PLATFORM_ADMIN',
      contactBasis: 'WITHHELD',
      createdByPlatformAdminId: ADMIN,
      updatedByPlatformAdminId: ADMIN,
      updatedAt: now,
    },
  });
  await db.visitIntention.create({
    data: {
      id: '11111111-1111-4111-8111-0000000000f6',
      salonId: EDGE,
      subject: 'VIP_PROSPECT',
      vipRequestId: submittedRequest,
      timePrecision: 'INSTANT',
      agreedInstant: now,
      reportChannel: 'INBOUND_TO_SALON',
      contactBasis: 'WITHHELD',
      createdByUserId: EDGE_USER,
      updatedByUserId: EDGE_USER,
      updatedAt: now,
    },
  });

  await db.messageRequest.create({
    data: {
      id: '22222222-2222-4222-8222-0000000000e1',
      salonId: OTHER,
      customerId: otherCustomer,
      createdByUserId: OTHER_USER,
      recipientPhoneNumber: '09122000001',
      messageText: 'fixture',
      messageBusinessDate: new Date('2026-10-07T00:00:00.000Z'),
      countsTowardDailyLimit: false,
      status: 'SENT',
      requestedAt: now,
      updatedAt: now,
    },
  });
  await db.messageDelivery.create({
    data: {
      id: '22222222-2222-4222-8222-0000000001e1',
      salonId: OTHER,
      messageRequestId: '22222222-2222-4222-8222-0000000000e1',
      customerId: otherCustomer,
      mode: 'MANUAL',
      channel: 'TEXT',
      status: 'SENT',
      providerRequestId: '22222222-2222-4222-8222-0000000000e1',
      attempts: 1,
      createdBy: OTHER_USER,
      submittedAt: now,
      updatedAt: now,
    },
  });
  await db.returnCommitment.create({
    data: {
      id: '22222222-2222-4222-8222-0000000000f1',
      salonId: OTHER,
      customerId: otherCustomer,
      sourceMessageRequestId: '22222222-2222-4222-8222-0000000000e1',
      sourceMessageDeliveryId: '22222222-2222-4222-8222-0000000001e1',
      expectedAt: new Date(now.getTime() + 86_400_000),
      createdByUserId: OTHER_USER,
      updatedByUserId: OTHER_USER,
      updatedAt: now,
    },
  });
  await db.visitIntention.create({
    data: {
      id: '22222222-2222-4222-8222-0000000000f2',
      salonId: OTHER,
      subject: 'CUSTOMER',
      customerId: otherCustomer,
      timePrecision: 'UNKNOWN',
      reportChannel: 'SALON_STAFF',
      contactBasis: 'WITHHELD',
      createdByUserId: OTHER_USER,
      updatedByUserId: OTHER_USER,
      updatedAt: now,
    },
  });

  return {
    ordinary: [
      { status: 'SENT' },
      { status: 'SENT' },
      { status: 'QUEUED' },
      { status: 'CANCELLED' },
      { status: 'SENT' },
    ],
    vip: vipFacts,
    ordinaryDeliveries: [saraSent, nedaSent, lilaSent],
    vipDeliveries,
    money,
    commitments: 3,
    openCommitments: 1,
    openIntentions: 3,
    messageAssociatedCustomers: 2,
    returningCustomers: 1,
    customers: 4,
  };
}

async function seedScale(
  db: PrismaClient,
  salonId: string,
  customers: number,
  now: Date,
): Promise<void> {
  const windows = comparableJalaliMonthWindows(now);
  const userId = salonId === SCALE_SMALL ? SCALE_USER : '33333333-3333-4333-8333-3333333333ab';
  const phoneBase = salonId === SCALE_SMALL ? 100_000_000 : 200_000_000;
  await db.salon.create({ data: { id: salonId, name: `Scale ${customers}`, updatedAt: now } });
  const serviceId = salonId === SCALE_SMALL
    ? '33333333-3333-4333-8333-0000000000a1'
    : '33333333-3333-4333-8333-0000000000a2';
  await db.user.create({
    data: {
      id: userId,
      salonId,
      name: 'Scale Owner',
      phone: `09${phoneBase.toString().padStart(9, '0')}`.slice(0, 11),
      passwordHash: 'not-a-login',
      role: 'OWNER',
      updatedAt: now,
    },
  });
  await db.service.create({
    data: { id: serviceId, salonId, name: 'Scale service', updatedAt: now },
  });
  await db.$executeRaw`
    INSERT INTO customers (id, salon_id, first_name, last_name, phone_number, created_at, updated_at)
    SELECT (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':c:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':c:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':c:' || i::text), 8, 12)
      )::uuid,
      ${salonId}::uuid,
      'C',
      i::text,
      ('09' || lpad((${phoneBase} + i)::text, 9, '0')),
      ${now},
      ${now}
    FROM generate_series(1, ${customers}) AS i
  `;
  const customerId = Prisma.sql`(
    '33333333-3333-4' ||
    substr(md5(${salonId} || ':c:' || i::text), 1, 3) || '-' ||
    '8' || substr(md5(${salonId} || ':c:' || i::text), 5, 3) || '-' ||
    substr(md5(${salonId} || ':c:' || i::text), 8, 12)
  )::uuid`;
  await db.$executeRaw`
    INSERT INTO visits (id, salon_id, customer_id, visited_at, created_at, updated_at)
    SELECT (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':v:' || i::text || ':' || n::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':v:' || i::text || ':' || n::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':v:' || i::text || ':' || n::text), 8, 12)
      )::uuid,
      ${salonId}::uuid,
      ${customerId},
      ${windows.currentStart} - ((n * 20) || ' days')::interval,
      ${now},
      ${now}
    FROM generate_series(1, ${customers}) AS i
    JOIN generate_series(1, 2) AS n ON n = 1 OR i % 2 = 0
  `;
  await db.$transaction(async (tx) => {
  await tx.$executeRaw`
    INSERT INTO transactions (
      id, salon_id, customer_id, occurred_at, amount, currency, status, created_at, updated_at
    )
    SELECT (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':t:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':t:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':t:' || i::text), 8, 12)
      )::uuid,
      ${salonId}::uuid,
      ${customerId},
      CASE WHEN i % 3 = 0 THEN ${windows.previousStart} ELSE ${windows.currentStart} END,
      (1000 + (i % 100) * 0.01)::numeric(19, 2),
      'IRR',
      CASE WHEN i % 17 = 0 THEN 'VOIDED'::"TransactionStatus" ELSE 'COMPLETED'::"TransactionStatus" END,
      ${now},
      ${now}
    FROM generate_series(1, ${customers}) AS i
  `;
  await db.$executeRaw`
    INSERT INTO message_requests (
      id, salon_id, customer_id, created_by_user_id, recipient_phone_number, message_text,
      requested_at, message_business_date, counts_toward_daily_limit, status, created_at, updated_at
    )
    SELECT (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':m:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':m:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':m:' || i::text), 8, 12)
      )::uuid,
      ${salonId}::uuid,
      ${customerId},
      ${userId}::uuid,
      ('09' || lpad((${phoneBase} + i)::text, 9, '0')),
      'scale',
      ${windows.previousStart},
      ${windows.previousStart}::date,
      false,
      'SENT'::"MessageRequestStatus",
      ${now},
      ${now}
    FROM generate_series(1, ${customers}) AS i
  `;
  await db.$executeRaw`
    INSERT INTO message_deliveries (
      id, salon_id, message_request_id, customer_id, mode, channel, status,
      provider_request_id, attempts, created_by, submitted_at, created_at, updated_at
    )
    SELECT (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':d:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':d:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':d:' || i::text), 8, 12)
      )::uuid,
      ${salonId}::uuid,
      (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':m:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':m:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':m:' || i::text), 8, 12)
      )::uuid,
      ${customerId},
      'MANUAL'::"MessageDeliveryMode",
      'TEXT'::"MessageChannel",
      'SENT'::"MessageDeliveryStatus",
      md5(${salonId} || ':p:' || i::text),
      1,
      ${userId}::uuid,
      ${windows.previousStart},
      ${now},
      ${now}
    FROM generate_series(1, ${customers}) AS i
  `;
  await tx.$executeRaw`
    INSERT INTO transaction_items (
      id, salon_id, transaction_id, service_id, quantity, unit_price, total_amount
    )
    SELECT (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':i:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':i:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':i:' || i::text), 8, 12)
      )::uuid,
      ${salonId}::uuid,
      (
        '33333333-3333-4' ||
        substr(md5(${salonId} || ':t:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5(${salonId} || ':t:' || i::text), 5, 3) || '-' ||
        substr(md5(${salonId} || ':t:' || i::text), 8, 12)
      )::uuid,
      ${serviceId}::uuid,
      1,
      (1000 + (i % 100) * 0.01)::numeric(19, 2),
      (1000 + (i % 100) * 0.01)::numeric(19, 2)
    FROM generate_series(1, ${customers}) AS i
  `;
  });
}

function principal(tenantId: string): AuthenticatedPrincipal {
  return {
    userId: EDGE_USER,
    tenantId,
    role: 'OWNER',
    sessionScope: 'product',
    accessState: 'PRODUCT',
  } as AuthenticatedPrincipal;
}

function summarizePlan(plan: unknown): Record<string, unknown> {
  const root = Array.isArray(plan) ? plan[0] as Record<string, unknown> : null;
  const execution = root?.['Execution Time'];
  const planning = root?.['Planning Time'];
  const top = (root?.Plan ?? {}) as Record<string, unknown>;
  const scans: string[] = [];
  const spills: string[] = [];
  const walk = (node: Record<string, unknown> | undefined): void => {
    if (!node) return;
    if (node['Node Type'] === 'Seq Scan') {
      scans.push(String(node['Relation Name'] ?? 'unknown'));
    }
    if (typeof node['Sort Method'] === 'string' && String(node['Sort Space Type'] ?? '').includes('Disk')) {
      spills.push(String(node['Sort Method']));
    }
    const children = node.Plans;
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child as Record<string, unknown>);
      }
    }
  };
  walk(top);
  return {
    planningMs: planning ?? null,
    executionMs: execution ?? null,
    topNode: top['Node Type'] ?? null,
    actualRows: top['Actual Rows'] ?? null,
    sharedHit: top['Shared Hit Blocks'] ?? null,
    sharedRead: top['Shared Read Blocks'] ?? null,
    sequentialScans: scans,
    sortSpills: spills,
  };
}

async function explainQuery(
  db: PrismaClient,
  captured: { text: string; values: unknown[] },
): Promise<Record<string, unknown>> {
  const rows = await db.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.text}`,
    ...captured.values,
  );
  return summarizePlan(rows[0]?.['QUERY PLAN']);
}

async function timeCalls(runs: number, call: () => Promise<void>): Promise<{
  p50: number;
  p95: number;
  samples: number[];
}> {
  await call();
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await call();
    samples.push(performance.now() - started);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), samples };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--destructive-reset')) {
    throw new Error('Refusing to truncate without --destructive-reset');
  }
  assertTarget(SUPER_URL);
  assertTarget(APP_URL);
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(EXPECTED_DATABASE)) {
    throw new Error('Refusing to run while DATABASE_URL names a different database');
  }
  const superDb = createPrismaClient(SUPER_URL, { connectionLimit: 2, poolTimeoutSeconds: 10 });
  const systemIdentifier = await assertIdentity(superDb);
  await superDb.$executeRawUnsafe(`
    DO $$ DECLARE row record; BEGIN
      FOR row IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(row.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  const now = new Date();
  const windows = comparableJalaliMonthWindows(now);
  const facts = await seedEdge(superDb, now);
  await seedScale(superDb, SCALE_SMALL, 200, now);
  await seedScale(superDb, SCALE_MEDIUM, 5_000, now);
  await superDb.$executeRawUnsafe('ANALYZE');

  const app = instrument(APP_URL);
  await assertIdentity(app.client);
  const repository = new SalonOverallPerformanceRepository({ client: app.client } as PrismaService);
  app.reset();
  const actual = await repository.load(EDGE);
  const edgeQueries = app.counts();
  const edgeSql = app.lastQuery();

  const monthly = formatMinor(facts.money.reduce((sum, row) => {
    if (row.status !== 'COMPLETED') return sum;
    if (row.occurredAt < windows.currentStart || row.occurredAt > now) return sum;
    return sum + minorUnits(row.amount);
  }, 0n));
  const expected = {
    customerCount: facts.customers,
    salonCustomerSentMessageCount: recordedSendCount(facts.ordinaryDeliveries),
    salonCustomerMessageRequestCountIncludingCancelled:
      ordinaryRequestedMessageQuantityIncludingCancelled(facts.ordinary),
    salonCustomerMessageRequestCountExcludingCancelled:
      ordinaryRequestedMessageQuantityExcludingCancelled(facts.ordinary),
    vipSentMessageCount: recordedSendCount(facts.vipDeliveries),
    vipMessageQuantityAfterSubmit: vipRequestedMessageQuantity(facts.vip),
    vipMessageQuantityIncludingOpenDrafts: vipRequestedMessageQuantityIncludingOpenDrafts(facts.vip),
    monthlyRecordedRevenueIrr: monthly,
    historicalCommitments: facts.commitments,
    openReturnCommitments: facts.openCommitments,
    openIntentions: facts.openIntentions,
    agreedOperationalCount: facts.openCommitments + facts.openIntentions,
    messageAssociatedReturnedCustomerCount: facts.messageAssociatedCustomers,
    returningSalonCustomerCount: facts.returningCustomers,
  };

  const comparisons = [
    ['customerCount', actual.customerCount, expected.customerCount],
    ['ordinary recorded sends', actual.salonCustomerSentMessageCount, expected.salonCustomerSentMessageCount],
    ['ordinary requested including cancelled', actual.salonCustomerMessageRequestCount, expected.salonCustomerMessageRequestCountIncludingCancelled],
    ['ordinary requested excluding cancelled', actual.salonCustomerMessageRequestCount, expected.salonCustomerMessageRequestCountExcludingCancelled],
    ['VIP recorded sends', actual.vipSentMessageCount, expected.vipSentMessageCount],
    ['VIP requested after submit', actual.vipMessageRequestCount, expected.vipMessageQuantityAfterSubmit],
    ['VIP requested including open drafts', actual.vipMessageRequestCount, expected.vipMessageQuantityIncludingOpenDrafts],
    ['monthly revenue', actual.monthlyRecordedRevenueIrr, expected.monthlyRecordedRevenueIrr],
    ['historical commitments', actual.agreedReturnCount, expected.historicalCommitments],
    ['open commitments only', actual.agreedReturnCount, expected.openReturnCommitments],
    ['agreed operational', actual.agreedReturnCount, expected.agreedOperationalCount],
    ['message-associated customers', actual.messageAssociatedReturnedCustomerCount, expected.messageAssociatedReturnedCustomerCount],
    ['returning customers', actual.returningSalonCustomerCount, expected.returningSalonCustomerCount],
  ].map(([metric, current, oracle]) => ({
    metric,
    current,
    oracle,
    matches: String(current) === String(oracle),
  }));
  const populations = [
    expected.historicalCommitments,
    expected.openReturnCommitments,
    expected.agreedOperationalCount,
  ];
  if (new Set(populations).size !== populations.length) {
    throw new Error('Edge fixture does not separate historical, open, and operational totals');
  }
  const approved = comparisons.find((row) => row.metric === 'agreed operational');
  const rejected = comparisons.filter((row) =>
    row.metric === 'historical commitments' || row.metric === 'open commitments only');
  if (!approved?.matches || rejected.some((row) => row.matches)) {
    throw new Error('Dashboard agreed count does not match the operational oracle');
  }
  const otherActual = await repository.load(OTHER);
  if (otherActual.agreedReturnCount !== 2 || otherActual.customerCount !== 1) {
    throw new Error('Cross-tenant agreed count leaked or dropped an open row');
  }

  const revenueDrops = new ListRevenueDropsUseCase({ client: app.client } as PrismaService);
  const summary = new GetIntelligenceSummaryUseCase(
    new IntelligenceQueryService({ client: app.client } as PrismaService),
    { client: app.client } as PrismaService,
  );

  async function measure(label: string, salonId: string): Promise<Record<string, unknown>> {
    const overall = await timeCalls(3, async () => {
      app.reset();
      await repository.load(salonId);
    });
    const overallQueries = app.counts();
    const overallPlan = app.lastQuery()
      ? await explainQuery(superDb, app.lastQuery()!)
      : null;
    app.reset();
    const dropStarted = performance.now();
    await revenueDrops.execute(principal(salonId), undefined, now);
    const dropMs = performance.now() - dropStarted;
    const dropQueries = app.counts();
    app.reset();
    const summaryStarted = performance.now();
    await summary.execute(principal(salonId));
    const summaryMs = performance.now() - summaryStarted;
    const summaryQueries = app.counts();
    const counts = await superDb.$queryRaw<Array<Record<string, number>>>`
      SELECT
        (SELECT COUNT(*)::int FROM customers WHERE salon_id = ${salonId}::uuid) AS customers,
        (SELECT COUNT(*)::int FROM visits WHERE salon_id = ${salonId}::uuid) AS visits,
        (SELECT COUNT(*)::int FROM transactions WHERE salon_id = ${salonId}::uuid) AS transactions,
        (SELECT COUNT(*)::int FROM message_requests WHERE salon_id = ${salonId}::uuid) AS message_requests,
        (SELECT COUNT(*)::int FROM message_deliveries WHERE salon_id = ${salonId}::uuid) AS message_deliveries
    `;
    return {
      label,
      rows: counts[0],
      overallMs: { p50: overall.p50, p95: overall.p95 },
      overallQueries,
      overallPlan,
      revenueDropFirstPageMs: dropMs,
      revenueDropQueries: dropQueries,
      intelligenceSummaryMs: summaryMs,
      intelligenceSummaryQueries: summaryQueries,
    };
  }

  const measurements = [
    await measure('edge', EDGE),
    await measure('small-200', SCALE_SMALL),
    await measure('medium-5000', SCALE_MEDIUM),
  ];

  const otherDraftId = '22222222-2222-4222-8222-000000000302';
  const beforeRead = await superDb.vipRequest.findUnique({
    where: { id: otherDraftId },
    select: { status: true, salonId: true },
  });
  const vip = new VipRepository({ client: app.client } as PrismaService);
  await vip.summarizeAvailableRegions(now);
  await vip.listActiveListsByRegion('01', now);
  const afterRead = await superDb.vipRequest.findUnique({
    where: { id: otherDraftId },
    select: { status: true, salonId: true },
  });
  await app.client.$transaction((tx) =>
    vip.expireStaleReservations(now, tx, { mode: 'salon', salonId: EDGE }),
  );
  const afterEdgeCommand = await superDb.vipRequest.findUnique({
    where: { id: otherDraftId },
    select: { status: true, salonId: true },
  });
  await superDb.$transaction((tx) =>
    vip.expireStaleReservations(now, tx, { mode: 'platform', limit: 50 }),
  );
  const afterPlatform = await superDb.vipRequest.findUnique({
    where: { id: otherDraftId },
    select: { status: true, salonId: true },
  });

  const edgePlan = edgeSql ? await explainQuery(superDb, edgeSql) : null;
  const report = {
    database: EXPECTED_DATABASE,
    systemIdentifier,
    comment: EXPECTED_COMMENT,
    connectionLimit: 10,
    evaluatedAt: now.toISOString(),
    jalaliWindow: {
      currentStart: windows.currentStart.toISOString(),
      now: windows.now.toISOString(),
      timezone: windows.timezone,
    },
    edgeQueryCount: edgeQueries,
    edgePlan,
    comparisons,
    measurements,
    readPathMutation: {
      otherSalonDraftBeforeRead: beforeRead,
      otherSalonDraftAfterRegionsAndLists: afterRead,
      otherSalonDraftAfterEdgeSalonExpiry: afterEdgeCommand,
      otherSalonDraftAfterPlatformExpiry: afterPlatform,
    },
  };
  writeFileSync('/tmp/salon-metric-oracle-20261030-report.json', JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.client.$disconnect();
  await superDb.$disconnect();
}

main().catch((error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    process.stderr.write(`FAILED ${error.code}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`FAILED ${error.name}: ${error.message}\n`);
  } else {
    process.stderr.write('FAILED\n');
  }
  process.exit(1);
});
