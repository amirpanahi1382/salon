import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { isSwaggerEnabled, loadConfig } from '@salon/config';
import { AppModule } from './app.module';
import { bindShutdownSignals } from './infrastructure/observability/shutdown';
import { ShutdownState } from './infrastructure/observability/shutdown-state';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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

  await app.listen(config.API_PORT);
  const server = app.getHttpServer() as {
    timeout?: number;
    headersTimeout?: number;
    keepAliveTimeout?: number;
  };
  // Inbound socket idle timeout. Excel import allows up to 90s client-side.
  server.timeout = 120_000;
  server.headersTimeout = 125_000;
  server.keepAliveTimeout = 5_000;
  Logger.log(`API listening on port ${config.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error';
  Logger.error(message, 'Bootstrap');
  process.exit(1);
});
