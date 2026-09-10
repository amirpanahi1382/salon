import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  UnauthenticatedError,
  isSalonPrincipal,
  type AuthenticatedPrincipal,
  type RequestPrincipal,
} from '@salon/shared';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as RequestPrincipal | undefined;
    if (!isSalonPrincipal(user)) {
      throw new UnauthenticatedError();
    }
    return user;
  },
);
