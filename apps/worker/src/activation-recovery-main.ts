import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@salon/config';
import { assertCanonicalDatabase } from '@salon/database';
import { ActivationReceiptRecoveryModule } from './activation/activation-receipt-recovery.module';
import { AppConfigService } from './infrastructure/config/app-config.service';
import { PrismaService } from './infrastructure/database/prisma.service';
import { createWorkerLogger } from './infrastructure/logging/worker-logger';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createWorkerLogger(config);
  if (config.ACTIVATION_RECEIPT_AUTOMATIC_CLEANUP_ENABLED) {
    throw new Error('Automatic receipt deletion is not permitted in the isolated recovery process');
  }
  const app = await NestFactory.createApplicationContext(ActivationReceiptRecoveryModule, {
    logger: false,
    abortOnError: false,
  });
  if (config.CANONICAL_DATABASE_REQUIRED) {
    try {
      await assertCanonicalDatabase(app.get(PrismaService).client, {
        databaseName: config.CANONICAL_DATABASE_NAME ?? '',
        systemIdentifier: config.CANONICAL_SYSTEM_IDENTIFIER ?? '',
        databaseComment: config.CANONICAL_DATABASE_COMMENT ?? '',
      });
    } catch (error) {
      await app.close();
      throw error;
    }
    logger.info(
      {
        operation: 'activation_receipt_recovery.canonical_identity',
        database: config.CANONICAL_DATABASE_NAME,
        outcome: 'verified',
      },
      'Canonical database identity verified',
    );
  }
  const runtimeConfig = app.get(AppConfigService).values;
  logger.info(
    {
      operation: 'activation_receipt_recovery.bootstrap',
      mode: 'quarantine_only',
      revision: runtimeConfig.API_REVISION,
      batchSize: runtimeConfig.VIP_UPLOAD_RECOVERY_BATCH_SIZE,
      intervalMs: runtimeConfig.VIP_UPLOAD_RECOVERY_INTERVAL_MS,
    },
    'Activation receipt quarantine recovery started',
  );

  let stopping = false;
  const shutdown = async (signal: 'SIGTERM' | 'SIGINT'): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(
      { operation: 'activation_receipt_recovery.shutdown', signal },
      'Activation receipt quarantine recovery stopping',
    );
    try {
      // Processor.onModuleDestroy stops its interval and awaits its in-flight
      // bounded tick before PrismaService disconnects.
      await app.close();
      logger.info(
        { operation: 'activation_receipt_recovery.shutdown', signal, outcome: 'closed' },
        'Activation receipt quarantine recovery stopped',
      );
      process.exit(0);
    } catch {
      logger.error(
        { operation: 'activation_receipt_recovery.shutdown', signal, outcome: 'failed', errorCode: 'SHUTDOWN_FAILED' },
        'Activation receipt quarantine recovery shutdown failed',
      );
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', service: 'activation-receipt-recovery', operation: 'activation_receipt_recovery.bootstrap', outcome: 'failed', errorCode: 'BOOTSTRAP_FAILED', msg: 'Activation receipt recovery bootstrap failed' })}\n`,
  );
  process.exit(1);
});
