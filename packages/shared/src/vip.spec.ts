import {
  deriveVipOutreachExecutionState,
  isVipAllowedRequestCount,
  isVipRegionCode,
  renderVipMessageTemplate,
  VIP_BALE_NOT_AVAILABLE_MESSAGE,
  VIP_OUTREACH_EXECUTION_STATES,
  VIP_QUOTA_EXCEEDED_MESSAGE,
  VIP_QUOTA_MAX,
  VIP_QUOTA_WINDOW_DAYS,
  VIP_REGION_CATALOG,
  VIP_REGION_CODES,
  VIP_REGIONS,
  VIP_RESERVATION_EXPIRED_MESSAGE,
  vipOutreachRequestDisplayTitle,
  vipRecipientAdminCapabilities,
  vipRegionName,
} from './vip';

describe('VIP shared rules', () => {
  it('allows only 30, 50, and 100', () => {
    expect(isVipAllowedRequestCount(30)).toBe(true);
    expect(isVipAllowedRequestCount(50)).toBe(true);
    expect(isVipAllowedRequestCount(100)).toBe(true);
    expect(isVipAllowedRequestCount(101)).toBe(false);
    expect(isVipAllowedRequestCount(0)).toBe(false);
  });

  it('renders a deterministic Persian template', () => {
    expect(renderVipMessageTemplate('مریم', 'ونک')).toBe(
      'مریم عزیز، نمونه کارها خدمتتون ارسال شده. ما در محدوده ونک تا حالا سعادت حضور شما را نداشتیم و برای رزرو با من تماس بگیرید.',
    );
  });

  it('omits the vocative when the VIP target has no name', () => {
    expect(renderVipMessageTemplate(null, 'ونک')).toBe(
      'نمونه کارها خدمتتون ارسال شده. ما در محدوده ونک تا حالا سعادت حضور شما را نداشتیم و برای رزرو با من تماس بگیرید.',
    );
    expect(renderVipMessageTemplate('  ', 'ونک')).toBe(
      'نمونه کارها خدمتتون ارسال شده. ما در محدوده ونک تا حالا سعادت حضور شما را نداشتیم و برای رزرو با من تماس بگیرید.',
    );
  });

  it('exposes stable VIP Bale and reservation error contracts', () => {
    expect(VIP_BALE_NOT_AVAILABLE_MESSAGE).toBe('Bale is not available for VIP outreach');
    expect(VIP_RESERVATION_EXPIRED_MESSAGE).toBe('This VIP request reservation has expired');
  });

  it('exposes the canonical 14-region catalog in code order', () => {
    expect(VIP_REGION_CODES).toEqual([
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
    ]);
    expect(VIP_REGIONS).toHaveLength(14);
    expect(VIP_REGIONS.map((row) => row.code)).toEqual([...VIP_REGION_CODES]);
    expect(isVipRegionCode('01')).toBe(true);
    expect(isVipRegionCode('15')).toBe(false);
    expect(isVipRegionCode('1')).toBe(false);
    expect(vipRegionName('01')).toBe(VIP_REGION_CATALOG['01']);
    expect(VIP_REGION_CATALOG['11']).toBe('حومه جنوب؛ حسن‌آباد فشافویه و شمس‌آباد');
    expect(VIP_REGION_CATALOG['14']).toBe('حومه شمال؛ لواسان، فشم و میگون');
  });

  it('derives admin VIP execution from MessageRequest/Delivery, not from request existence', () => {
    expect(VIP_QUOTA_MAX).toBe(500);
    expect(VIP_QUOTA_WINDOW_DAYS).toBe(7);
    expect(VIP_QUOTA_EXCEEDED_MESSAGE).toBe('VIP rolling-window quota would be exceeded');
    expect(VIP_OUTREACH_EXECUTION_STATES).toEqual([
      'NOT_YET_QUEUED',
      'QUEUED',
      'IN_PIPELINE',
      'SENT',
      'FAILED',
      'CANCELLED',
    ]);
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: null,
        deliveryStatus: null,
        submittedAt: null,
      }),
    ).toBe('NOT_YET_QUEUED');
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: 'QUEUED',
        deliveryStatus: null,
        submittedAt: null,
      }),
    ).toBe('QUEUED');
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: 'DISPATCHED',
        deliveryStatus: 'PENDING',
        submittedAt: null,
      }),
    ).toBe('IN_PIPELINE');
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: '2026-09-22T10:00:00.000Z',
      }),
    ).toBe('SENT');
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: 'SENT',
        deliveryStatus: 'SENT',
        submittedAt: null,
      }),
    ).toBe('QUEUED');
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: 'FAILED',
        deliveryStatus: 'FAILED',
        submittedAt: null,
      }),
    ).toBe('FAILED');
    expect(
      deriveVipOutreachExecutionState({
        messageRequestStatus: 'CANCELLED',
        deliveryStatus: 'PENDING',
        submittedAt: null,
      }),
    ).toBe('CANCELLED');
    expect(
      vipRecipientAdminCapabilities({
        messageRequestStatus: 'QUEUED',
        deliveryStatus: null,
        deliveryMode: null,
        submittedAt: null,
      }).canMarkManualSent,
    ).toBe(true);
    expect(
      vipRecipientAdminCapabilities({
        messageRequestStatus: null,
        deliveryStatus: null,
        deliveryMode: null,
        submittedAt: null,
      }).canMarkManualSent,
    ).toBe(false);
  });

  it('derives a stable VIP request display title without using the UUID', () => {
    expect(
      vipOutreachRequestDisplayTitle({
        salonName: 'سالن زیبایی گل',
        regionCode: '03',
        recipientCount: 100,
        requestOrdinal: 2,
      }),
    ).toBe('سالن زیبایی گل — منطقه 03 — 100 مخاطب');
    expect(
      vipOutreachRequestDisplayTitle({
        salonName: 'سالن زیبایی گل',
        regionCode: null,
        recipientCount: 30,
        requestOrdinal: 3,
      }),
    ).toBe('سالن زیبایی گل — درخواست VIP شماره 3 — 30 مخاطب');
  });
});
