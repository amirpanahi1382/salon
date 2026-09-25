import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
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

export class CustomerRevenueDto {
  @ApiProperty({ example: 'IRR' })
  currency!: 'IRR';

  @ApiProperty({ example: '1500000.00' })
  totalRevenue!: string;

  @ApiProperty()
  transactionCount!: number;

  @ApiProperty({ nullable: true, type: String })
  averageRevenuePerTransaction!: string | null;

  @ApiProperty({ nullable: true, type: String })
  averageSpendPerVisit!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastRevenueAt!: string | null;

  @ApiProperty()
  revenueThisUtcMonth!: string;

  @ApiProperty()
  revenuePreviousUtcMonth!: string;

  @ApiProperty({ nullable: true, enum: ['INCREASING', 'DECREASING', 'STABLE'] })
  revenueTrend!: 'INCREASING' | 'DECREASING' | 'STABLE' | null;

  @ApiProperty({ description: 'Reporting periods use UTC calendar boundaries, not salon-local time' })
  reportingTime!: 'UTC';
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

  @ApiProperty({ isArray: true, enum: ['NEW_CUSTOMER', 'OVERDUE', 'FREQUENT', 'REVENUE_DECLINING'] })
  signals!: IntelligenceSignal[];

  @ApiProperty({ type: [OpportunityDto] })
  opportunities!: OpportunityDto[];

  @ApiProperty({ type: CustomerRevenueDto })
  revenue!: CustomerRevenueDto;
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

  @ApiProperty({ description: 'Compatibility field; complete salon-wide summary always returns false' })
  hasMore!: boolean;

  @ApiProperty({ example: 'IRR' })
  currency!: 'IRR';

  @ApiProperty()
  totalRevenue!: string;

  @ApiProperty()
  completedTransactionCount!: number;

  @ApiProperty()
  revenueThisUtcMonth!: string;

  @ApiProperty()
  revenuePreviousUtcMonth!: string;

  @ApiProperty({ nullable: true, enum: ['INCREASING', 'DECREASING', 'STABLE'] })
  revenueTrend!: 'INCREASING' | 'DECREASING' | 'STABLE' | null;

  @ApiProperty()
  revenueDeclineOpportunities!: number;

  @ApiProperty()
  reportingTime!: 'UTC';
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

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class CustomerSegmentListPageDto {
  @ApiProperty({ type: [CustomerSegmentItemDto] })
  items!: CustomerSegmentItemDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
