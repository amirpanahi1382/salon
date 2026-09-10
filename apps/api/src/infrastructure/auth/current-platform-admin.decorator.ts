import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  UnauthenticatedError,
  isPlatformAdminPrincipal,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import type { Request } from 'express';

export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (!isPlatformAdminPrincipal(request.user as never)) {
      throw new UnauthenticatedError();
    }
    return request.user as PlatformAdminPrincipal;
  },
);
