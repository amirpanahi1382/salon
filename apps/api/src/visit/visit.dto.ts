import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID } from 'class-validator';

export class CreateVisitDto {
  @ApiProperty()
  @IsUUID()
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
