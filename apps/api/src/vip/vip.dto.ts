import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  VIP_ALLOWED_REQUEST_COUNTS,
  VIP_GEO_RANGE_MAX_LENGTH,
  VIP_LIST_NAME_MAX_LENGTH,
  VIP_REQUEST_STATUSES,
  VIP_TARGET_LIST_STATUSES,
  type VipAllowedRequestCount,
  type VipRequestStatus,
  type VipTargetListStatus,
} from '@salon/shared';

export class PatchVipListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(VIP_LIST_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  availability?: 'ACTIVE' | 'INACTIVE';
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

  @ApiProperty({ enum: VIP_ALLOWED_REQUEST_COUNTS })
  @Type(() => Number)
  @IsIn([...VIP_ALLOWED_REQUEST_COUNTS])
  requestedCount!: VipAllowedRequestCount;

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

export class VipTargetListSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: VIP_TARGET_LIST_STATUSES })
  status!: VipTargetListStatus;

  @ApiProperty()
  contactCount!: number;

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
}

export class VipTargetContactDto {
  @ApiProperty()
  displayName!: string;

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
}

export class VipCapabilityDto {
  @ApiProperty()
  entitled!: boolean;

  @ApiProperty()
  remainingQuota!: number;

  @ApiProperty()
  usedQuota!: number;

  @ApiProperty({ nullable: true, type: () => VipRequestDto })
  currentRequest!: VipRequestDto | null;
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
