import type { VipRequestDto, VipSampleWorkDto, VipTargetListSummaryDto } from './vip.dto';

export function toListSummary(row: {
  id: string;
  name: string;
  status: VipTargetListSummaryDto['status'];
  catalogMembership: VipTargetListSummaryDto['catalogMembership'];
  contactCount: number;
  reservedBySalonId: string | null;
  reservedBySalon: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  requests: Array<{ id: string }>;
}): VipTargetListSummaryDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    catalogMembership: row.catalogMembership,
    contactCount: row.contactCount,
    reservedBySalonId: row.reservedBySalonId,
    reservedBySalonName: row.reservedBySalon?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attentionRequestId: row.requests[0]?.id ?? null,
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
}): VipRequestDto {
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
  };
}
