import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsAbsoluteInstant, IsUtcDate } from '../infrastructure/http/date-input';
import { ArriveReturnCommitmentSaleDto } from '../return-commitment/return-commitment.dto';

export class VisitIntentionTimeDto {
  @ApiProperty({ enum: ['UNKNOWN', 'DATE', 'INSTANT'] })
  @IsIn(['UNKNOWN', 'DATE', 'INSTANT'])
  precision!: 'UNKNOWN' | 'DATE' | 'INSTANT';

  @ApiPropertyOptional({ description: 'Calendar date YYYY-MM-DD. Not a clock time and not midnight.' })
  @IsOptional()
  @IsUtcDate()
  agreedDate?: string;

  @ApiPropertyOptional({ description: 'Agreed instant with an explicit timezone. Not a booking slot.' })
  @IsOptional()
  @IsAbsoluteInstant()
  agreedInstant?: string;
}

export class CreateCustomerVisitIntentionDto {
  @ApiProperty({ type: VisitIntentionTimeDto })
  @ValidateNested()
  @Type(() => VisitIntentionTimeDto)
  time!: VisitIntentionTimeDto;

  @ApiPropertyOptional({
    description:
      'Optional same-salon customer message used only as report provenance. Not required to be SENT and not a ReturnCommitment.',
  })
  @IsOptional()
  @IsUUID()
  sourceMessageRequestId?: string;
}

export class CreateSalonVipVisitIntentionDto {
  @ApiProperty({ type: VisitIntentionTimeDto })
  @ValidateNested()
  @Type(() => VisitIntentionTimeDto)
  time!: VisitIntentionTimeDto;

  @ApiPropertyOptional({
    description: 'Name the prospect supplied directly to the salon. Not a target-list name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  disclosedDisplayName?: string;

  @ApiPropertyOptional({
    description: 'Phone the prospect supplied directly to the salon. Not a target-list phone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  disclosedPhone?: string;
}

export class CreateAdminVipVisitIntentionDto {
  @ApiProperty({ type: VisitIntentionTimeDto })
  @ValidateNested()
  @Type(() => VisitIntentionTimeDto)
  time!: VisitIntentionTimeDto;
}

export class UpdateVisitIntentionDto {
  @ApiProperty({ type: VisitIntentionTimeDto })
  @ValidateNested()
  @Type(() => VisitIntentionTimeDto)
  time!: VisitIntentionTimeDto;

  @ApiProperty()
  @IsAbsoluteInstant()
  updatedAt!: string;
}

export class ArriveVisitIntentionDto {
  @ApiProperty()
  @IsAbsoluteInstant()
  visitedAt!: string;

  @ApiPropertyOptional({
    description:
      'Required for a VIP intention. The salon must choose an existing customer. Ignored phone matching is not accepted.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ type: ArriveReturnCommitmentSaleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ArriveReturnCommitmentSaleDto)
  sale?: ArriveReturnCommitmentSaleDto;
}

export class LinkVisitIntentionDto {
  @ApiProperty()
  @IsUUID()
  visitId!: string;
}

export class ListVisitIntentionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
