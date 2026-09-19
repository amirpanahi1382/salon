export type ReturnCommitmentWriteActor =
  | { kind: 'SALON_USER'; userId: string }
  | { kind: 'PLATFORM_ADMIN'; adminId: string };

export function returnCommitmentActorColumns(actor: ReturnCommitmentWriteActor): {
  createdByUserId: string | null;
  createdByPlatformAdminId: string | null;
  auditActorId: string;
} {
  if (actor.kind === 'SALON_USER') {
    return {
      createdByUserId: actor.userId,
      createdByPlatformAdminId: null,
      auditActorId: actor.userId,
    };
  }
  return {
    createdByUserId: null,
    createdByPlatformAdminId: actor.adminId,
    auditActorId: actor.adminId,
  };
}

export function isRecordedBySupport(row: {
  createdByPlatformAdminId: string | null;
}): boolean {
  return row.createdByPlatformAdminId != null;
}
