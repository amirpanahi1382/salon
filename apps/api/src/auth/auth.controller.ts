import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import {
  CompletePhoneSignupDto,
  LoginDto,
  PhoneLoginDto,
  RegisterSalonOwnerDto,
  StartPhoneSignupDto,
  VerifyPhoneSignupDto,
} from './auth.dto';
import { CompletePhoneSignupUseCase } from './complete-phone-signup.use-case';
import { ExchangeProductSessionUseCase } from './exchange-product-session.use-case';
import { EmailRegistrationGuard } from './email-registration.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginUseCase } from './login.use-case';
import { PhoneLoginUseCase } from './phone-login.use-case';
import { PhoneSignupEnabledGuard } from './phone-signup-enabled.guard';
import { StartPhoneSignupUseCase, VerifyPhoneSignupUseCase } from './phone-signup.use-cases';
import { RegisterSalonOwnerUseCase } from './register-salon-owner.use-case';
import { AllowOnboardingSession } from './salon-session-access';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerSalonOwner: RegisterSalonOwnerUseCase,
    private readonly login: LoginUseCase,
    private readonly startPhoneSignup: StartPhoneSignupUseCase,
    private readonly verifyPhoneSignup: VerifyPhoneSignupUseCase,
    private readonly completePhoneSignup: CompletePhoneSignupUseCase,
    private readonly phoneLogin: PhoneLoginUseCase,
    private readonly exchangeProductSession: ExchangeProductSessionUseCase,
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

  @Post('signup/phone/complete')
  @UseGuards(PhoneSignupEnabledGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Consume a signup proof and create one phone-owned salon in AWAITING_AGREEMENT. Does not return a product session. Disabled unless PHONE_SIGNUP_ENABLED.',
  })
  completePhoneSignupChallenge(
    @Body() body: CompletePhoneSignupDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.completePhoneSignup.execute({
      phone: body.phone,
      signupProof: body.signupProof,
      salonName: body.salonName,
      ownerName: body.ownerName,
      password: body.password,
      idempotencyKey,
    });
  }

  @Post('register')
  @UseGuards(EmailRegistrationGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Register a salon and owner by email. Available only when PUBLIC_REGISTRATION_MODE=email.',
  })
  register(@Body() body: RegisterSalonOwnerDto) {
    return this.registerSalonOwner.execute(body);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate with email and password' })
  signIn(@Body() body: LoginDto) {
    return this.login.execute(body);
  }

  @Post('login/phone')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Authenticate a phone-owned owner. Independent of OTP signup. A salon that is not PRODUCT receives an onboarding session.',
  })
  signInWithPhone(@Body() body: PhoneLoginDto) {
    return this.phoneLogin.execute(body);
  }

  @Get('account')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @AllowOnboardingSession()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Current salon access state for this session. Allowed for an onboarding session.',
  })
  account(@CurrentUser() user: AuthenticatedPrincipal) {
    return {
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
      sessionScope: user.sessionScope ?? 'product',
      accessState: user.accessState ?? 'PRODUCT',
    };
  }

  @Post('session/product')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @AllowOnboardingSession()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Issue a product session after the salon access state is PRODUCT. The onboarding token is not promoted.',
  })
  exchangeSession(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.exchangeProductSession.execute(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @AllowOnboardingSession()
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
