import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_CHANNELS,
  MESSAGE_DELIVERY_MODES,
  MESSAGE_FAILURE_CODES,
  MESSAGE_PROVIDERS,
  OPPORTUNITY_TYPES,
  type MessageChannel,
  type MessageDeliveryMode,
  type MessageFailureCode,
  type MessageProvider,
  type OpportunityType,
} from '@salon/shared';

export class SendOpportunityMessageDto {
  @ApiProperty({ maxLength: MESSAGE_BODY_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_BODY_MAX_LENGTH)
  text!: string;
}

export class ListCustomerMessagesQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class MessageRequestResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ nullable: true, type: String })
  actionId!: string | null;

  @ApiProperty({ nullable: true, enum: OPPORTUNITY_TYPES, type: String })
  opportunityType!: OpportunityType | null;

  @ApiProperty({ enum: MESSAGE_CHANNELS })
  channel!: MessageChannel;

  @ApiProperty({ enum: ['QUEUED', 'SENT', 'FAILED'] })
  status!: 'QUEUED' | 'SENT' | 'FAILED';

  @ApiProperty({ nullable: true, enum: MESSAGE_DELIVERY_MODES, type: String })
  mode!: MessageDeliveryMode | null;

  @ApiProperty({ nullable: true, enum: MESSAGE_PROVIDERS, type: String })
  provider!: MessageProvider | null;

  @ApiProperty()
  body!: string;

  @ApiProperty({ description: 'Masked destination phone; never a provider chat id' })
  destinationHint!: string;

  @ApiProperty({ nullable: true, enum: MESSAGE_FAILURE_CODES, type: String })
  failureCode!: MessageFailureCode | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  submittedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failedAt!: string | null;
}

export class MessageRequestListPageDto {
  @ApiProperty({ type: [MessageRequestResponseDto] })
  items!: MessageRequestResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
