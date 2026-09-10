import { randomUUID } from 'node:crypto';
import {
  firstHeaderValue,
  isPlatformAdminPrincipal,
  isSafeRequestId,
  type RequestPrincipal,
} from '@salon/shared';
import type { NextFunction, Request, Response } from 'express';

export type RequestContext = {
  requestId: string;
  correlationId: string;
};

export type AppRequest = Request & {
  correlationId?: string;
  operation?: string;
  user?: RequestPrincipal;
};

/**
 * Request IDs are generated server-side unless the client sends a UUID.
 * Correlation IDs follow the same rule and default to the request ID.
 * Tenant identity is never taken from these headers.
 */
export function resolveRequestContext(req: Request): RequestContext {
  const incomingRequestId = firstHeaderValue(req.headers['x-request-id']);
  const incomingCorrelationId = firstHeaderValue(req.headers['x-correlation-id']);
  const requestId = isSafeRequestId(incomingRequestId) ? incomingRequestId : randomUUID();
  const correlationId = isSafeRequestId(incomingCorrelationId)
    ? incomingCorrelationId
    : requestId;
  return { requestId, correlationId };
}

export function requestLogFields(req: AppRequest): Record<string, unknown> {
  const user = req.user;
  return {
    requestId: req.id,
    correlationId: req.correlationId,
    tenantId: user && !isPlatformAdminPrincipal(user) ? user.tenantId : undefined,
    userId: user && !isPlatformAdminPrincipal(user) ? user.userId : undefined,
    adminId: isPlatformAdminPrincipal(user) ? user.adminId : undefined,
    operation: req.operation,
    method: req.method,
    route: req.route?.path ? String(req.route.path) : req.path,
  };
}

export function requestContextMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  const context = resolveRequestContext(req);
  req.id = context.requestId;
  req.correlationId = context.correlationId;
  res.setHeader('x-request-id', context.requestId);
  res.setHeader('x-correlation-id', context.correlationId);
  next();
}
