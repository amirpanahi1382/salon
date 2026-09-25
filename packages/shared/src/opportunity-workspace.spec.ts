import { messageAdminCapabilities } from './messaging';
import {
  deriveOpportunityWorkspaceMessageState,
  isCanonicalMessageSent,
  salonCustomerWorkspaceId,
  vipRecipientWorkspaceId,
} from './opportunity-workspace';

describe('opportunity workspace message state', () => {
  it('does not treat a MessageRequest alone as SENT', () => {
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'QUEUED',
        deliveryStatus: null,
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('QUEUED');
    expect(isCanonicalMessageSent(null, null)).toBe(false);
  });

  it('requires delivery SENT and submittedAt for canonical SENT', () => {
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('QUEUED');
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: new Date('2026-09-20T10:00:00.000Z'),
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('SENT');
  });

  it('keeps pipeline distinct from queued and does not call FAILED queued', () => {
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'DISPATCHED',
        deliveryStatus: 'PENDING',
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('IN_PIPELINE');
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'DISPATCHED',
        deliveryStatus: 'PROCESSING',
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('IN_PIPELINE');
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'FAILED',
        deliveryStatus: 'FAILED',
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('FAILED');
  });

  it('uses reference-message commitment and evidence without inventing causality', () => {
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: new Date('2026-09-20T10:00:00.000Z'),
        hasReturnCommitment: true,
        returnEvidenceKind: null,
      }),
    ).toBe('SENT_WITH_RETURN_COMMITMENT');
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: new Date('2026-09-20T10:00:00.000Z'),
        hasReturnCommitment: true,
        returnEvidenceKind: 'OBSERVED',
      }),
    ).toBe('SENT_WITH_RETURN_EVIDENCE');
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: new Date('2026-09-20T10:00:00.000Z'),
        hasReturnCommitment: true,
        returnEvidenceKind: 'COMMITMENT_BACKED',
      }),
    ).toBe('SENT_WITH_RETURN_EVIDENCE');
  });

  it('shows cancelled unsent messages as CANCELLED, not queued or sent', () => {
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'CANCELLED',
        deliveryStatus: null,
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('CANCELLED');
    expect(
      deriveOpportunityWorkspaceMessageState({
        requestStatus: 'CANCELLED',
        deliveryStatus: 'PENDING',
        submittedAt: null,
        hasReturnCommitment: false,
        returnEvidenceKind: null,
      }),
    ).toBe('CANCELLED');
    expect(
      messageAdminCapabilities({
        messageRequestStatus: 'CANCELLED',
        deliveryStatus: 'PENDING',
        deliveryMode: 'MANUAL',
        submittedAt: null,
      }).canCancel,
    ).toBe(false);
  });

  it('keeps ordinary and VIP row identities in separate namespaces', () => {
    const customerId = '11111111-1111-1111-1111-111111111111';
    const requestId = '22222222-2222-2222-2222-222222222222';
    expect(salonCustomerWorkspaceId(customerId)).toBe(`SALON_CUSTOMER:${customerId}`);
    expect(vipRecipientWorkspaceId(requestId)).toBe(`VIP_RECIPIENT:${requestId}`);
    expect(salonCustomerWorkspaceId(customerId)).not.toBe(vipRecipientWorkspaceId(customerId));
  });
});
