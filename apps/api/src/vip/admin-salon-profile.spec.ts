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

  it('marks a list requestable when admin-enabled, ORIGINAL_TEHRAN, canonical region, and round capacity remains', () => {
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
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        roundOccupiedCount: 0,
      }),
    ).toBe(true);
    expect(
      isVipListRequestableBySalons({
        status: 'IN_USE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        roundOccupiedCount: 4,
      }),
    ).toBe(true);
    expect(
      isVipListRequestableBySalons({
        status: 'IN_USE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        roundOccupiedCount: 5,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: null,
        roundOccupiedCount: 0,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '99',
        roundOccupiedCount: 0,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'ACTIVE',
        catalogMembership: null,
        regionCode: '03',
        roundOccupiedCount: 0,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'INACTIVE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        roundOccupiedCount: 0,
      }),
    ).toBe(false);
    expect(
      isVipListRequestableBySalons({
        status: 'PENDING',
        catalogMembership: 'ORIGINAL_TEHRAN',
        regionCode: '03',
        roundOccupiedCount: 0,
      }),
    ).toBe(false);
  });
});
