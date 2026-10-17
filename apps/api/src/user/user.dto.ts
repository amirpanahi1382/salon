import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { USER_ROLES, type UserRole } from '@salon/shared';

const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
type UserAccountStatus = (typeof USER_STATUSES)[number];

export class CreateSalonUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ required: false, nullable: true, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiProperty({ description: 'Canonical Iranian mobile. Login identity for this account.' })
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'Enter an Iranian mobile number.' })
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  role!: UserRole;
}

export class ChangeUserRoleDto {
  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  role!: UserRole;
}

export class ChangeUserStatusDto {
  @ApiProperty({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
  status!: UserAccountStatus;
}

export class SalonUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ enum: USER_ROLES })
  role!: UserRole;

  @ApiProperty({ enum: USER_STATUSES })
  status!: UserAccountStatus;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
