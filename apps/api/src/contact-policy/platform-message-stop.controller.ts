import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';
import type { PlatformAdminPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { PlatformMessageStopService } from './platform-message-stop.service';

class PlatformMessageStopBody {
  @IsString()
  phoneNumber!: string;

  @IsBoolean()
  confirmed!: boolean;
}

@ApiTags('admin-message-stops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/message-stops')
export class PlatformMessageStopController {
  constructor(private readonly stops: PlatformMessageStopService) {}

  @Get()
  @ApiOperation({ summary: 'Look up one exact canonical phone on the platform stop list' })
  search(@Query('phone') phone: string) {
    return this.stops.search(phone ?? '');
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a platform-wide stop for one canonical phone' })
  register(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Body() body: PlatformMessageStopBody,
  ) {
    return this.stops.register(admin, body.phoneNumber, body.confirmed);
  }

  @Post('lift')
  @HttpCode(201)
  @ApiOperation({ summary: 'Lift a platform-wide stop without resending blocked work' })
  lift(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Body() body: PlatformMessageStopBody,
  ) {
    return this.stops.lift(admin, body.phoneNumber, body.confirmed);
  }
}
