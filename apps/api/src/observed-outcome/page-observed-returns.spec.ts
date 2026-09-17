import {
  associateObservedReturns,
  type CandidateVisit,
  type EligibleMessageIntervention,
} from '@salon/shared';
import { OBSERVED_RETURN_LIST_LIMIT, pageObservedReturns } from './page-observed-returns';

function visit(id: string, iso: string): CandidateVisit {
  const at = new Date(iso);
  return { id, visitedAt: at, createdAt: at };
}

function intervention(deliveryId: string, iso: string): EligibleMessageIntervention {
  const at = new Date(iso);
  return {
    deliveryId,
    requestId: `req-${deliveryId}`,
    submittedAt: at,
    createdAt: at,
    requestedAt: at,
    origin: 'MANUAL',
    opportunityType: null,
    actionId: null,
    sourceVisitId: null,
  };
}

describe('pageObservedReturns', () => {
  const newestFirst = associateObservedReturns(
    [
      visit('v1', '2026-09-03T10:00:00.000Z'),
      visit('v2', '2026-09-08T10:00:00.000Z'),
      visit('v3', '2026-09-12T10:00:00.000Z'),
    ],
    [
      intervention('A', '2026-09-01T10:00:00.000Z'),
      intervention('B', '2026-09-05T10:00:00.000Z'),
      intervention('C', '2026-09-10T10:00:00.000Z'),
    ],
  ).sort((a, b) => (a.returnVisit.visitedAt < b.returnVisit.visitedAt ? 1 : -1));

  it('pages newest-return-first without skip or duplicate', () => {
    expect(newestFirst.map((row) => row.returnVisit.id)).toEqual(['v3', 'v2', 'v1']);
    const window = pageObservedReturns(newestFirst, undefined, 2);
    expect(window.map((row) => row.returnVisit.id)).toEqual(['v3', 'v2', 'v1']);
    const page1 = window.slice(0, 2);
    const page2 = pageObservedReturns(newestFirst, page1[1]!.returnVisit, 2);
    expect(page2.map((row) => row.returnVisit.id)).toEqual(['v1']);
    const combined = [...page1, ...page2];
    expect(combined.map((row) => row.returnVisit.id)).toEqual(['v3', 'v2', 'v1']);
    expect(new Set(combined.map((row) => row.returnVisit.id)).size).toBe(3);
  });

  it('keeps the production page size bounded', () => {
    expect(OBSERVED_RETURN_LIST_LIMIT).toBe(50);
  });
});
