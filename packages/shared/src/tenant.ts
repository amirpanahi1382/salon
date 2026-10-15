export type TenantId = string;
export type UserId = string;
export type PlatformAdminId = string;

/** Full product use, or the phone-onboarding session that cannot call product routes. */
export type SessionScope = 'product' | 'onboarding';

/**
 * PRODUCT is full product access. AWAITING_AGREEMENT is the first phone-owned
 * onboarding state. It is not salon suspension and not a VIP entitlement.
 */
export type SalonAccessState = 'PRODUCT' | 'AWAITING_AGREEMENT';

export interface AuthenticatedPrincipal {
  userId: UserId;
  tenantId: TenantId;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  /** Absent on in-process callers that are not an HTTP session. JWT validation always sets it. */
  sessionScope?: SessionScope;
  /** Reloaded from the salon on each authenticated request. */
  accessState?: SalonAccessState;
}

/** Platform operator. Never tenant-scoped. Distinct from OWNER/MANAGER/STAFF. */
export interface PlatformAdminPrincipal {
  kind: 'platform';
  adminId: PlatformAdminId;
}

export type RequestPrincipal = AuthenticatedPrincipal | PlatformAdminPrincipal;

export function isPlatformAdminPrincipal(
  value: RequestPrincipal | undefined,
): value is PlatformAdminPrincipal {
  return value !== undefined && 'kind' in value && value.kind === 'platform';
}

export function isSalonPrincipal(
  value: RequestPrincipal | undefined,
): value is AuthenticatedPrincipal {
  return value !== undefined && !isPlatformAdminPrincipal(value) && 'tenantId' in value;
}

export interface TenantContext {
  tenantId: TenantId;
}
