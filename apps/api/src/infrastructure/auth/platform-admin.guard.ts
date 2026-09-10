import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  ForbiddenError,
  UnauthenticatedError,
  isPlatformAdminPrincipal,
  type RequestPrincipal,
} from '@salon/shared';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: RequestPrincipal }>();
    if (!request.user) {
      throw new UnauthenticatedError();
    }
    if (!isPlatformAdminPrincipal(request.user)) {
      throw new ForbiddenError();
    }
    return true;
  }
}
