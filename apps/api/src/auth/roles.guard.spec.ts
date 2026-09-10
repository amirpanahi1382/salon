import { ForbiddenError } from '@salon/shared';
import { RolesGuard } from '../infrastructure/auth/roles.guard';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: () => ['OWNER'],
  };
  const guard = new RolesGuard(reflector as never);

  const contextWith = (user: unknown) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as never;

  it('allows the required role', () => {
    expect(
      guard.canActivate(
        contextWith({ userId: 'u1', tenantId: 't1', role: 'OWNER' }),
      ),
    ).toBe(true);
  });

  it('rejects platform admins on salon routes', () => {
    expect(() =>
      guard.canActivate(contextWith({ kind: 'platform', adminId: 'a1' })),
    ).toThrow(ForbiddenError);
  });
});
