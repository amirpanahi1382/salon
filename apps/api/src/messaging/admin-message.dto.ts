import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  MESSAGE_DELIVERY_MODES,
  MESSAGE_FAILURE_CODES,
  MESSAGE_REQUEST_STATUSES,
  OPPORTUNITY_TYPES,
  type MessageDeliveryMode,
  type MessageFailureCode,
  type MessageRequestStatus,
  type OpportunityType,
} from '@salon/shared';

export class AdminMessageQueueQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ enum: MESSAGE_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(MESSAGE_REQUEST_STATUSES)
  status?: MessageRequestStatus;

  @ApiPropertyOptional({ enum: MESSAGE_DELIVERY_MODES })
  @IsOptional()
  @IsIn(MESSAGE_DELIVERY_MODES)
  mode?: MessageDeliveryMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  salonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  customerId?: string;
}

export class AdminMessageQueueItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  salonId!: string;

  @ApiProperty()
  salonName!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty({ description: 'Full customer phone for manual fulfillment' })
  customerPhone!: string;

  @ApiProperty()
  messageText!: string;

  @ApiProperty({ enum: OPPORTUNITY_TYPES })
  opportunityType!: OpportunityType;

  @ApiProperty()
  requestedAt!: string;

  @ApiProperty({ description: 'Asia/Tehran calendar date of the request' })
  messageBusinessDate!: string;

  @ApiProperty({ enum: MESSAGE_REQUEST_STATUSES })
  status!: MessageRequestStatus;

  @ApiProperty({ nullable: true, enum: MESSAGE_DELIVERY_MODES, type: String })
  mode!: MessageDeliveryMode | null;

  @ApiProperty({ nullable: true, type: String })
  deliveryStatus!: string | null;

  @ApiProperty({ nullable: true, enum: MESSAGE_FAILURE_CODES, type: String })
  failureCode!: MessageFailureCode | null;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ nullable: true, type: String })
  submittedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failedAt!: string | null;

  @ApiProperty({ description: 'False when Bale credentials are not configured on the platform' })
  providerReady!: boolean;
}

export class AdminMessageQueuePageDto {
  @ApiProperty({ type: [AdminMessageQueueItemDto] })
  items!: AdminMessageQueueItemDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
