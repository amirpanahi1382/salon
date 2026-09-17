import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  COMMITMENT_BACKED_ASSOCIATION_RULE,
  INTERVENTION_KIND_MESSAGE,
  INTERVENTION_ORIGINS,
  OBSERVED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_RULE,
  OWNER_REPORTING_TIMEZONE,
  type InterventionOrigin,
} from '@salon/shared';
import { AssociatedRevenueDto } from '../observed-outcome/observed-outcome.dto';

export const RECOVERY_OUTCOME_EVIDENCE_KINDS = [
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_KIND,
] as const;

export class RecoveryOutcomesQueryDto {
  @ApiPropertyOptional({
    description:
      'Inclusive Saturday 00:00 Asia/Tehran as a UTC ISO-8601 instant. Omit for the current Tehran business week.',
  })
  @IsOptional()
  @IsISO8601()
  weekStart?: string;
}

export class ListRecoveryOutcomeReturnsQueryDto extends RecoveryOutcomesQueryDto {
  @ApiProperty({ enum: RECOVERY_OUTCOME_EVIDENCE_KINDS })
  @IsIn(RECOVERY_OUTCOME_EVIDENCE_KINDS)
  kind!: (typeof RECOVERY_OUTCOME_EVIDENCE_KINDS)[number];

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class RecoveryOutcomesPeriodDto {
  @ApiProperty({ enum: [OWNER_REPORTING_TIMEZONE] })
  timezone!: typeof OWNER_REPORTING_TIMEZONE;

  @ApiProperty({ description: 'Inclusive period start (UTC instant of Saturday 00:00 Asia/Tehran)' })
  start!: string;

  @ApiProperty({ description: 'Exclusive period end (next Saturday 00:00 Asia/Tehran)' })
  end!: string;

  @ApiProperty()
  previousWeekStart!: string;

  @ApiProperty()
  nextWeekStart!: string;

  @ApiProperty({ description: 'True when this period is the week containing now in Asia/Tehran' })
  current!: boolean;
}

export class MessagingExecutionCompanionDto {
  @ApiProperty({
    description:
      'Median request→SENT latency in milliseconds for eligible SENT deliveries in the period. Not a recovery KPI. Null when none.',
    nullable: true,
    type: Number,
  })
  medianRequestToSentLatencyMs!: number | null;
}

export class RecoveryOutcomesSummaryDto {
  @ApiProperty({ type: RecoveryOutcomesPeriodDto })
  period!: RecoveryOutcomesPeriodDto;

  @ApiProperty({ description: 'Eligible SENT customer MessageDelivery count (submittedAt in period)' })
  sentFollowUps!: number;

  @ApiProperty({ description: 'ReturnCommitment rows with createdAt in period' })
  returnCommitmentsRecorded!: number;

  @ApiProperty({
    description:
      'Distinct eligible COMMITMENT_BACKED Visits (visitedAt in period and visitedAt > source submittedAt)',
  })
  commitmentBackedReturns!: number;

  @ApiProperty({
    type: AssociatedRevenueDto,
    description:
      'Sum of COMPLETED visit-linked transactions on eligible commitment-backed Visits only. Not OBSERVED. Not causal.',
  })
  commitmentBackedRecordedRevenue!: AssociatedRevenueDto;

  @ApiProperty({
    description:
      'OBSERVED-only Visits in period after visitId dedup (COMMITMENT_BACKED wins, including chronology-ineligible links)',
  })
  observedReturns!: number;

  @ApiProperty({ type: MessagingExecutionCompanionDto })
  messagingExecution!: MessagingExecutionCompanionDto;
}

export class RecoveryOutcomeCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class RecoveryOutcomeReturnItemDto {
  @ApiProperty({ enum: RECOVERY_OUTCOME_EVIDENCE_KINDS })
  associationKind!: (typeof RECOVERY_OUTCOME_EVIDENCE_KINDS)[number];

  @ApiProperty()
  associationRule!: typeof COMMITMENT_BACKED_ASSOCIATION_RULE | typeof OBSERVED_ASSOCIATION_RULE;

  @ApiProperty({ type: RecoveryOutcomeCustomerDto })
  customer!: RecoveryOutcomeCustomerDto;

  @ApiProperty()
  visitId!: string;

  @ApiProperty({ description: 'Visit.visitedAt' })
  visitedAt!: string;

  @ApiProperty({ nullable: true, type: String, description: 'ReturnCommitment.expectedAt when COMMITMENT_BACKED' })
  expectedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  commitmentId!: string | null;

  @ApiProperty({ enum: [INTERVENTION_KIND_MESSAGE] })
  interventionKind!: typeof INTERVENTION_KIND_MESSAGE;

  @ApiProperty({ enum: INTERVENTION_ORIGINS, nullable: true })
  interventionOrigin!: InterventionOrigin | null;

  @ApiProperty({ description: 'Source MessageDelivery.submittedAt' })
  submittedAt!: string;

  @ApiProperty({ type: AssociatedRevenueDto })
  associatedRevenue!: AssociatedRevenueDto;
}
