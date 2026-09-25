import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const SERVICE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ServiceStatusDto = (typeof SERVICE_STATUSES)[number];

export class CreateServiceDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be empty' })
  name!: string;
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be empty' })
  name?: string;

  @ApiPropertyOptional({ enum: SERVICE_STATUSES })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(SERVICE_STATUSES)
  status?: ServiceStatusDto;
}

export class ListServicesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'OWNER-only. When true, include INACTIVE services for catalog management. Default lists ACTIVE services for visit selection.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: string;
}

export class ServiceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: SERVICE_STATUSES })
  status!: ServiceStatusDto;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class ServiceListPageDto {
  @ApiProperty({ type: [ServiceResponseDto] })
  items!: ServiceResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
