import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PresentAgreementDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @ApiProperty({ description: 'User-declared national ID. Not independently verified.' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  nationalId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  salonName!: string;

  @ApiProperty({ description: 'Must match the OTP-verified account phone.' })
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;
}

export class AcceptAgreementDto {
  @ApiProperty()
  @IsUUID()
  presentationId!: string;

  @ApiProperty({ description: 'Must be true. A missing or false value is not acceptance.' })
  @IsBoolean()
  @Equals(true)
  accepted!: boolean;
}
