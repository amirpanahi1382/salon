import {
  canAssignRole,
  canChangeUserStatus,
  wouldLeaveSalonWithoutOwner,
} from './salon-user-policy';

describe('salon user policy', () => {
  it('lets OWNER assign any role and MANAGER assign only STAFF', () => {
    expect(canAssignRole('OWNER', 'OWNER')).toBe(true);
    expect(canAssignRole('OWNER', 'MANAGER')).toBe(true);
    expect(canAssignRole('OWNER', 'STAFF')).toBe(true);
    expect(canAssignRole('MANAGER', 'STAFF')).toBe(true);
    expect(canAssignRole('MANAGER', 'MANAGER')).toBe(false);
    expect(canAssignRole('MANAGER', 'OWNER')).toBe(false);
    expect(canAssignRole('STAFF', 'STAFF')).toBe(false);
  });

  it('lets MANAGER change STAFF status only', () => {
    expect(canChangeUserStatus('OWNER', 'OWNER')).toBe(true);
    expect(canChangeUserStatus('OWNER', 'STAFF')).toBe(true);
    expect(canChangeUserStatus('MANAGER', 'STAFF')).toBe(true);
    expect(canChangeUserStatus('MANAGER', 'OWNER')).toBe(false);
    expect(canChangeUserStatus('MANAGER', 'MANAGER')).toBe(false);
    expect(canChangeUserStatus('STAFF', 'STAFF')).toBe(false);
  });

  it('blocks operations that would leave a salon without an active OWNER', () => {
    expect(
      wouldLeaveSalonWithoutOwner({
        activeOwnerCount: 1,
        targetIsCurrentlyActiveOwner: true,
        nextRole: 'MANAGER',
        nextStatus: 'ACTIVE',
      }),
    ).toBe(true);

    expect(
      wouldLeaveSalonWithoutOwner({
        activeOwnerCount: 1,
        targetIsCurrentlyActiveOwner: true,
        nextRole: 'OWNER',
        nextStatus: 'DISABLED',
      }),
    ).toBe(true);

    expect(
      wouldLeaveSalonWithoutOwner({
        activeOwnerCount: 2,
        targetIsCurrentlyActiveOwner: true,
        nextRole: 'MANAGER',
        nextStatus: 'ACTIVE',
      }),
    ).toBe(false);

    expect(
      wouldLeaveSalonWithoutOwner({
        activeOwnerCount: 1,
        targetIsCurrentlyActiveOwner: false,
        nextRole: 'STAFF',
        nextStatus: 'DISABLED',
      }),
    ).toBe(false);
  });
});
