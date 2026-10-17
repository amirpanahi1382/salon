import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformAdminPrincipal } from '@salon/shared';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('platform-admin-auth')
@Controller('admin/auth')
export class PlatformAdminAuthController {
  @Get('me')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated platform-admin principal' })
  me(@CurrentPlatformAdmin() admin: PlatformAdminPrincipal) {
    return admin;
  }
}
