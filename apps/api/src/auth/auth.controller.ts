import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { LoginDto, RegisterSalonOwnerDto, StartPhoneSignupDto, VerifyPhoneSignupDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginUseCase } from './login.use-case';
import { PhoneSignupEnabledGuard } from './phone-signup-enabled.guard';
import { StartPhoneSignupUseCase, VerifyPhoneSignupUseCase } from './phone-signup.use-cases';
import { RegisterSalonOwnerUseCase } from './register-salon-owner.use-case';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerSalonOwner: RegisterSalonOwnerUseCase,
    private readonly login: LoginUseCase,
    private readonly startPhoneSignup: StartPhoneSignupUseCase,
    private readonly verifyPhoneSignup: VerifyPhoneSignupUseCase,
  ) {}

  @Post('signup/phone/start')
  @UseGuards(PhoneSignupEnabledGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Start a phone-possession challenge for a future salon owner. Disabled unless PHONE_SIGNUP_ENABLED. Does not create a salon, user, or session, and is not a marketing message.',
  })
  startPhoneSignupChallenge(
    @Body() body: StartPhoneSignupDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.startPhoneSignup.execute({ phone: body.phone, idempotencyKey });
  }

  @Post('signup/phone/verify')
  @UseGuards(PhoneSignupEnabledGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Verify a phone-possession code and return a one-time signup proof. Does not create an account. A false provider result does not explain why.',
  })
  verifyPhoneSignupChallenge(
    @Body() body: VerifyPhoneSignupDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.verifyPhoneSignup.execute({
      phone: body.phone,
      otpCode: body.otpCode,
      idempotencyKey,
    });
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a salon and owner account' })
  register(@Body() body: RegisterSalonOwnerDto) {
    return this.registerSalonOwner.execute(body);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate with email and password' })
  signIn(@Body() body: LoginDto) {
    return this.login.execute(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated principal (tenant is server-derived)' })
  me(@CurrentUser() user: AuthenticatedPrincipal) {
    return user;
  }

  @Get('owner')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner-only principal check (Phase 1 authorization pipeline)' })
  owner(@CurrentUser() user: AuthenticatedPrincipal) {
    return user;
  }
}
