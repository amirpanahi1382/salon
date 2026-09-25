import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  OPPORTUNITY_WORKSPACE_FILTERS,
  OPPORTUNITY_WORKSPACE_MESSAGE_STATES,
  OPPORTUNITY_WORKSPACE_ROW_KINDS,
  type OpportunityWorkspaceFilter,
  type OpportunityWorkspaceMessageState,
  type OpportunityWorkspaceRowKind,
  type ReturnEvidenceKind,
} from '@salon/shared';

export class OpportunitiesWorkspaceQueryDto {
  @ApiProperty({ enum: OPPORTUNITY_WORKSPACE_FILTERS })
  @IsIn(OPPORTUNITY_WORKSPACE_FILTERS)
  filter!: OpportunityWorkspaceFilter;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class OpportunityWorkspaceRowDto {
  @ApiProperty({ enum: OPPORTUNITY_WORKSPACE_ROW_KINDS })
  rowKind!: OpportunityWorkspaceRowKind;

  @ApiProperty({ description: 'Stable pagination identity. SALON_CUSTOMER:<id> or VIP_RECIPIENT:<messageRequestId>' })
  stableId!: string;

  @ApiProperty({ nullable: true, type: String })
  customerId!: string | null;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true, type: String })
  phoneNumber!: string | null;

  @ApiPropertyOptional({ enum: OPPORTUNITY_WORKSPACE_MESSAGE_STATES, nullable: true })
  messageState?: OpportunityWorkspaceMessageState | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  messageRequestId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  requestedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  submittedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  commitmentExpectedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: ['COMMITMENT_BACKED', 'OBSERVED'], type: String })
  returnEvidenceKind?: ReturnEvidenceKind | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  previousVisitAt?: string | null;
}

export class OpportunityWorkspacePageDto {
  @ApiProperty({ type: [OpportunityWorkspaceRowDto] })
  items!: OpportunityWorkspaceRowDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
