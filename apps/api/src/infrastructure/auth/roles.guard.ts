import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ForbiddenError,
  UnauthenticatedError,
  isSalonPrincipal,
  type RequestPrincipal,
  type UserRole,
} from '@salon/shared';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestPrincipal }>();
    if (!request.user) {
      throw new UnauthenticatedError();
    }
    if (!isSalonPrincipal(request.user) || !roles.includes(request.user.role)) {
      throw new ForbiddenError();
    }
    return true;
  }
}
