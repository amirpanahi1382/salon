import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const SERVICE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ServiceStatusDto = (typeof SERVICE_STATUSES)[number];

export class CreateServiceDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: SERVICE_STATUSES })
  @IsOptional()
  @IsIn(SERVICE_STATUSES)
  status?: ServiceStatusDto;
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
