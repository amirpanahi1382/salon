import {
  deriveOpportunityWorkspaceMessageState,
  salonCustomerWorkspaceId,
  vipRecipientWorkspaceId,
  type OpportunityWorkspaceMessageState,
  type OpportunityWorkspaceRowKind,
  type ReturnEvidenceKind,
} from '@salon/shared';
import type { OpportunityWorkspaceRowDto } from './opportunities.dto';
import type { OpportunityWorkspaceSqlRow } from './opportunities-workspace.repository';

export function toOpportunityWorkspaceRow(row: OpportunityWorkspaceSqlRow): OpportunityWorkspaceRowDto {
  const rowKind = row.rowKind as OpportunityWorkspaceRowKind;
  const stableId =
    rowKind === 'VIP_RECIPIENT'
      ? vipRecipientWorkspaceId(row.messageRequestId ?? row.stableSubject)
      : salonCustomerWorkspaceId(row.customerId ?? row.stableSubject);

  let messageState: OpportunityWorkspaceMessageState | null = null;
  if (row.messageRequestId) {
    messageState = deriveOpportunityWorkspaceMessageState({
      requestStatus: row.requestStatus ?? 'QUEUED',
      deliveryStatus: row.deliveryStatus,
      submittedAt: row.submittedAt,
      hasReturnCommitment: row.hasReturnCommitment,
      returnEvidenceKind: (row.returnEvidenceKind as ReturnEvidenceKind | null) ?? null,
    });
  }

  return {
    rowKind,
    stableId,
    customerId: row.customerId,
    displayName: row.displayName,
    phoneNumber: row.phoneNumber,
    messageState,
    messageRequestId: row.messageRequestId,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    commitmentExpectedAt: row.commitmentExpectedAt?.toISOString() ?? null,
    returnEvidenceKind: (row.returnEvidenceKind as ReturnEvidenceKind | null) ?? null,
    previousVisitAt: row.previousVisitAt?.toISOString() ?? null,
  };
}
