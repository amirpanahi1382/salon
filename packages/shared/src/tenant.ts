export type TenantId = string;
export type UserId = string;

export interface AuthenticatedPrincipal {
  userId: UserId;
  tenantId: TenantId;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
}

export interface TenantContext {
  tenantId: TenantId;
}
