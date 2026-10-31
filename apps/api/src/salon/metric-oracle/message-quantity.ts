/**
 * Independent definitions for the existing «نتایج ارسال پیام» row.
 * These functions do not read the database and do not call production SQL.
 *
 * Approved meaning: each ordinary or VIP row is recorded sends out of the
 * number of messages the salon requested. The denominator is a message
 * quantity. It is not a count of VIP lists or VIP request batches, and it
 * must already be visible before an admin dispatch inserts MessageRequest rows.
 */

export const SUBMITTED_VIP_REQUEST_STATUSES = [
  'SUBMITTED',
  'MANUAL_QUEUED',
  'BALE_NOT_IMPLEMENTED',
] as const;

export type VipRequestStatusName =
  | 'AWAITING_SAMPLE_WORK'
  | (typeof SUBMITTED_VIP_REQUEST_STATUSES)[number]
  | 'CANCELLED';

export type VipRequestQuantityFact = {
  status: VipRequestStatusName;
  /** Quantity the salon selected, equal to the snapshotted recipient rows at create. */
  requestedCount: number;
};

export type OrdinaryRequestStatusName =
  | 'QUEUED'
  | 'DISPATCHED'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

export type OrdinaryRequestFact = {
  status: OrdinaryRequestStatusName;
};

export type RecordedSendFact = {
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  submittedAt: Date | null;
  /** Retries reuse this same row. The count is always one row, not `attempts`. */
  attempts: number;
};

/**
 * VIP messages requested after the salon submits the request («ثبت درخواست»).
 * Includes submitted, manually queued, and Bale-not-implemented requests even
 * when no recipient MessageRequest exists. Excludes an open sample draft and
 * a draft that expired before submit. Stopped recipients stay inside
 * `requestedCount`: the salon still requested those messages.
 */
export function vipRequestedMessageQuantity(
  requests: readonly VipRequestQuantityFact[],
): number {
  return requests.reduce((sum, request) => {
    if (!(SUBMITTED_VIP_REQUEST_STATUSES as readonly string[]).includes(request.status)) {
      return sum;
    }
    return sum + request.requestedCount;
  }, 0);
}

/**
 * Open choice, not the proposed calculator. Adds unsubmitted sample drafts.
 * Expired drafts stay out, because those rows were cancelled before submit.
 */
export function vipRequestedMessageQuantityIncludingOpenDrafts(
  requests: readonly VipRequestQuantityFact[],
): number {
  return requests.reduce((sum, request) => {
    if (request.status === 'CANCELLED') {
      return sum;
    }
    return sum + request.requestedCount;
  }, 0);
}

/** Every ordinary MessageRequest the salon created, including a later cancellation. */
export function ordinaryRequestedMessageQuantityIncludingCancelled(
  requests: readonly OrdinaryRequestFact[],
): number {
  return requests.length;
}

/** Open choice: a cancelled ordinary request is no longer in the denominator. */
export function ordinaryRequestedMessageQuantityExcludingCancelled(
  requests: readonly OrdinaryRequestFact[],
): number {
  return requests.filter((request) => request.status !== 'CANCELLED').length;
}

/**
 * Recorded send for the existing «ارسال‌شده» tag.
 * One delivery row that is SENT and has submittedAt. Attempts do not add sends.
 */
export function recordedSendCount(deliveries: readonly RecordedSendFact[]): number {
  return deliveries.filter(
    (delivery) => delivery.status === 'SENT' && delivery.submittedAt !== null,
  ).length;
}
