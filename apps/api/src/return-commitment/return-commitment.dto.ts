import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AssociatedRevenueDto } from '../observed-outcome/observed-outcome.dto';

export class CreateReturnCommitmentDto {
  @ApiProperty({ description: 'Agreed future return instant (UTC ISO-8601). Not a booking slot.' })
  @IsISO8601()
  expectedAt!: string;
}

export class UpdateReturnCommitmentDto {
  @ApiProperty({ description: 'Agreed future return instant (UTC ISO-8601). Not a booking slot.' })
  @IsISO8601()
  expectedAt!: string;

  @ApiProperty({
    description: 'Optimistic concurrency token. Must equal the current updatedAt from the last read.',
  })
  @IsISO8601()
  updatedAt!: string;
}

export class ListReturnCommitmentsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class ListUpcomingReturnCommitmentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Inclusive start of the query window (UTC ISO-8601). Query bound only; not a booking horizon.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Exclusive end of the query window (UTC ISO-8601). Query bound only; defaults to 14 days after from; max 31 days.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class ReturnCommitmentMessageProvenanceDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  deliveryId!: string;
}

export class ReturnCommitmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ type: ReturnCommitmentMessageProvenanceDto })
  sourceMessage!: ReturnCommitmentMessageProvenanceDto;

  @ApiProperty({ description: 'Agreed future return instant. Not a reserved slot.' })
  expectedAt!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Explicit actual Visit id after arrival or link. Null does not mean the operational queue is open. Never a future Visit id.',
  })
  actualVisitId!: string | null;

  @ApiProperty({
    description:
      'Derived follow-up state: actualVisitId is null AND no same-tenant Visit with visitedAt > source MessageDelivery.submittedAt. Not COMMITMENT_BACKED.',
  })
  operationallyOpen!: boolean;

  @ApiProperty({
    nullable: true,
    type: () => CommitmentBackedReturnDto,
    description:
      'Derived COMMITMENT_BACKED evidence when actualVisitId is set. Not causal/incremental revenue. Unlinked later Visits do not populate this.',
  })
  commitmentBackedReturn!: CommitmentBackedReturnDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Salon user who recorded the agreement. Null when recorded by platform support.',
  })
  createdByUserId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Salon user who last updated the agreement. Null when last updated by platform support.',
  })
  updatedByUserId!: string | null;

  @ApiProperty({
    description: 'True when a platform operator recorded the original agreement. Does not expose admin identity.',
  })
  recordedBySupport!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ description: 'Concurrency token for PATCH' })
  updatedAt!: string;
}

export class ReturnCommitmentListPageDto {
  @ApiProperty({ type: [ReturnCommitmentResponseDto] })
  items!: ReturnCommitmentResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class UpcomingReturnCommitmentItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty({ description: 'Agreed future return instant. Informational; not occupancy.' })
  expectedAt!: string;
}

export class ListOpenReturnCommitmentsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class OpenReturnCommitmentItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty({ description: 'Canonical Customer.phoneNumber. Not copied onto the commitment.' })
  customerPhone!: string;

  @ApiProperty({ description: 'Agreed expected return instant. Not a reserved slot.' })
  expectedAt!: string;

  @ApiProperty({
    description:
      'True when expectedAt is earlier than now. Overdue is not a no-show and does not close the commitment.',
  })
  overdue!: boolean;

  @ApiProperty({
    description: 'True when a platform operator recorded the original agreement. No admin identity.',
  })
  recordedBySupport!: boolean;
}

export class OpenReturnCommitmentListPageDto {
  @ApiProperty({ type: [OpenReturnCommitmentItemDto] })
  items!: OpenReturnCommitmentItemDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class UpcomingReturnCommitmentListPageDto {
  @ApiProperty({ type: [UpcomingReturnCommitmentItemDto] })
  items!: UpcomingReturnCommitmentItemDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Inclusive query window start actually used. Not availability.' })
  from!: string;

  @ApiProperty({ description: 'Exclusive query window end actually used. Not availability.' })
  to!: string;
}

export class ReturnCommitmentSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  expectedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  actualVisitId!: string | null;

  @ApiProperty()
  recordedBySupport!: boolean;

  @ApiProperty({ description: 'Concurrency token for PATCH' })
  updatedAt!: string;
}

export class ArriveReturnCommitmentSaleDto {
  @ApiProperty()
  @IsUUID('all')
  serviceId!: string;

  @ApiProperty({ example: '8000000.00', description: 'Amount received as a decimal string in IRR. Must be greater than 0.' })
  @IsString()
  @Matches(/^(0|[1-9]\d*)(\.\d{1,2})?$/)
  amount!: string;

  @ApiPropertyOptional({ example: 'IRR' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class ArriveReturnCommitmentDto {
  @ApiProperty({
    description: 'Actual completed visit time (UTC ISO-8601). Not ReturnCommitment.expectedAt.',
  })
  @IsISO8601()
  visitedAt!: string;

  @ApiPropertyOptional({
    type: ArriveReturnCommitmentSaleDto,
    description: 'Optional sale recorded atomically with the Visit. OWNER/MANAGER only. Same contract as complete-with-sale.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ArriveReturnCommitmentSaleDto)
  sale?: ArriveReturnCommitmentSaleDto;
}

export class LinkReturnCommitmentVisitDto {
  @ApiProperty({ description: 'Existing completed Visit to link. Same tenant and customer required.' })
  @IsUUID('all')
  visitId!: string;
}

export class CommitmentBackedActualVisitDto {
  @ApiProperty()
  visitId!: string;

  @ApiProperty({ description: 'Authoritative actual Visit.visitedAt' })
  visitedAt!: string;
}

export class CommitmentBackedReturnDto {
  @ApiProperty({ enum: ['COMMITMENT_BACKED'] })
  associationKind!: 'COMMITMENT_BACKED';

  @ApiProperty()
  associationRule!: string;

  @ApiProperty({ type: CommitmentBackedActualVisitDto })
  actualVisit!: CommitmentBackedActualVisitDto;

  @ApiProperty({ type: AssociatedRevenueDto })
  associatedRevenue!: AssociatedRevenueDto;
}
