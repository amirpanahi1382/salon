import { createHash } from 'node:crypto';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  CUSTOMER_PHONE_RULE_MESSAGE,
  CustomerPhoneExistsError,
  DOMAIN_EVENT_TYPES,
  isUsableCustomerPhone,
  normalizeCustomerPhone,
  sanitizeCustomerNamePart,
  ValidationError,
} from '@salon/shared';

export type CustomerIdentity = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
};

/** Same name and phone rules as an ordinary Customer create. */
export function requireCustomerIdentity(input: {
  firstName: string;
  lastName?: string | null;
  phoneNumber: string;
}): CustomerIdentity {
  const firstName = sanitizeCustomerNamePart(input.firstName);
  const lastName = sanitizeCustomerNamePart(input.lastName ?? '');
  const phoneNumber = normalizeCustomerPhone(input.phoneNumber);
  if (!firstName) {
    throw new ValidationError('Customer first name is required');
  }
  if (lastName === null) {
    throw new ValidationError('Customer last name is invalid');
  }
  if (!isUsableCustomerPhone(phoneNumber)) {
    throw new ValidationError(CUSTOMER_PHONE_RULE_MESSAGE);
  }
  return { firstName, lastName, phoneNumber };
}

export type CustomerPhoneConflict = 'ordinary' | 'explicit-choice';

/**
 * Insert one Customer, its outbox event, and its audit row on the caller's transaction.
 * Does not open a transaction of its own.
 */
export async function createCustomerInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    salonId: string;
    actorId: string;
    identity: CustomerIdentity;
    now: Date;
    phoneConflict: CustomerPhoneConflict;
  },
) {
  await lockSalonCustomerPhone(tx, input.salonId, input.identity.phoneNumber);
  const existing = await tx.customer.findFirst({
    where: { salonId: input.salonId, phoneNumber: input.identity.phoneNumber },
    select: { id: true },
  });
  if (existing) {
    throw phoneConflictError(input.phoneConflict);
  }
  const customerId = createId();
  try {
    const customer = await tx.customer.create({
      data: {
        id: customerId,
        salonId: input.salonId,
        firstName: input.identity.firstName,
        lastName: input.identity.lastName,
        phoneNumber: input.identity.phoneNumber,
        updatedAt: input.now,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await tx.outboxEvent.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        eventType: DOMAIN_EVENT_TYPES.CustomerCreated,
        payload: { customerId, salonId: input.salonId },
      },
    });
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        actorId: input.actorId,
        action: 'CUSTOMER_CREATED',
        resource: 'customer',
        resourceId: customerId,
        result: 'SUCCESS',
      },
    });
    return customer;
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && isPhoneUnique(error)) {
      throw phoneConflictError(input.phoneConflict);
    }
    throw error;
  }
}

function phoneConflictError(kind: CustomerPhoneConflict) {
  if (kind === 'explicit-choice') {
    return new CustomerPhoneExistsError();
  }
  return new ConflictError('A customer with this phone number already exists in this salon');
}

function isPhoneUnique(error: Prisma.PrismaClientKnownRequestError) {
  const hint = JSON.stringify(error.meta ?? {}).toLowerCase();
  return hint.includes('phone_number') || hint.includes('phonenumber');
}

async function lockSalonCustomerPhone(tx: Prisma.TransactionClient, salonId: string, phone: string) {
  const digest = createHash('sha256').update(`salon-customer-phone:${salonId}:${phone}`).digest();
  const first = digest.readInt32BE(0);
  const second = digest.readInt32BE(4);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${first}::integer, ${second}::integer)`;
}
