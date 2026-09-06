import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { AppRequest } from '../http/request-context';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();
    const started = Date.now();
    request.operation = `${context.getClass().name}.${context.getHandler().name}`;

    response.once('finish', () => {
      const route = request.route?.path ? String(request.route.path) : 'unmatched';
      this.metrics.recordHttpRequest(
        request.method,
        route,
        response.statusCode,
        Date.now() - started,
      );
    });

    return next.handle();
  }
}
