import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { OPPORTUNITY_TYPES, type OpportunityType } from '@salon/shared';

export const ACTION_STATUSES = ['OPEN', 'COMPLETED', 'DISMISSED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export class ListActionsQueryDto {
  @ApiPropertyOptional({ enum: ACTION_STATUSES })
  @IsOptional()
  @IsIn(ACTION_STATUSES)
  status?: ActionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class ListCustomerActionsQueryDto {
  @ApiPropertyOptional({ enum: ACTION_STATUSES })
  @IsOptional()
  @IsIn(ACTION_STATUSES)
  status?: ActionStatus;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class OpportunityActionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: OPPORTUNITY_TYPES })
  opportunityType!: OpportunityType;

  @ApiProperty({ enum: ACTION_STATUSES })
  status!: ActionStatus;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  completedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  dismissedAt!: string | null;
}

export class OpportunityActionListPageDto {
  @ApiProperty({ type: [OpportunityActionResponseDto] })
  items!: OpportunityActionResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
