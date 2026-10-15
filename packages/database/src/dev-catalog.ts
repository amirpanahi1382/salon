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

/** Starter catalog for a new owner. Automated test emails skip it. A phone owner has no email. */
export function starterServiceNamesForRegistration(email: string | null): readonly string[] {
  if (email !== null && isAutomatedTestOwnerEmail(email)) {
    return [];
  }
  return STARTER_SERVICE_CATALOG;
}
