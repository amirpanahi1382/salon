export { Prisma, PrismaClient } from '@prisma/client';
export type {
  AuditLog,
  Customer,
  OutboxEvent,
  Salon,
  User,
} from '@prisma/client';
export { createPrismaClient } from './client.js';
export {
  claimOutboxEvents,
  markOutboxDeadLetter,
  markOutboxProcessed,
  markOutboxRetry,
} from './outbox.js';
