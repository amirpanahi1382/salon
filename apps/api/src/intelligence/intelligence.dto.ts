import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  CUSTOMER_STATUSES,
  OPPORTUNITY_TYPES,
  type CustomerStatus,
  type IntelligenceSignal,
  type OpportunityType,
} from '@salon/shared';

export class IntelligenceQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: CustomerStatus;

  @ApiPropertyOptional({ enum: OPPORTUNITY_TYPES })
  @IsOptional()
  @IsIn(OPPORTUNITY_TYPES)
  type?: OpportunityType;
}

export class BehaviorMetricsDto {
  @ApiProperty()
  visitCount!: number;

  @ApiProperty({ nullable: true, type: String })
  firstVisitAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastVisitAt!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  daysSinceLastVisit!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  averageReturnIntervalDays!: number | null;

  @ApiProperty()
  expectedReturnIntervalDays!: number;
}

export class OpportunityDto {
  @ApiProperty({ enum: OPPORTUNITY_TYPES })
  type!: OpportunityType;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: CUSTOMER_STATUSES })
  status!: CustomerStatus;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  recommendedAction!: string;
}

export class CustomerIntelligenceResponseDto {
  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: CUSTOMER_STATUSES })
  status!: CustomerStatus;

  @ApiProperty()
  explanation!: string;

  @ApiProperty({ type: BehaviorMetricsDto })
  behavior!: BehaviorMetricsDto;

  @ApiProperty({ isArray: true, enum: ['NEW_CUSTOMER', 'OVERDUE', 'FREQUENT'] })
  signals!: IntelligenceSignal[];

  @ApiProperty({ type: [OpportunityDto] })
  opportunities!: OpportunityDto[];
}

export class IntelligenceSummaryResponseDto {
  @ApiProperty()
  customers!: number;

  @ApiProperty()
  new!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  returning!: number;

  @ApiProperty()
  atRisk!: number;

  @ApiProperty()
  inactive!: number;

  @ApiProperty()
  reactivationOpportunities!: number;

  @ApiProperty()
  customerReturnOpportunities!: number;

  @ApiProperty()
  frequent!: number;

  @ApiProperty({
    description: 'True when the salon has more customers than the intelligence scan cap',
  })
  hasMore!: boolean;
}

export class CustomerSegmentItemDto {
  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: CUSTOMER_STATUSES })
  status!: CustomerStatus;

  @ApiProperty()
  explanation!: string;

  @ApiProperty({ nullable: true, type: Number })
  daysSinceLastVisit!: number | null;

  @ApiProperty()
  visitCount!: number;
}

export class OpportunityListPageDto {
  @ApiProperty({ type: [OpportunityDto] })
  items!: OpportunityDto[];

  @ApiProperty()
  hasMore!: boolean;
}

export class CustomerSegmentListPageDto {
  @ApiProperty({ type: [CustomerSegmentItemDto] })
  items!: CustomerSegmentItemDto[];

  @ApiProperty()
  hasMore!: boolean;
}
