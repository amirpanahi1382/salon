import { deriveVipRequestProgress } from '@salon/shared';
import {
  historyMetrics,
  ListSalonVipRequestHistoryUseCase,
} from './list-salon-vip-request-history.use-case';
import type { SalonVipProgressFact } from './vip.repository';

function fact(partial: Partial<SalonVipProgressFact>): SalonVipProgressFact {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'SUBMITTED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    reservedUntil: new Date('2026-01-02T00:00:00.000Z'),
    submittedAt: new Date('2026-01-01T12:00:00.000Z'),
    cancelledAt: null,
    requestedCount: 10,
    recipientCount: 10,
    notYetQueuedCount: 2,
    queuedCount: 1,
    inPipelineCount: 1,
    sentCount: 5,
    manualSentCount: 2,
    failedCount: 1,
    cancelledCount: 0,
    globallyStoppedCount: 0,
    activeStopWithoutDurableSkipCount: 0,
    latestManualSentAt: null,
    ...partial,
  };
}

describe('VIP request history metrics', () => {
  it('marks cancelled drafts without recipients as UNAVAILABLE instead of inventing zeros', () => {
    const result = historyMetrics(
      { status: 'CANCELLED', submittedAt: null },
      fact({ recipientCount: 0, sentCount: 0, notYetQueuedCount: 0, queuedCount: 0, inPipelineCount: 0 }),
      undefined,
    );
    expect(result.metricsAvailability).toBe('UNAVAILABLE');
    expect(result.intentionRecipientCount).toBeNull();
    expect(result.visitedRecipientCount).toBeNull();
    expect(result.recipientDenominator).toBeNull();
  });

  it('marks missing progress facts as UNAVAILABLE', () => {
    const result = historyMetrics({ status: 'SUBMITTED', submittedAt: new Date() }, undefined, {
      vipRequestId: 'x',
      intentionRecipientCount: 3,
      visitedRecipientCount: 1,
    });
    expect(result.metricsAvailability).toBe('UNAVAILABLE');
    expect(result.intentionRecipientCount).toBeNull();
    expect(result.visitedRecipientCount).toBeNull();
  });

  it('counts recorded sends and in-progress without treating send as confirmed delivery', () => {
    const result = historyMetrics(
      { status: 'SUBMITTED', submittedAt: new Date() },
      fact({
        sentCount: 4,
        manualSentCount: 1,
        notYetQueuedCount: 2,
        queuedCount: 3,
        inPipelineCount: 1,
        recipientCount: 10,
      }),
      { vipRequestId: 'x', intentionRecipientCount: 2, visitedRecipientCount: 1 },
    );
    expect(result.metricsAvailability).toBe('AVAILABLE');
    expect(result.recordedSendCount).toBe(4);
    expect(result.manualRecordedSendCount).toBe(1);
    expect(result.stillQueuedOrInProgressCount).toBe(6);
    expect(result.intentionRecipientCount).toBe(2);
    expect(result.visitedRecipientCount).toBe(1);
    expect(result.recipientDenominator).toBe(10);
  });

  it('uses zero intention/visit counts only when the recipient graph is trustworthy', () => {
    const result = historyMetrics(
      { status: 'FULFILLED', submittedAt: new Date() },
      fact({ recipientCount: 8, sentCount: 8 }),
      undefined,
    );
    expect(result.metricsAvailability).toBe('AVAILABLE');
    expect(result.intentionRecipientCount).toBe(0);
    expect(result.visitedRecipientCount).toBe(0);
    expect(result.recipientDenominator).toBe(8);
  });

  it('does not double-count when intention SQL already returns distinct recipients', () => {
    const result = historyMetrics(
      { status: 'SUBMITTED', submittedAt: new Date() },
      fact({ recipientCount: 5 }),
      { vipRequestId: 'x', intentionRecipientCount: 1, visitedRecipientCount: 1 },
    );
    expect(result.intentionRecipientCount).toBe(1);
    expect(result.visitedRecipientCount).toBe(1);
  });

  it('derives expired draft display from reservedUntil without requiring a status write', () => {
    const now = new Date('2026-01-01T13:00:00.000Z');
    const progress = deriveVipRequestProgress(
      {
        status: 'AWAITING_SAMPLE_WORK',
        now,
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        reservedUntil: new Date('2026-01-01T12:30:00.000Z'),
        submittedAt: null,
        cancelledAt: null,
        requestedCount: 10,
        recipientCount: -1,
        notYetQueuedCount: 0,
        queuedCount: 0,
        inPipelineCount: 0,
        sentCount: 0,
        manualSentCount: 0,
        failedCount: 0,
        cancelledMessageCount: 0,
        durablySkippedCount: 0,
        activeStopWithoutDurableSkipCount: 0,
        latestManualSentAt: null,
      },
      'SALON',
    );
    expect(progress.reservationStillValid).toBe(false);
    expect(progress.headline).toBe('دوباره تلاش کنید');
  });
});

describe('VIP request history use case read path', () => {
  const salonId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherSalonId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const requestId = '11111111-1111-1111-1111-111111111111';

  function principal(tenantId: string) {
    return {
      userId: 'u1',
      tenantId,
      role: 'OWNER' as const,
      sessionScope: 'product' as const,
    };
  }

  it('returns historical requests when entitlement is revoked and never expires reservations', async () => {
    const expireStaleReservations = jest.fn();
    const findActiveEntitlement = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: requestId,
        salonId,
        listId: 'list-1',
        requestedCount: 5,
        geographicRange: 'تهران',
        status: 'SUBMITTED',
        reservedUntil: new Date('2026-01-02T00:00:00.000Z'),
        submittedAt: new Date('2026-01-01T12:00:00.000Z'),
        createdAt: new Date('2026-01-01T11:00:00.000Z'),
        salon: { name: 'Rose' },
        list: { name: 'List A' },
        sampleWorks: [],
      },
    ]);
    const recipientProgressFacts = jest.fn().mockResolvedValue(
      new Map([[requestId, fact({ id: requestId, recipientCount: 5, sentCount: 2 })]]),
    );
    const queryRaw = jest.fn().mockResolvedValue([
      { vipRequestId: requestId, intentionRecipientCount: 1, visitedRecipientCount: 0 },
    ]);

    const vip = {
      findActiveEntitlement,
      expireStaleReservations,
      recipientProgressFacts,
      client: {
        vipRequest: { findMany },
        $queryRaw: queryRaw,
        $transaction: jest.fn(),
      },
    };

    const useCase = new ListSalonVipRequestHistoryUseCase(vip as never);
    const result = await useCase.execute(principal(salonId));

    expect(result.entitled).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(requestId);
    expect(result.items[0]!.listName).toBe('List A');
    expect(expireStaleReservations).not.toHaveBeenCalled();
    expect(vip.client.$transaction).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ salonId }),
      }),
    );
  });

  it('scopes list queries to the authenticated salon only', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const vip = {
      findActiveEntitlement: jest.fn().mockResolvedValue({ id: 'ent' }),
      expireStaleReservations: jest.fn(),
      recipientProgressFacts: jest.fn().mockResolvedValue(new Map()),
      client: {
        vipRequest: { findMany },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $transaction: jest.fn(),
      },
    };
    const useCase = new ListSalonVipRequestHistoryUseCase(vip as never);
    await useCase.execute(principal(otherSalonId));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ salonId: otherSalonId }),
      }),
    );
    expect(vip.expireStaleReservations).not.toHaveBeenCalled();
  });
});
