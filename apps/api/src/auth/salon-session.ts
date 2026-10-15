import type { JwtService } from '@nestjs/jwt';
import type { SalonAccessState, SessionScope } from '@salon/shared';

export async function signSalonSession(
  jwt: JwtService,
  user: { id: string; salonId: string; role: string; accessState: SalonAccessState },
): Promise<{ accessToken: string; sessionScope: SessionScope }> {
  const sessionScope: SessionScope = user.accessState === 'PRODUCT' ? 'product' : 'onboarding';
  const payload: { sub: string; tid: string; role: string; scp?: 'onboarding' } = {
    sub: user.id,
    tid: user.salonId,
    role: user.role,
  };
  if (sessionScope === 'onboarding') {
    payload.scp = 'onboarding';
  }
  const accessToken = await jwt.signAsync(payload);
  return { accessToken, sessionScope };
}
