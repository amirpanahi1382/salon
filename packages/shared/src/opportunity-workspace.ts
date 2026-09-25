import type { ReturnEvidenceKind } from './observed-outcome.js';

export const OPPORTUNITY_WORKSPACE_FILTERS = [
  'ALL',
  'SALON_MESSAGES',
  'VIP',
  'REVENUE_DROP',
] as const;
export type OpportunityWorkspaceFilter = (typeof OPPORTUNITY_WORKSPACE_FILTERS)[number];

export const OPPORTUNITY_WORKSPACE_ROW_KINDS = ['SALON_CUSTOMER', 'VIP_RECIPIENT'] as const;
export type OpportunityWorkspaceRowKind = (typeof OPPORTUNITY_WORKSPACE_ROW_KINDS)[number];

/**
 * Factual association states for a single reference MessageRequest episode.
 * SENT_WITH_* means a ReturnCommitment / return evidence row is linked to that
 * request. Not a causal claim that the message caused the return.
 */
export const OPPORTUNITY_WORKSPACE_MESSAGE_STATES = [
  'QUEUED',
  'IN_PIPELINE',
  'SENT',
  'SENT_WITH_RETURN_COMMITMENT',
  'SENT_WITH_RETURN_EVIDENCE',
  'FAILED',
  'CANCELLED',
] as const;
export type OpportunityWorkspaceMessageState =
  (typeof OPPORTUNITY_WORKSPACE_MESSAGE_STATES)[number];

export function salonCustomerWorkspaceId(customerId: string): string {
  return `SALON_CUSTOMER:${customerId}`;
}

export function vipRecipientWorkspaceId(messageRequestId: string): string {
  return `VIP_RECIPIENT:${messageRequestId}`;
}

export function isCanonicalMessageSent(
  deliveryStatus: string | null | undefined,
  submittedAt: Date | string | null | undefined,
): boolean {
  return deliveryStatus === 'SENT' && submittedAt != null && `${submittedAt}` !== '';
}

export function deriveOpportunityWorkspaceMessageState(input: {
  requestStatus: string;
  deliveryStatus: string | null | undefined;
  submittedAt: Date | string | null | undefined;
  hasReturnCommitment: boolean;
  returnEvidenceKind: ReturnEvidenceKind | null | undefined;
}): OpportunityWorkspaceMessageState {
  if (isCanonicalMessageSent(input.deliveryStatus, input.submittedAt)) {
    if (input.returnEvidenceKind) {
      return 'SENT_WITH_RETURN_EVIDENCE';
    }
    if (input.hasReturnCommitment) {
      return 'SENT_WITH_RETURN_COMMITMENT';
    }
    return 'SENT';
  }
  if (input.requestStatus === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (input.requestStatus === 'FAILED' || input.deliveryStatus === 'FAILED') {
    return 'FAILED';
  }
  if (
    input.requestStatus === 'DISPATCHED' ||
    input.deliveryStatus === 'PENDING' ||
    input.deliveryStatus === 'PROCESSING'
  ) {
    return 'IN_PIPELINE';
  }
  return 'QUEUED';
}
