import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@salon/config';
import { WorkerModule } from './worker.module';
import { createWorkerLogger } from './infrastructure/logging/worker-logger';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createWorkerLogger(config);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();
  logger.info({ operation: 'worker.bootstrap' }, 'Worker started (no HTTP server)');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', service: 'worker', msg: message })}\n`,
  );
  process.exit(1);
});
