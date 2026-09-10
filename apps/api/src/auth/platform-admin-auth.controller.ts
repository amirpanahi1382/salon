import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { PlatformAdminPrincipal } from '@salon/shared';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { LoginDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PlatformAdminLoginUseCase } from './platform-admin-login.use-case';

@ApiTags('platform-admin-auth')
@Controller('admin/auth')
export class PlatformAdminAuthController {
  constructor(private readonly login: PlatformAdminLoginUseCase) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate a platform admin. Not a salon login.' })
  signIn(@Body() body: LoginDto) {
    return this.login.execute(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated platform-admin principal' })
  me(@CurrentPlatformAdmin() admin: PlatformAdminPrincipal) {
    return admin;
  }
}
