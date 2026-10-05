import {
  deriveMessageExecutionState,
  messageAdminCapabilities,
  type MessageExecutionState,
} from './messaging.js';

export const VIP_ALLOWED_REQUEST_COUNTS = [30, 50, 100] as const;
export type VipAllowedRequestCount = (typeof VIP_ALLOWED_REQUEST_COUNTS)[number];

/** Canonical Tehran VIP inventory regions. Code is identity; name is display metadata. */
export const VIP_REGION_CODES = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
] as const;
export type VipRegionCode = (typeof VIP_REGION_CODES)[number];

export const VIP_REGION_CATALOG: Record<VipRegionCode, string> = {
  '01': 'مرکز؛ حسن‌آباد، بازار و انقلاب',
  '02': 'شمال؛ ونک، تجریش و پاسداران',
  '03': 'شمال‌غرب؛ سعادت‌آباد، پونک و جنت‌آباد',
  '04': 'غرب؛ صادقیه، آزادی و چیتگر',
  '05': 'جنوب‌غرب؛ شادآباد، یافت‌آباد و نواب',
  '06': 'جنوب؛ نازی‌آباد، شهرری و کهریزک',
  '07': 'شرق؛ نارمک، تهرانپارس و شمیران‌نو',
  '08': 'جنوب‌شرق؛ پیروزی، افسریه و خاوران',
  '09': 'حومه غرب؛ شهریار، قدس و کرج',
  '10': 'حومه جنوب‌غرب؛ اسلامشهر، رباط‌کریم و پرند',
  '11': 'حومه جنوب؛ حسن‌آباد فشافویه و شمس‌آباد',
  '12': 'حومه جنوب‌شرق؛ پاکدشت، قرچک و ورامین',
  '13': 'حومه شمال‌شرق؛ جاجرود، پردیس و دماوند',
  '14': 'حومه شمال؛ لواسان، فشم و میگون',
};

export const VIP_REGIONS = VIP_REGION_CODES.map((code) => ({
  code,
  name: VIP_REGION_CATALOG[code],
}));

export function isVipRegionCode(value: string): value is VipRegionCode {
  return (VIP_REGION_CODES as readonly string[]).includes(value);
}

export function vipRegionName(code: VipRegionCode): string {
  return VIP_REGION_CATALOG[code];
}

export const VIP_LIST_MAX_CONTACTS = 100;
/** Temporary product limit for easier testing. Rolling window, not a calendar week. */
export const VIP_QUOTA_MAX = 500;
export const VIP_QUOTA_WINDOW_DAYS = 7;
export const VIP_QUOTA_EXCEEDED_MESSAGE = 'VIP rolling-window quota would be exceeded';
export const VIP_RESERVATION_TTL_MS = 30 * 60 * 1000;
export const VIP_MAX_SAMPLE_WORKS = 3;
export const VIP_MIN_SAMPLE_WORKS = 1;
export const VIP_GEO_RANGE_MAX_LENGTH = 80;
export const VIP_LIST_NAME_MAX_LENGTH = 80;
export const VIP_DISPLAY_NAME_MAX_LENGTH = 160;

export const VIP_TARGET_LIST_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE', 'IN_USE'] as const;
export type VipTargetListStatus = (typeof VIP_TARGET_LIST_STATUSES)[number];

/** Reviewed catalog collection. Null on a list means it is not a member. */
export const VIP_CATALOG_MEMBERSHIPS = ['ORIGINAL_TEHRAN'] as const;
export type VipCatalogMembership = (typeof VIP_CATALOG_MEMBERSHIPS)[number];

export const VIP_REQUEST_STATUSES = [
  'AWAITING_SAMPLE_WORK',
  'SUBMITTED',
  'MANUAL_QUEUED',
  'BALE_NOT_IMPLEMENTED',
  'CANCELLED',
] as const;
export type VipRequestStatus = (typeof VIP_REQUEST_STATUSES)[number];

/**
 * Derived VIP recipient execution state for admin outreach.
 * SENT matches Opportunities V2: MessageDelivery SENT with submittedAt.
 * NOT_YET_QUEUED is pre-dispatch (no MessageRequest yet).
 * CANCELLED is durable queue removal of a MessageRequest, not recipient deletion.
 */
export const VIP_OUTREACH_EXECUTION_STATES = [
  'NOT_YET_QUEUED',
  'QUEUED',
  'IN_PIPELINE',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const;
export type VipOutreachExecutionState = (typeof VIP_OUTREACH_EXECUTION_STATES)[number];

export function deriveVipOutreachExecutionState(input: {
  messageRequestStatus: string | null | undefined;
  deliveryStatus: string | null | undefined;
  submittedAt: Date | string | null | undefined;
}): VipOutreachExecutionState {
  return deriveMessageExecutionState(input) as VipOutreachExecutionState;
}

export function vipRecipientAdminCapabilities(input: {
  messageRequestStatus: string | null | undefined;
  deliveryStatus: string | null | undefined;
  deliveryMode: string | null | undefined;
  submittedAt: Date | string | null | undefined;
}): {
  executionState: MessageExecutionState;
  canCancel: boolean;
  canMarkManualSent: boolean;
} {
  return messageAdminCapabilities(input);
}

/**
 * Display-only title. Identity remains VipRequest.id.
 * Ordinal is 1-based among that salon's requests ordered by createdAt, id ascending,
 * so later requests do not renumber history.
 */
export function vipOutreachRequestDisplayTitle(input: {
  salonName: string;
  regionCode: string | null | undefined;
  recipientCount: number;
  requestOrdinal: number;
}): string {
  const salonName = input.salonName.trim() || 'سالن';
  const region = input.regionCode?.trim();
  if (region) {
    return `${salonName} — منطقه ${region} — ${input.recipientCount} مخاطب`;
  }
  return `${salonName} — درخواست VIP شماره ${input.requestOrdinal} — ${input.recipientCount} مخاطب`;
}

/** Queue Bale/Safir is not implemented for VIP MessageRequests. */
export const VIP_BALE_NOT_AVAILABLE_MESSAGE = 'Bale is not available for VIP outreach';
export const VIP_RESERVATION_EXPIRED_MESSAGE = 'This VIP request reservation has expired';

export function isVipAllowedRequestCount(value: number): value is VipAllowedRequestCount {
  return (VIP_ALLOWED_REQUEST_COUNTS as readonly number[]).includes(value);
}

export function renderVipMessageTemplate(
  customerName: string | null | undefined,
  geographicRange: string,
): string {
  const body = `نمونه کارها خدمتتون ارسال شده. ما در محدوده ${geographicRange} تا حالا سعادت حضور شما را نداشتیم و برای رزرو با من تماس بگیرید.`;
  const name = typeof customerName === 'string' ? customerName.trim() : '';
  if (!name) {
    return body;
  }
  return `${name} عزیز، ${body}`;
}
