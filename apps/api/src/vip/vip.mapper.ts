import {
  deriveVipRequestProgress,
  isVipRegionCode,
  vipRegionName,
  type VipProgressFacts,
  type VipRequestProgress,
} from '@salon/shared';
import type { SalonVipProgressFact } from './vip.repository';
import type { VipRequestDto, VipSampleWorkDto, VipTargetListSummaryDto } from './vip.dto';
import { isVipListRequestableBySalons } from './vip-list-request-counts';

export function toListSummary(
  row: {
    id: string;
    name: string;
    regionCode?: string | null;
    status: VipTargetListSummaryDto['status'];
    catalogMembership: VipTargetListSummaryDto['catalogMembership'];
    contactCount: number;
    reservedBySalonId: string | null;
    reservedBySalon: { name: string } | null;
    createdAt: Date;
    updatedAt: Date;
    requests: Array<{ id: string }>;
  },
  requestCounts?: { totalRequestCount: number; openRequestCount: number },
): VipTargetListSummaryDto {
  const regionCode = row.regionCode && isVipRegionCode(row.regionCode) ? row.regionCode : null;
  const requestableBySalons = isVipListRequestableBySalons(row);
  return {
    id: row.id,
    name: row.name,
    regionCode,
    regionName: regionCode ? vipRegionName(regionCode) : null,
    status: row.status,
    catalogMembership: row.catalogMembership,
    contactCount: row.contactCount,
    reservedBySalonId: row.reservedBySalonId,
    reservedBySalonName: row.reservedBySalon?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attentionRequestId: row.requests[0]?.id ?? null,
    requestableBySalons,
    totalRequestCount: requestCounts?.totalRequestCount ?? 0,
    openRequestCount: requestCounts?.openRequestCount ?? 0,
  };
}

export function toSampleWork(row: {
  id: string;
  position: number;
  contentType: string;
  byteSize: number;
}): VipSampleWorkDto {
  return {
    id: row.id,
    position: row.position,
    contentType: row.contentType,
    byteSize: row.byteSize,
  };
}

export function toVipRequest(row: {
  id: string;
  salonId: string;
  salon: { name: string };
  listId: string;
  list: { name: string };
  requestedCount: number;
  geographicRange: string;
  status: VipRequestDto['status'];
  reservedUntil: Date;
  submittedAt: Date | null;
  createdAt: Date;
  sampleWorks: Array<{
    id: string;
    position: number;
    contentType: string;
    byteSize: number;
  }>;
}, progress?: VipRequestProgress): VipRequestDto {
  return {
    id: row.id,
    salonId: row.salonId,
    salonName: row.salon.name,
    listId: row.listId,
    listName: row.list.name,
    requestedCount: row.requestedCount,
    geographicRange: row.geographicRange,
    status: row.status,
    reservedUntil: row.reservedUntil.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    sampleWorks: row.sampleWorks.map(toSampleWork),
    progress: progress ?? null,
  };
}

function count(value: number | bigint | null | undefined): number {
  return Number(value ?? 0);
}

export function progressFromFact(fact: SalonVipProgressFact, now: Date): VipRequestProgress {
  return deriveVipRequestProgress({
    status: fact.status,
    now,
    createdAt: fact.createdAt,
    reservedUntil: fact.reservedUntil,
    submittedAt: fact.submittedAt,
    cancelledAt: fact.cancelledAt,
    requestedCount: count(fact.requestedCount),
    recipientCount: count(fact.recipientCount),
    notYetQueuedCount: count(fact.notYetQueuedCount),
    queuedCount: count(fact.queuedCount),
    inPipelineCount: count(fact.inPipelineCount),
    sentCount: count(fact.sentCount),
    manualSentCount: count(fact.manualSentCount),
    failedCount: count(fact.failedCount),
    cancelledMessageCount: count(fact.cancelledCount),
    durablySkippedCount: count(fact.globallyStoppedCount),
    activeStopWithoutDurableSkipCount: count(fact.activeStopWithoutDurableSkipCount),
    latestManualSentAt: fact.latestManualSentAt,
  }, 'SALON');
}

export function progressWithoutRecipients(
  row: {
    status: string;
    createdAt: Date;
    reservedUntil: Date;
    submittedAt?: Date | null;
    requestedCount: number;
  },
  now: Date,
): VipRequestProgress {
  const facts: VipProgressFacts = {
    status: row.status,
    now,
    createdAt: row.createdAt,
    reservedUntil: row.reservedUntil,
    submittedAt: row.submittedAt ?? null,
    cancelledAt: null,
    requestedCount: row.requestedCount,
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
  };
  return deriveVipRequestProgress(facts, 'SALON');
}
