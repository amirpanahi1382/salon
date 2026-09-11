import {
  isVipAllowedRequestCount,
  renderVipMessageTemplate,
  VIP_BALE_NOT_AVAILABLE_MESSAGE,
  VIP_RESERVATION_EXPIRED_MESSAGE,
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

  it('exposes stable VIP Bale and reservation error contracts', () => {
    expect(VIP_BALE_NOT_AVAILABLE_MESSAGE).toBe('Bale is not available for VIP outreach');
    expect(VIP_RESERVATION_EXPIRED_MESSAGE).toBe('This VIP request reservation has expired');
  });
});
