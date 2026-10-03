import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@salon/config';
import { WorkerModule } from './worker.module';
import { createWorkerLogger } from './infrastructure/logging/worker-logger';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createWorkerLogger(config);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    // Nest otherwise logs the raw dependency error before our safe catch handler.
    logger: false,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  logger.info({ operation: 'worker.bootstrap' }, 'Worker started (no HTTP server)');
}

bootstrap().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', service: 'worker', operation: 'worker.bootstrap', outcome: 'failed', errorCode: 'BOOTSTRAP_FAILED', msg: 'Worker bootstrap failed' })}\n`,
  );
  process.exit(1);
});
