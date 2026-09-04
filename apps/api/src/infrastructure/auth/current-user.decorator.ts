import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError, type AuthenticatedPrincipal } from '@salon/shared';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedPrincipal }>();
    if (!request.user) {
      throw new UnauthenticatedError();
    }
    return request.user;
  },
);
