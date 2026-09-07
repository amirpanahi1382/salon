/**
 * Tenant-owned starter catalog names created at OWNER registration.
 * These are ordinary Service rows, not global or special system services.
 * Automated @example.test registrations skip them so tests control the catalog.
 */
export const STARTER_SERVICE_CATALOG = ['Hair Service', 'Nail Service'] as const;

/** @deprecated Use STARTER_SERVICE_CATALOG. Kept for existing imports. */
export const DEV_SERVICE_CATALOG = STARTER_SERVICE_CATALOG;

export function isAutomatedTestOwnerEmail(email: string) {
  return email.trim().toLowerCase().endsWith('@example.test');
}
