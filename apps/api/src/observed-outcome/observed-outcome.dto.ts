import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  INTERVENTION_KIND_MESSAGE,
  INTERVENTION_ORIGINS,
  OBSERVED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_RULE,
  type InterventionOrigin,
} from '@salon/shared';

export class ListObservedReturnsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class ObservedMessageProvenanceDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  deliveryId!: string;

  @ApiProperty({ description: 'Queue/intent time. Not interventionAt.' })
  requestedAt!: string;
}

export class ObservedInterventionDto {
  @ApiProperty({ enum: [INTERVENTION_KIND_MESSAGE] })
  kind!: typeof INTERVENTION_KIND_MESSAGE;

  @ApiProperty({ enum: INTERVENTION_ORIGINS })
  origin!: InterventionOrigin;

  @ApiProperty({ description: 'Authoritative intervention instant (MessageDelivery.submittedAt)' })
  occurredAt!: string;

  @ApiProperty({ type: ObservedMessageProvenanceDto })
  message!: ObservedMessageProvenanceDto;

  @ApiProperty({ nullable: true, type: String })
  actionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  opportunityType!: string | null;
}

export class ObservedReturnVisitDto {
  @ApiProperty()
  visitId!: string;

  @ApiProperty({ description: 'Authoritative return instant (Visit.visitedAt)' })
  occurredAt!: string;
}

export class AssociatedRevenueDto {
  @ApiProperty({
    description:
      'True when at least one COMPLETED ledger transaction is linked to the return visit. False means no recorded revenue, not an amount of 0.00.',
  })
  recorded!: boolean;

  @ApiProperty({ enum: ['IRR'] })
  currency!: 'IRR';

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Decimal string when recorded is true. Null when recorded is false.',
    example: '3200000.00',
  })
  amount!: string | null;
}

export class ObservedReturnResponseDto {
  @ApiProperty({ enum: [OBSERVED_ASSOCIATION_KIND] })
  associationKind!: typeof OBSERVED_ASSOCIATION_KIND;

  @ApiProperty({ enum: [OBSERVED_ASSOCIATION_RULE] })
  associationRule!: typeof OBSERVED_ASSOCIATION_RULE;

  @ApiProperty({ type: ObservedInterventionDto })
  intervention!: ObservedInterventionDto;

  @ApiProperty({ type: ObservedReturnVisitDto })
  observedReturn!: ObservedReturnVisitDto;

  @ApiProperty({ type: AssociatedRevenueDto })
  associatedRevenue!: AssociatedRevenueDto;
}

export class ObservedReturnListPageDto {
  @ApiProperty({ type: [ObservedReturnResponseDto] })
  items!: ObservedReturnResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
