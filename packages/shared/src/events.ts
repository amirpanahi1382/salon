export const DOMAIN_EVENT_TYPES = {
  SalonCreated: 'SalonCreated',
  SalonUpdated: 'SalonUpdated',
  UserCreated: 'UserCreated',
  UserRoleChanged: 'UserRoleChanged',
  UserStatusChanged: 'UserStatusChanged',
  CustomerCreated: 'CustomerCreated',
} as const;

export type DomainEventType =
  (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];
