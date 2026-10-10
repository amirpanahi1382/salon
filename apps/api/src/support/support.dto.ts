import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPPORT_TEXT_MAX_LENGTH } from './support.constants';

export class PostSupportMessageDto {
  @ApiProperty({ maxLength: SUPPORT_TEXT_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(SUPPORT_TEXT_MAX_LENGTH)
  text!: string;
}

export class SupportCursorQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
