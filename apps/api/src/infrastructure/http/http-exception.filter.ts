import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@salon/database';
import { AppError, firstHeaderValue, isSafeRequestId } from '@salon/shared';
import type { AppRequest } from './request-context';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { CUSTOMER_IMPORT_MAX_FILE_BYTES } from '../../customer/customer-import.constants';
import { mapPrismaError } from './prisma-error';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AppRequest>();
    const incomingRequestId = firstHeaderValue(request.headers['x-request-id']);
    const requestId = request.id?.toString() ??
      (isSafeRequestId(incomingRequestId) ? incomingRequestId : randomUUID());
    const correlationId = request.correlationId;
    const tenantId =
      request.user && 'tenantId' in request.user ? request.user.tenantId : undefined;
    const userId = request.user && 'userId' in request.user ? request.user.userId : undefined;
    const operation = request.operation;
    const method = request.method;
    const route = request.route?.path ? String(request.route.path) : 'unmatched';

    if (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: 'VALIDATION_ERROR',
        message: `The file is too large. Maximum size is ${CUSTOMER_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB.`,
        requestId,
      });
      return;
    }

    const prismaMapped = mapPrismaError(exception);
    if (prismaMapped) {
      this.logger.warn({
        requestId,
        correlationId,
        tenantId,
        userId,
        operation,
        method,
        route,
        errorCode: prismaMapped.code,
        errorType: 'PrismaError',
        statusCode: prismaMapped.statusCode,
        prismaCode: prismaCodeOf(exception),
      });
      response.status(prismaMapped.statusCode).json({
        statusCode: prismaMapped.statusCode,
        error: prismaMapped.code,
        message: prismaMapped.message,
        requestId,
      });
      return;
    }

    if (exception instanceof AppError) {
      this.logAppError(exception, {
        requestId,
        correlationId,
        tenantId,
        userId,
        operation,
        method,
        route,
      });
      response.status(exception.statusCode).json({
        statusCode: exception.statusCode,
        error: exception.code,
        message: exception.statusCode >= 500
          ? exception.code === 'INFRASTRUCTURE_ERROR'
            ? 'A required service is temporarily unavailable'
            : 'An unexpected error occurred'
          : exception.message,
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        status >= 500
          ? 'An unexpected error occurred'
          : typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? (body as { message: string | string[] }).message
            : exception.message;

      this.logger.warn({
        requestId,
        correlationId,
        tenantId,
        userId,
        operation,
        method,
        route,
        errorCode: httpErrorCode(status),
        errorType: 'HttpException',
        statusCode: status,
      });

      response.status(status).json({
        statusCode: status,
        error: httpErrorCode(status),
        message,
        requestId,
      });
      return;
    }

    this.logger.error(
      {
        requestId,
        correlationId,
        tenantId,
        userId,
        operation,
        method,
        route,
        errorCode: 'INTERNAL_ERROR',
        errorType: exception instanceof Error ? 'Error' : 'unknown',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        prismaCode: prismaCodeOf(exception),
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

  private logAppError(
    exception: AppError,
    context: Record<string, unknown>,
  ): void {
    const payload = {
      ...context,
      errorCode: exception.code,
      errorType: 'AppError',
      statusCode: exception.statusCode,
    };
    if (exception.statusCode >= 500) {
      this.logger.error(payload, 'Application service failure');
      return;
    }
    this.logger.warn(payload);
  }
}

function prismaCodeOf(exception: unknown): string | undefined {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return /^P[0-9]{4}$/.test(exception.code) ? exception.code : undefined;
  }
  return undefined;
}

function httpErrorCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'INFRASTRUCTURE_ERROR';
    default:
      return 'HTTP_ERROR';
  }
}
