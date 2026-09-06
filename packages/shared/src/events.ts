export const DOMAIN_EVENT_TYPES = {
  SalonCreated: 'SalonCreated',
  SalonUpdated: 'SalonUpdated',
  UserCreated: 'UserCreated',
  UserRoleChanged: 'UserRoleChanged',
  UserStatusChanged: 'UserStatusChanged',
  CustomerCreated: 'CustomerCreated',
  CustomerDeleted: 'CustomerDeleted',
  VisitCompleted: 'VisitCompleted',
  VisitDeleted: 'VisitDeleted',
  ServiceCreated: 'ServiceCreated',
  ServiceUpdated: 'ServiceUpdated',
  TransactionCreated: 'TransactionCreated',
  TransactionVoided: 'TransactionVoided',
} as const;

export type DomainEventType =
  (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];

const KNOWN_EVENT_TYPES = new Set<string>(Object.values(DOMAIN_EVENT_TYPES));

export function isDomainEventType(value: string): value is DomainEventType {
  return KNOWN_EVENT_TYPES.has(value);
}
