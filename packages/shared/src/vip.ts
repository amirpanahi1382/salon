export const VIP_ALLOWED_REQUEST_COUNTS = [30, 50, 100] as const;
export type VipAllowedRequestCount = (typeof VIP_ALLOWED_REQUEST_COUNTS)[number];

export const VIP_LIST_MAX_CONTACTS = 100;
export const VIP_QUOTA_MAX = 100;
export const VIP_QUOTA_WINDOW_DAYS = 14;
export const VIP_RESERVATION_TTL_MS = 30 * 60 * 1000;
export const VIP_MAX_SAMPLE_WORKS = 3;
export const VIP_MIN_SAMPLE_WORKS = 1;
export const VIP_GEO_RANGE_MAX_LENGTH = 80;
export const VIP_LIST_NAME_MAX_LENGTH = 80;
export const VIP_DISPLAY_NAME_MAX_LENGTH = 160;

export const VIP_TARGET_LIST_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE', 'IN_USE'] as const;
export type VipTargetListStatus = (typeof VIP_TARGET_LIST_STATUSES)[number];

export const VIP_REQUEST_STATUSES = [
  'AWAITING_SAMPLE_WORK',
  'SUBMITTED',
  'MANUAL_QUEUED',
  'BALE_NOT_IMPLEMENTED',
  'CANCELLED',
] as const;
export type VipRequestStatus = (typeof VIP_REQUEST_STATUSES)[number];

/** Queue Bale/Safir is not implemented for VIP MessageRequests. */
export const VIP_BALE_NOT_AVAILABLE_MESSAGE = 'Bale is not available for VIP outreach';
export const VIP_RESERVATION_EXPIRED_MESSAGE = 'This VIP request reservation has expired';

export function isVipAllowedRequestCount(value: number): value is VipAllowedRequestCount {
  return (VIP_ALLOWED_REQUEST_COUNTS as readonly number[]).includes(value);
}

export function renderVipMessageTemplate(customerName: string, geographicRange: string): string {
  return `${customerName} عزیز، نمونه کارها خدمتتون ارسال شده. ما در محدوده ${geographicRange} تا حالا سعادت حضور شما را نداشتیم و برای رزرو با من تماس بگیرید.`;
}
