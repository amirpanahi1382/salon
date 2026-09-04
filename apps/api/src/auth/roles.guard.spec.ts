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

  it('rejects users without the required role', () => {
    expect(() =>
      guard.canActivate(
        contextWith({ userId: 'u1', tenantId: 't1', role: 'STAFF' }),
      ),
    ).toThrow(ForbiddenError);
  });
});
