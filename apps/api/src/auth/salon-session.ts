import { randomUUID } from 'node:crypto';
import type { JwtService } from '@nestjs/jwt';
import type { SalonAccessState, SessionScope } from '@salon/shared';

/**
 * A product token is valid only while the salon is PRODUCT.
 * An onboarding token stays onboarding when access later changes.
 */
export function resolveSalonSession(
  tokenScope: SessionScope,
  accessState: SalonAccessState,
): SessionScope | null {
  if (tokenScope === 'product') {
    return accessState === 'PRODUCT' ? 'product' : null;
  }
  return 'onboarding';
}

export async function signSalonSession(
  jwt: JwtService,
  user: { id: string; salonId: string; role: string; accessState: SalonAccessState },
): Promise<{ accessToken: string; sessionScope: SessionScope; sessionId: string }> {
  const sessionScope: SessionScope = user.accessState === 'PRODUCT' ? 'product' : 'onboarding';
  const sessionId = randomUUID();
  const payload: { sub: string; tid: string; role: string; scp?: 'onboarding' } = {
    sub: user.id,
    tid: user.salonId,
    role: user.role,
  };
  if (sessionScope === 'onboarding') {
    payload.scp = 'onboarding';
  }
  const accessToken = await jwt.signAsync(payload, { jwtid: sessionId });
  return { accessToken, sessionScope, sessionId };
}
