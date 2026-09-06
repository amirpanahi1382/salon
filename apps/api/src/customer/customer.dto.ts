import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({
    example: '09121111111',
    description: 'Exactly 11 digits starting with 09. Alternative formats are rejected.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phoneNumber!: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({
    example: '09121111111',
    description: 'Exactly 11 digits starting with 09. Alternative formats are rejected.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phoneNumber?: string;
}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ description: 'Search first name, last name, or phone' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class CustomerImportRowResultDto {
  @ApiProperty()
  row!: number;

  @ApiProperty({ enum: ['IMPORTED', 'ALREADY_EXISTS', 'DUPLICATE_IN_FILE', 'INVALID'] })
  status!: 'IMPORTED' | 'ALREADY_EXISTS' | 'DUPLICATE_IN_FILE' | 'INVALID';

  @ApiPropertyOptional({ type: [String] })
  errors?: string[];
}

export class CustomerImportResultDto {
  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  imported!: number;

  @ApiProperty()
  skipped!: number;

  @ApiProperty()
  failed!: number;

  @ApiProperty({ type: [CustomerImportRowResultDto] })
  results!: CustomerImportRowResultDto[];
}

export class CustomerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  phoneNumber!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CustomerListPageDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  items!: CustomerResponseDto[];

  @ApiProperty({ description: 'True when more customers exist beyond this page (max 200)' })
  hasMore!: boolean;
}
