import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterSalonOwnerDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  salonName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  ownerName!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class StartPhoneSignupDto {
  @ApiProperty({ description: 'Iranian mobile number. Stored only as a keyed hash.' })
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;
}

export class VerifyPhoneSignupDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;

  @ApiProperty({ description: 'Signup possession code. Not an account password.' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'Enter the signup code.' })
  otpCode!: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class CompletePhoneSignupDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;

  @ApiProperty({ description: 'One-time signup proof from phone verification. Not a session.' })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  signupProof!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  salonName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  ownerName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class PhoneLoginDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(24)
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
