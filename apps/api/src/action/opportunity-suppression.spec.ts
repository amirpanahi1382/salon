import { suppressedOpportunityKey } from './opportunity-suppression';

describe('suppressedOpportunityKey', () => {
  it('joins customer and opportunity type', () => {
    expect(suppressedOpportunityKey('c1', 'REACTIVATION')).toBe('c1:REACTIVATION');
  });
});
