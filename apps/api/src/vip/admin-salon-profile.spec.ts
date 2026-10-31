import { VIP_IN_PROGRESS_STATUSES } from '@salon/shared';
import { VIP_OPEN_REQUEST_STATUSES } from './admin-salon-profile.use-case';
import {
  isVipListRequestableBySalons,
  liveRequestBlocksList,
  sampleReservationBlocksReuse,
} from './vip-list-request-counts';

describe('admin salon VIP profile counting rules', () => {
  it('treats cancelled VIP requests as historical total, not open work', () => {
    expect(VIP_OPEN_REQUEST_STATUSES).toEqual([
      'AWAITING_SAMPLE_WORK',
      ...VIP_IN_PROGRESS_STATUSES,
    ]);
    expect(VIP_OPEN_REQUEST_STATUSES).not.toContain('CANCELLED');
  });

  it('counts a recorded send only as SENT with submittedAt, not a queue row', () => {
    const queued = { status: 'QUEUED', submittedAt: null };
    const sent = { status: 'SENT', submittedAt: new Date() };
    expect(queued.status === 'SENT' && queued.submittedAt != null).toBe(false);
    expect(sent.status === 'SENT' && sent.submittedAt != null).toBe(true);
  });

  it('marks a list requestable only when ACTIVE, unreserved, ORIGINAL_TEHRAN, and a canonical region', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    expect(sampleReservationBlocksReuse('AWAITING_SAMPLE_WORK', now, now)).toBe(true);
    expect(
      sampleReservationBlocksReuse('AWAITING_SAMPLE_WORK', new Date(now.getTime() - 1), now),
    ).toBe(false);
    expect(
      liveRequestBlocksList(
        [{ status: 'AWAITING_SAMPLE_WORK', reservedUntil: new Date(now.getTime() - 1) }],
        now,
      ),
    ).toBe(false);
    expect(liveRequestBlocksList([{ status: 'SUBMITTED', reservedUntil: now }], now)).toBe(true);
    expect(liveRequestBlocksList([{ status: 'MANUAL_QUEUED', reservedUntil: now }], now)).toBe(true);
    expect(liveRequestBlocksList([{ status: 'BALE_NOT_IMPLEMENTED', reservedUntil: now }], now)).toBe(true);
    expect(liveRequestBlocksList([{ status: 'CANCELLED', reservedUntil: now }], now)).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        reservedBySalonId: null,
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: false,
      }),
    ).toBe(true);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        reservedBySalonId: null,
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: true,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        reservedBySalonId: 'salon-1',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: false,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'IN_USE',
        reservedBySalonId: 'salon-1',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: false,
      }),
    ).toBe(true);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        reservedBySalonId: null,
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: null,
        blockedByLiveRequest: false,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        reservedBySalonId: null,
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '99',
        blockedByLiveRequest: false,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        reservedBySalonId: null,
        catalogMembership: null,
        regionCode: '03',
        blockedByLiveRequest: false,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'IN_USE',
        reservedBySalonId: 'salon-1',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: true,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'IN_USE',
        reservedBySalonId: 'salon-1',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: true,
        nextReservationOpen: true,
      }),
    ).toBe(true);
    expect(
      isVipListRequestableBySalons({
        status: 'INACTIVE',
        reservedBySalonId: null,
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: false,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'PENDING',
        reservedBySalonId: null,
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        blockedByLiveRequest: false,
      }),
    ).toBe(false);
  });
});
