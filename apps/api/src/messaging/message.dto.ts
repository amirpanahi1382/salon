import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_CHANNELS,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_FAILURE_CODES,
  MESSAGE_PROVIDERS,
  OPPORTUNITY_TYPES,
  type MessageChannel,
  type MessageDeliveryStatus,
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

export class MessageDeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  actionId!: string;

  @ApiProperty()
  opportunityType!: OpportunityType;

  @ApiProperty({ enum: MESSAGE_PROVIDERS })
  provider!: MessageProvider;

  @ApiProperty({ enum: MESSAGE_CHANNELS })
  channel!: MessageChannel;

  @ApiProperty({ enum: MESSAGE_DELIVERY_STATUSES })
  status!: MessageDeliveryStatus;

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

export class MessageDeliveryListPageDto {
  @ApiProperty({ type: [MessageDeliveryResponseDto] })
  items!: MessageDeliveryResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
