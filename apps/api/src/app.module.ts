import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { LOG_REDACT_PATHS } from '@salon/shared';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { AppConfigService } from './infrastructure/config/app-config.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { HttpExceptionFilter } from './infrastructure/http/http-exception.filter';
import { resolveRequestContext, requestLogFields } from './infrastructure/http/request-context';
import { MetricsInterceptor } from './infrastructure/observability/metrics.interceptor';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { HealthModule } from './health/health.module';
import { SalonModule } from './salon/salon.module';
import { UserModule } from './user/user.module';
import { CustomerModule } from './customer/customer.module';
import { ObservedOutcomeModule } from './observed-outcome/observed-outcome.module';
import { ReturnCommitmentModule } from './return-commitment/return-commitment.module';
import { VisitModule } from './visit/visit.module';
import { ServiceModule } from './service/service.module';
import { TransactionModule } from './transaction/transaction.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { ActionModule } from './action/action.module';
import { MessagingModule } from './messaging/messaging.module';
import { VipModule } from './vip/vip.module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppRequest } from './infrastructure/http/request-context';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.values.LOG_LEVEL,
          base: {
            service: 'api',
            environment: config.values.NODE_ENV,
          },
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const expressReq = req as AppRequest;
            const context = resolveRequestContext(expressReq);
            expressReq.correlationId = context.correlationId;
            res.setHeader('x-request-id', context.requestId);
            res.setHeader('x-correlation-id', context.correlationId);
            return context.requestId;
          },
          customProps: (req: IncomingMessage) => {
            const expressReq = req as AppRequest;
            return requestLogFields(expressReq);
          },
          customAttributeKeys: {
            responseTime: 'durationMs',
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => {
              const url = req.url?.split('?')[0] ?? '';
              return url === '/health' || url === '/health/ready' || url === '/metrics';
            },
          },
          serializers: {
            req(req: { method?: string; url?: string }) {
              return {
                method: req.method,
                url: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
              };
            },
            res(res: { statusCode?: number }) {
              return { statusCode: res.statusCode };
            },
          },
          transport:
            config.values.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: {
            paths: [...LOG_REDACT_PATHS],
            censor: '[redacted]',
          },
        },
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    SalonModule,
    UserModule,
    CustomerModule,
    ObservedOutcomeModule,
    ReturnCommitmentModule,
    VisitModule,
    ServiceModule,
    TransactionModule,
    IntelligenceModule,
    ActionModule,
    MessagingModule,
    VipModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
