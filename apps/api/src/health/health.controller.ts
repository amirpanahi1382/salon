import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness: process is running (no dependency checks)' })
  live() {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness: PostgreSQL is reachable and this instance is not draining',
  })
  async ready(@Res({ passthrough: true }) response: Response) {
    const body = await this.health.ready();
    if (body.status !== 'ok') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
