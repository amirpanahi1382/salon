import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AppError } from '@salon/shared';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.id?.toString() ?? request.headers['x-request-id'];

    if (exception instanceof AppError) {
      response.status(exception.statusCode).json({
        statusCode: exception.statusCode,
        error: exception.code,
        message: exception.message,
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? (body as { message: string | string[] }).message
            : exception.message;

      response.status(status).json({
        statusCode: status,
        error: status === HttpStatus.UNAUTHORIZED ? 'UNAUTHENTICATED' : 'HTTP_ERROR',
        message,
        requestId,
      });
      return;
    }

    this.logger.error(
      {
        requestId,
        err: exception instanceof Error ? exception.message : 'unknown',
      },
      'Unhandled error',
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    });
  }
}
