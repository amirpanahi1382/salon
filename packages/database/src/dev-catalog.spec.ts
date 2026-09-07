import { STARTER_SERVICE_CATALOG, isAutomatedTestOwnerEmail } from './dev-catalog';

describe('starter service catalog', () => {
  it('names Hair Service and Nail Service as ordinary starter rows', () => {
    expect([...STARTER_SERVICE_CATALOG]).toEqual(['Hair Service', 'Nail Service']);
  });

  it('skips automated @example.test owners', () => {
    expect(isAutomatedTestOwnerEmail('owner-1@example.test')).toBe(true);
    expect(isAutomatedTestOwnerEmail('mahsapanah@gmail.com')).toBe(false);
  });
});
