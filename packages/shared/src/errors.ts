export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BUSINESS_RULE'
  | 'INFRASTRUCTURE_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message, 401);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not permitted') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super('BUSINESS_RULE', message, 409);
    this.name = 'BusinessRuleError';
  }
}

/** Dependency or outbound-call failure. Safe client message; details stay in logs. */
export class InfrastructureError extends AppError {
  constructor(message = 'A required service is temporarily unavailable') {
    super('INFRASTRUCTURE_ERROR', message, 503);
    this.name = 'InfrastructureError';
  }
}
