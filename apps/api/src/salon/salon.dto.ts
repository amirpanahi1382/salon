import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateSalonProfileDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/, { message: 'name must not be empty' })
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(255)
  address?: string | null;
}

export class SalonProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  status!: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class SalonOverallPerformanceResponseDto {
  @ApiProperty({ description: 'All-time COUNT of Customer rows for this salon' })
  customerCount!: number;

  @ApiProperty({
    description:
      'All-time COUNT of SENT customer-bound non-VIP MessageDelivery rows with submittedAt',
  })
  salonCustomerSentMessageCount!: number;

  @ApiProperty({
    description: 'All-time COUNT of SENT MessageDelivery rows with vip_request_id provenance',
  })
  vipSentMessageCount!: number;

  @ApiProperty({
    description: 'All-time COUNT of ReturnCommitment rows for this salon, including fulfilled',
  })
  agreedReturnCount!: number;

  @ApiProperty({
    description:
      'All-time COUNT DISTINCT customers with COMMITMENT_BACKED and/or OBSERVED visit evidence',
  })
  messageAssociatedReturnedCustomerCount!: number;

  @ApiProperty({
    description: 'All-time COUNT DISTINCT customers with at least two Visit rows',
  })
  returningSalonCustomerCount!: number;
}
