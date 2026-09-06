import { Injectable } from '@nestjs/common';
import { withTimeout } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ShutdownState } from '../infrastructure/observability/shutdown-state';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly shutdown: ShutdownState,
  ) {}

  live() {
    return { status: 'ok' as const };
  }

  async ready() {
    if (this.shutdown.isDraining()) {
      return {
        status: 'not_ready' as const,
        reason: 'shutting_down',
        checks: { postgres: 'skipped' as const },
      };
    }

    const postgres = await this.checkPostgres();
    return {
      status: postgres === 'up' ? ('ok' as const) : ('not_ready' as const),
      checks: { postgres },
    };
  }

  private async checkPostgres(): Promise<'up' | 'down'> {
    try {
      await withTimeout(
        this.prisma.client.$queryRaw`SELECT 1`,
        this.config.values.HEALTH_CHECK_TIMEOUT_MS,
        'postgres health check timed out',
      );
      return 'up';
    } catch {
      return 'down';
    }
  }
}
