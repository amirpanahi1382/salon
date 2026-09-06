import pino from 'pino';
import { LOG_REDACT_PATHS } from '@salon/shared';
import type { AppConfig } from '@salon/config';

export function createWorkerLogger(config: AppConfig): pino.Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: 'worker',
      environment: config.NODE_ENV,
    },
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: '[redacted]',
    },
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
  });
}
