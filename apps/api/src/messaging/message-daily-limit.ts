import { Prisma } from '@salon/database';
import { MessageDailyLimitError } from '@salon/shared';

export function isMessageDailyLimitPrismaError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target) && target.some((part) => String(part).includes('messageBusinessDate') || String(part).includes('message_business_date'))) {
    return true;
  }
  const constraint = error.meta?.constraint;
  if (typeof constraint === 'string' && constraint.includes('message_requests_salon_customer_day')) {
    return true;
  }
  if (typeof target === 'string' && target.includes('message_requests_salon_customer_day')) {
    return true;
  }
  return false;
}

export function throwIfDailyLimit(error: unknown): void {
  if (isMessageDailyLimitPrismaError(error)) {
    throw new MessageDailyLimitError();
  }
}
