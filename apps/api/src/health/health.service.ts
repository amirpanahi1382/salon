import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  live() {
    return { status: 'ok' as const };
  }

  async ready() {
    const checks = {
      postgres: await this.checkPostgres(),
      redis: await this.checkRedis(),
      objectStorage: await this.checkMinio(),
    };

    const healthy = Object.values(checks).every((check) => check === 'up');
    return {
      status: healthy ? ('ok' as const) : ('degraded' as const),
      checks,
    };
  }

  private async checkPostgres(): Promise<'up' | 'down'> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    const redis = new Redis(this.config.values.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      redis.disconnect();
    }
  }

  private async checkMinio(): Promise<'up' | 'down'> {
    const client = new MinioClient({
      endPoint: this.config.values.MINIO_ENDPOINT,
      port: this.config.values.MINIO_PORT,
      useSSL: this.config.values.MINIO_USE_SSL,
      accessKey: this.config.values.MINIO_ACCESS_KEY,
      secretKey: this.config.values.MINIO_SECRET_KEY,
    });
    try {
      await client.bucketExists(this.config.values.MINIO_BUCKET);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
