import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  ForbiddenError,
  UnauthenticatedError,
  isPlatformAdminPrincipal,
  isSalonPrincipal,
  type RequestPrincipal,
} from '@salon/shared';

export const ALLOW_ONBOARDING_SESSION = 'allowOnboardingSession';

/**
 * Opt a route into the onboarding session. Product routes do not set this.
 * The check lives in JwtAuthGuard, so product modules do not repeat it.
 */
export const AllowOnboardingSession = () => SetMetadata(ALLOW_ONBOARDING_SESSION, true);

/**
 * Product sessions pass. Onboarding sessions pass only where the route opts in.
 * Platform admin tokens are not salon sessions.
 * A product token whose salon is no longer PRODUCT is rejected in JwtStrategy
 * before this runs, so an old token cannot keep product access.
 */
export function enforceSalonSessionAccess(reflector: Reflector, context: ExecutionContext): void {
  const request = context.switchToHttp().getRequest<{ user?: RequestPrincipal }>();
  const user = request.user;
  if (!user || isPlatformAdminPrincipal(user)) {
    return;
  }
  if (!isSalonPrincipal(user)) {
    throw new UnauthenticatedError();
  }
  if ((user.sessionScope ?? 'product') === 'product') {
    return;
  }
  const allowed = reflector.getAllAndOverride<boolean>(ALLOW_ONBOARDING_SESSION, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (!allowed) {
    throw new ForbiddenError();
  }
}
