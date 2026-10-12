import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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

  @ApiPropertyOptional({
    description:
      'Name the prospect authorized the salon to see. Omit every contact field to record the legacy time-only withheld intention.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  disclosedDisplayName?: string;

  @ApiPropertyOptional({
    description: 'Phone the prospect authorized the salon to see. Not copied from the target list.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  disclosedPhone?: string;

  @ApiPropertyOptional({
    description:
      'Required and true when name or phone is sent. A time-only legacy body omits this field.',
  })
  @IsOptional()
  @IsBoolean()
  prospectAuthorizedSharingWithSalon?: boolean;
}

export class UpdateVisitIntentionDto {
  @ApiProperty({ type: VisitIntentionTimeDto })
  @ValidateNested()
  @Type(() => VisitIntentionTimeDto)
  time!: VisitIntentionTimeDto;

  @ApiProperty()
  @IsAbsoluteInstant()
  updatedAt!: string;

  @ApiPropertyOptional({
    description: 'Set true only to record a new contact revision. A time-only correction leaves contact details unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  correctDisclosedContact?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  disclosedDisplayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(11)
  disclosedPhone?: string;

  @ApiPropertyOptional({
    description:
      'Required again when correcting Admin-authorized contact. A time-only correction does not use this field.',
  })
  @IsOptional()
  @IsBoolean()
  prospectAuthorizedSharingWithSalon?: boolean;
}

export class ArriveNewCustomerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({ description: 'Exactly 11 digits starting with 09.' })
  @IsString()
  @MaxLength(32)
  phoneNumber!: string;
}

export class ArriveVisitIntentionDto {
  @ApiProperty()
  @IsAbsoluteInstant()
  visitedAt!: string;

  @ApiPropertyOptional({
    description:
      'Existing salon customer chosen explicitly. Not inferred from a VIP target-list phone.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    type: ArriveNewCustomerDto,
    description:
      'Creates the customer in the same transaction as the Visit and VIP link. Rejected when customerId is also set.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ArriveNewCustomerDto)
  newCustomer?: ArriveNewCustomerDto;

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
