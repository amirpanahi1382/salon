import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@salon/database';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(config: AppConfigService) {
    this.client = createPrismaClient(config.values.DATABASE_URL, {
      connectionLimit: config.values.DATABASE_CONNECTION_LIMIT,
      poolTimeoutSeconds: config.values.DATABASE_POOL_TIMEOUT_SECONDS,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
