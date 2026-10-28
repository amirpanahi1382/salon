import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { isSwaggerEnabled, loadConfig } from '@salon/config';
import { AppModule } from './app.module';
import { bindShutdownSignals } from './infrastructure/observability/shutdown';
import { ShutdownState } from './infrastructure/observability/shutdown-state';
import { listenApi } from './auth/listen-api';
import { assertCanonicalDatabase } from './infrastructure/database/assert-canonical-database';
import { PrismaService } from './infrastructure/database/prisma.service';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  // Suppress Nest's own raw bootstrap exception logging until the safe logger is installed.
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.useLogger(app.get(PinoLogger));
  app.use(helmet());
  app.enableShutdownHooks();
  bindShutdownSignals(app.get(ShutdownState), config.API_SHUTDOWN_GRACE_MS);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (isSwaggerEnabled(config)) {
    const swagger = new DocumentBuilder()
      .setTitle('Salon Revenue Intelligence API')
      .setDescription(
        'Phase 5: authentication, salon users, customers, completed visits, and visit-based customer intelligence',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  if (config.CANONICAL_DATABASE_REQUIRED) {
    try {
      await assertCanonicalDatabase(app.get(PrismaService).client, {
        databaseName: config.CANONICAL_DATABASE_NAME ?? '',
        systemIdentifier: config.CANONICAL_SYSTEM_IDENTIFIER ?? '',
        databaseComment: config.CANONICAL_DATABASE_COMMENT ?? '',
      });
    } catch (error) {
      Logger.error(
        error instanceof Error ? error.message : 'Canonical database identity check failed',
        'Bootstrap',
      );
      await app.close();
      process.exit(1);
    }
    Logger.log(
      `Canonical database ${config.CANONICAL_DATABASE_NAME} identity verified`,
      'Bootstrap',
    );
  }

  // Process environment wins over env files, so an inherited API_PORT is the bind port.
  // listenApi performs no credential write before or after a failed bind.
  // API_PORT does not choose the address. An unset API_BIND_HOST keeps listen(port).
  await listenApi(
    (port, host) => (host === undefined ? app.listen(port) : app.listen(port, host)),
    config.API_PORT,
    config.API_BIND_HOST,
  );
  const server = app.getHttpServer() as {
    timeout?: number;
    headersTimeout?: number;
    keepAliveTimeout?: number;
  };
  // Inbound socket idle timeout. Excel import allows up to 90s client-side.
  server.timeout = 120_000;
  server.headersTimeout = 125_000;
  server.keepAliveTimeout = 5_000;
  Logger.log(
    config.API_BIND_HOST === undefined
      ? `API listening on port ${config.API_PORT}`
      : `API listening on ${config.API_BIND_HOST}:${config.API_PORT}`,
    'Bootstrap',
  );
}

bootstrap().catch(() => {
  Logger.error('API bootstrap failed; inspect configuration and dependencies', 'Bootstrap');
  process.exit(1);
});
