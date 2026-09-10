export type TenantId = string;
export type UserId = string;
export type PlatformAdminId = string;

export interface AuthenticatedPrincipal {
  userId: UserId;
  tenantId: TenantId;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
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
