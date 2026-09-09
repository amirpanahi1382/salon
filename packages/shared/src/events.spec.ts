import { DOMAIN_EVENT_TYPES, isDomainEventType } from './events';

describe('isDomainEventType', () => {
  it('accepts known domain events', () => {
    expect(isDomainEventType(DOMAIN_EVENT_TYPES.ActionCreated)).toBe(true);
    expect(isDomainEventType(DOMAIN_EVENT_TYPES.VisitCompleted)).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isDomainEventType('TotallyUnknownEvent')).toBe(false);
    expect(isDomainEventType('')).toBe(false);
  });
});
