import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateTransactionItemDto {
  @ApiProperty()
  @IsUUID('all')
  serviceId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number;

  @ApiProperty({ example: '150000.00', description: 'Unit price as a decimal string in IRR' })
  @IsString()
  @Matches(/^(0|[1-9]\d*)(\.\d{1,2})?$/)
  unitPrice!: string;
}

export class CreateTransactionDto {
  @ApiProperty()
  @IsUUID('all')
  customerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  visitId?: string;

  @ApiProperty({ description: 'When the money was recorded (UTC ISO-8601)' })
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({ example: '1500000.00' })
  @IsString()
  @Matches(/^(0|[1-9]\d*)(\.\d{1,2})?$/)
  amount!: string;

  @ApiPropertyOptional({ example: 'IRR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ type: [CreateTransactionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionItemDto)
  items!: CreateTransactionItemDto[];
}

export class TransactionItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  serviceId!: string;

  @ApiProperty()
  serviceName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: string;

  @ApiProperty()
  totalAmount!: string;
}

export class TransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty({ nullable: true, type: String })
  visitId!: string | null;

  @ApiProperty()
  occurredAt!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: ['COMPLETED', 'VOIDED'] })
  status!: 'COMPLETED' | 'VOIDED';

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [TransactionItemResponseDto] })
  items!: TransactionItemResponseDto[];
}

export class ListTransactionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  @ApiPropertyOptional({ enum: ['COMPLETED', 'VOIDED'] })
  @IsOptional()
  @IsIn(['COMPLETED', 'VOIDED'])
  status?: 'COMPLETED' | 'VOIDED';

  @ApiPropertyOptional({ description: 'UTC calendar date YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 200, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class TransactionListPageDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  items!: TransactionResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
