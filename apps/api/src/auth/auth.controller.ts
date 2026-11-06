import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import {
  CompletePasswordRecoveryDto,
  CompletePhoneSignupDto,
  PhoneLoginDto,
  StartPasswordRecoveryDto,
  StartPhoneSignupDto,
  VerifyPasswordRecoveryDto,
  VerifyPhoneSignupDto,
} from './auth.dto';
import { CompletePhoneSignupUseCase } from './complete-phone-signup.use-case';
import { ExchangeProductSessionUseCase } from './exchange-product-session.use-case';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  CompletePasswordRecoveryUseCase,
  StartPasswordRecoveryUseCase,
  VerifyPasswordRecoveryUseCase,
} from './password-recovery.use-cases';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PhoneLoginUseCase } from './phone-login.use-case';
import { PhoneSignupEnabledGuard } from './phone-signup-enabled.guard';
import { StartPhoneSignupUseCase, VerifyPhoneSignupUseCase } from './phone-signup.use-cases';
import { AllowOnboardingSession } from './salon-session-access';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly startPhoneSignup: StartPhoneSignupUseCase,
    private readonly verifyPhoneSignup: VerifyPhoneSignupUseCase,
    private readonly completePhoneSignup: CompletePhoneSignupUseCase,
    private readonly phoneLogin: PhoneLoginUseCase,
    private readonly exchangeProductSession: ExchangeProductSessionUseCase,
    private readonly startPasswordRecovery: StartPasswordRecoveryUseCase,
    private readonly verifyPasswordRecovery: VerifyPasswordRecoveryUseCase,
    private readonly completePasswordRecovery: CompletePasswordRecoveryUseCase,
    private readonly config: AppConfigService,
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
      passwordConfirmation: body.passwordConfirmation,
      idempotencyKey,
    });
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

  @Get('password-recovery/availability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Whether password recovery is configured. Does not reveal accounts, secrets, or provider state.',
  })
  passwordRecoveryAvailability() {
    return { available: Boolean(this.config.values.PASSWORD_RECOVERY_HASH_SECRET) };
  }

  @Post('password-recovery/start')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Start a phone-possession challenge for password recovery. Independent of signup. Does not reveal whether the phone has an account.',
  })
  startPasswordRecoveryChallenge(
    @Body() body: StartPasswordRecoveryDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.startPasswordRecovery.execute({ phone: body.phone, idempotencyKey });
  }

  @Post('password-recovery/verify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Verify a recovery possession code and return a one-time recovery proof. A signup proof cannot reset a password.',
  })
  verifyPasswordRecoveryChallenge(
    @Body() body: VerifyPasswordRecoveryDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.verifyPasswordRecovery.execute({
      phone: body.phone,
      otpCode: body.otpCode,
      idempotencyKey,
    });
  }

  @Post('password-recovery/complete')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Consume a recovery proof and set a new Argon2id password. Does not issue a session. Existing JWTs with a previous credentials version stop authenticating.',
  })
  completePasswordRecoveryChallenge(
    @Body() body: CompletePasswordRecoveryDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.completePasswordRecovery.execute({
      phone: body.phone,
      recoveryProof: body.recoveryProof,
      password: body.password,
      passwordConfirmation: body.passwordConfirmation,
      idempotencyKey,
    });
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
  @ApiOperation({ summary: 'Return the authenticated principal. The phone number is not included.' })
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
