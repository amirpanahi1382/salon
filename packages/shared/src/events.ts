export const DOMAIN_EVENT_TYPES = {
  SalonCreated: 'SalonCreated',
  SalonUpdated: 'SalonUpdated',
  UserCreated: 'UserCreated',
  UserRoleChanged: 'UserRoleChanged',
  UserStatusChanged: 'UserStatusChanged',
} as const;

export type DomainEventType =
  (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];
