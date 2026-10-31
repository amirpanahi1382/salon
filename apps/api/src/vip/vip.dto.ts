import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  VIP_ALLOWED_REQUEST_COUNTS,
  VIP_QUOTA_MAX,
  VIP_CATALOG_MEMBERSHIPS,
  VIP_GEO_RANGE_MAX_LENGTH,
  VIP_LIST_NAME_MAX_LENGTH,
  VIP_REGION_CODES,
  VIP_REQUEST_STATUSES,
  VIP_TARGET_LIST_STATUSES,
  type VipAllowedRequestCount,
  type VipCatalogMembership,
  type VipRequestStatus,
  type VipTargetListStatus,
} from '@salon/shared';

export class PatchVipListDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(VIP_LIST_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['ACTIVE', 'INACTIVE'])
  availability?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ enum: VIP_REGION_CODES })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsIn([...VIP_REGION_CODES])
  regionCode?: string;
}

export class GrantVipEntitlementDto {
  @ApiProperty()
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  salonId!: string;
}

export class CreateVipRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  listId!: string;

  @ApiProperty({ description: 'Confirmed actual recipient quantity, not the package group.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VIP_QUOTA_MAX)
  requestedCount!: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(VIP_GEO_RANGE_MAX_LENGTH)
  geographicRange!: string;
}

export class ListCursorQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class AdminVipListsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ enum: VIP_CATALOG_MEMBERSHIPS })
  @IsOptional()
  @IsIn([...VIP_CATALOG_MEMBERSHIPS])
  catalogMembership?: VipCatalogMembership;
}

export class AdminVipOutreachSalonsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Optional salon-name contains match' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class ListAdminSalonsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque createdAt DESC, id DESC continuation cursor' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Search all salon names, case-insensitively' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class SalonVipListsQueryDto {
  @ApiPropertyOptional({ enum: VIP_REGION_CODES })
  @IsOptional()
  @IsString()
  @IsIn([...VIP_REGION_CODES])
  regionCode?: string;

  @ApiPropertyOptional({ enum: VIP_ALLOWED_REQUEST_COUNTS, description: 'List-size group. Not the recipient quantity.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([...VIP_ALLOWED_REQUEST_COUNTS])
  packageGroup?: number;
}

export class SalonVipRequestHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class VipTargetListSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  regionCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  regionName!: string | null;

  @ApiProperty({ enum: VIP_TARGET_LIST_STATUSES })
  status!: VipTargetListStatus;

  @ApiProperty({ nullable: true, enum: VIP_CATALOG_MEMBERSHIPS })
  catalogMembership!: VipCatalogMembership | null;

  @ApiProperty()
  contactCount!: number;

  @ApiProperty({ description: 'True when an admin reopening is waiting for the next reservation.' })
  nextReservationOpen!: boolean;

  @ApiProperty({ nullable: true, type: String })
  reservedBySalonId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  reservedBySalonName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({
    description: 'True when a salon has submitted this list for admin review',
    nullable: true,
    type: String,
  })
  attentionRequestId!: string | null;

  @ApiProperty({
    description:
      'True when this list is effectively requestable: canonical region 01–14, ORIGINAL_TEHRAN, and no live draft or submitted/processing request. Stored IN_USE with only an expired draft is included. Status remains the stored value. A true read is not a reservation.',
  })
  requestableBySalons!: boolean;

  @ApiProperty({
    description:
      'COUNT(*) of vip_requests for this list, including CANCELLED and drafts.',
  })
  totalRequestCount!: number;

  @ApiProperty({
    description:
      'vip_requests in AWAITING_SAMPLE_WORK, SUBMITTED, MANUAL_QUEUED, or BALE_NOT_IMPLEMENTED. CANCELLED excluded. Includes an expired draft until expiry cancels it.',
  })
  openRequestCount!: number;

  @ApiProperty({
    description:
      'Live requests for this list: unexpired AWAITING_SAMPLE_WORK plus SUBMITTED, MANUAL_QUEUED, and BALE_NOT_IMPLEMENTED.',
  })
  liveRequestCount!: number;
}

export class VipTargetContactDto {
  @ApiProperty({ nullable: true, type: String })
  displayName!: string | null;

  @ApiProperty()
  phoneNumber!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class VipSampleWorkDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  position!: number;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  byteSize!: number;
}

export class VipRequestDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  salonId!: string;

  @ApiProperty()
  salonName!: string;

  @ApiProperty()
  listId!: string;

  @ApiProperty()
  listName!: string;

  @ApiProperty()
  requestedCount!: number;

  @ApiProperty()
  geographicRange!: string;

  @ApiProperty({ enum: VIP_REQUEST_STATUSES })
  status!: VipRequestStatus;

  @ApiProperty()
  reservedUntil!: string;

  @ApiProperty({ nullable: true, type: String })
  submittedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [VipSampleWorkDto] })
  sampleWorks!: VipSampleWorkDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Server-owned progress. Null only when this response was built without the read model. Counts are recipient buckets, not a new VipRequest status.',
  })
  progress!: Record<string, unknown> | null;
}

export class VipCapabilityDto {
  @ApiProperty()
  entitled!: boolean;

  @ApiProperty()
  remainingQuota!: number;

  @ApiProperty()
  usedQuota!: number;

  @ApiProperty({ description: 'Temporary product rolling-window limit' })
  quotaMax!: number;

  @ApiProperty({ description: 'Rolling window in days. Not a calendar week.' })
  quotaWindowDays!: number;

  @ApiProperty({ description: 'Instant used for the rolling-window calculation' })
  quotaEvaluatedAt!: string;

  @ApiProperty({ description: 'Requests created at or after this instant count toward the window' })
  quotaWindowStartsAt!: string;

  @ApiProperty({ type: [Number], example: [30, 50, 100] })
  allowedRequestCounts!: number[];

  @ApiProperty({ nullable: true, type: () => VipRequestDto })
  activeDraft!: VipRequestDto | null;

  @ApiProperty({
    type: () => [VipRequestDto],
    description: 'At most the 10 most recent submitted or processing requests. Not a complete history.',
  })
  inProgressRequests!: VipRequestDto[];

  @ApiProperty({ description: 'True when older in-progress requests exist beyond this summary.' })
  inProgressRequestsHasMore!: boolean;

  @ApiProperty({
    nullable: true,
    type: () => VipRequestDto,
    description: 'Same as activeDraft. Submitted and processing requests are not returned here.',
  })
  currentRequest!: VipRequestDto | null;

  @ApiProperty({
    nullable: true,
    type: () => VipRequestDto,
    description: 'The single most recently cancelled draft for this salon. Not a history page.',
  })
  latestCancelledRequest!: VipRequestDto | null;
}

export class VipEntitlementDto {
  @ApiProperty()
  salonId!: string;

  @ApiProperty()
  salonName!: string;

  @ApiProperty()
  entitled!: boolean;

  @ApiProperty()
  grantedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  revokedAt!: string | null;
}

export class AdminSalonSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  entitled!: boolean;
}
