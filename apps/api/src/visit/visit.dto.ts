import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateVisitDto {
  @ApiProperty()
  @IsUUID('all')
  customerId!: string;

  @ApiProperty({
    description: 'When the completed visit happened (UTC ISO-8601). Must not be a future booking time.',
  })
  @IsISO8601()
  visitedAt!: string;
}

export class VisitResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  visitedAt!: string;

  @ApiProperty()
  createdAt!: string;
}

export class ListVisitsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  @ApiPropertyOptional({ description: 'Calendar date YYYY-MM-DD interpreted as that UTC day' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ description: 'Inclusive start of a visitedAt window (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive end of a visitedAt window (ISO-8601)' })
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

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class VisitListItemDto extends VisitResponseDto {
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

export class VisitListPageDto {
  @ApiProperty({ type: [VisitListItemDto] })
  items!: VisitListItemDto[];

  @ApiProperty({ description: 'True when more visits exist beyond this page (max 200)' })
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class CustomerVisitListPageDto {
  @ApiProperty({ type: [VisitResponseDto] })
  items!: VisitResponseDto[];

  @ApiProperty({ description: 'True when more visits exist beyond this page (max 200)' })
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class ListCustomerVisitsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
