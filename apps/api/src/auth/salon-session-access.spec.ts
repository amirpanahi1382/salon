import { ForbiddenError } from '@salon/shared';
import { enforceSalonSessionAccess } from './salon-session-access';
import { resolveSalonSession } from './salon-session';

function contextWith(user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as never;
}

describe('salon session access', () => {
  it('allows a product session and a platform admin on an ordinary route', () => {
    const reflector = { getAllAndOverride: () => false } as never;
    expect(() =>
      enforceSalonSessionAccess(
        reflector,
        contextWith({ userId: 'u', tenantId: 't', role: 'OWNER', sessionScope: 'product' }),
      ),
    ).not.toThrow();
    expect(() =>
      enforceSalonSessionAccess(reflector, contextWith({ kind: 'platform', adminId: 'a' })),
    ).not.toThrow();
  });

  it('denies an onboarding session unless the route opts in', () => {
    const onboarding = {
      userId: 'u',
      tenantId: 't',
      role: 'OWNER',
      sessionScope: 'onboarding',
      accessState: 'AWAITING_AGREEMENT',
    };
    expect(() =>
      enforceSalonSessionAccess(
        { getAllAndOverride: () => false } as never,
        contextWith(onboarding),
      ),
    ).toThrow(ForbiddenError);
    expect(() =>
      enforceSalonSessionAccess(
        { getAllAndOverride: () => true } as never,
        contextWith(onboarding),
      ),
    ).not.toThrow();
  });

  it('keeps an onboarding token from becoming a product token', () => {
    expect(resolveSalonSession('onboarding', 'AWAITING_AGREEMENT')).toBe('onboarding');
    expect(resolveSalonSession('onboarding', 'AWAITING_PAYMENT')).toBe('onboarding');
    expect(resolveSalonSession('onboarding', 'PRODUCT')).toBe('onboarding');
    expect(resolveSalonSession('product', 'PRODUCT')).toBe('product');
    expect(resolveSalonSession('product', 'AWAITING_PAYMENT')).toBeNull();
    expect(resolveSalonSession('product', 'AWAITING_AGREEMENT')).toBeNull();
  });
});
