import type { UserRole } from './roles.js';

export type UserAccountStatus = 'ACTIVE' | 'DISABLED';

/**
 * OWNER may assign any salon role.
 * MANAGER may create STAFF only.
 * STAFF has no user-administration privileges.
 */
export function canAssignRole(actorRole: UserRole, assignedRole: UserRole): boolean {
  if (actorRole === 'OWNER') {
    return true;
  }
  if (actorRole === 'MANAGER') {
    return assignedRole === 'STAFF';
  }
  return false;
}

/**
 * OWNER may change status of any salon user (subject to last-owner invariant).
 * MANAGER may activate/deactivate STAFF only.
 */
export function canChangeUserStatus(
  actorRole: UserRole,
  targetRole: UserRole,
): boolean {
  if (actorRole === 'OWNER') {
    return true;
  }
  if (actorRole === 'MANAGER') {
    return targetRole === 'STAFF';
  }
  return false;
}

export function wouldLeaveSalonWithoutOwner(params: {
  activeOwnerCount: number;
  targetIsCurrentlyActiveOwner: boolean;
  nextRole: UserRole;
  nextStatus: UserAccountStatus;
}): boolean {
  if (!params.targetIsCurrentlyActiveOwner) {
    return false;
  }
  const remainsActiveOwner =
    params.nextStatus === 'ACTIVE' && params.nextRole === 'OWNER';
  if (remainsActiveOwner) {
    return false;
  }
  return params.activeOwnerCount <= 1;
}
