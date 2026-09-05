import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { AppConfigService } from './infrastructure/config/app-config.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { HttpExceptionFilter } from './infrastructure/http/http-exception.filter';
import { HealthModule } from './health/health.module';
import { SalonModule } from './salon/salon.module';
import { UserModule } from './user/user.module';
import { CustomerModule } from './customer/customer.module';
import { VisitModule } from './visit/visit.module';
import { IntelligenceModule } from './intelligence/intelligence.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.values.LOG_LEVEL,
          genReqId: (req, res) => {
            const existing = req.headers['x-request-id'];
            const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          transport:
            config.values.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'password',
              'passwordHash',
              '*.password',
              '*.passwordHash',
              'phoneNumber',
              '*.phoneNumber',
            ],
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
    VisitModule,
    IntelligenceModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
