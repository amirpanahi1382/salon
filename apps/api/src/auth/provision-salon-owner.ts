import { starterServiceNamesForRegistration, type Prisma, type SalonAccessState } from '@salon/database';
import { DOMAIN_EVENT_TYPES, createId } from '@salon/shared';
import { insertSalonService } from '../service/insert-salon-service';

/**
 * One transaction-scoped registration of a salon, its owner, starter services,
 * audit, and outbox rows. Phone completion calls this.
 * The caller owns the transaction and hashes the password before entering it.
 */
export async function provisionSalonOwner(
  tx: Prisma.TransactionClient,
  input: {
    salonId: string;
    userId: string;
    salonName: string;
    ownerName: string;
    passwordHash: string;
    email: string | null;
    phone: string;
    accessState: SalonAccessState;
    additionalUsersAllowed: boolean;
    now: Date;
  },
): Promise<void> {
  if (!/^09\d{9}$/.test(input.phone)) {
    throw new Error('Salon owner registration requires a canonical mobile number');
  }

  await tx.salon.create({
    data: {
      id: input.salonId,
      name: input.salonName,
      status: 'ACTIVE',
      accessState: input.accessState,
      additionalUsersAllowed: input.additionalUsersAllowed,
      updatedAt: input.now,
    },
  });

  await tx.user.create({
    data: {
      id: input.userId,
      salonId: input.salonId,
      name: input.ownerName,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: 'OWNER',
      status: 'ACTIVE',
      updatedAt: input.now,
    },
  });

  await tx.outboxEvent.createMany({
    data: [
      {
        id: createId(),
        tenantId: input.salonId,
        eventType: DOMAIN_EVENT_TYPES.SalonCreated,
        payload: { salonId: input.salonId },
      },
      {
        id: createId(),
        tenantId: input.salonId,
        eventType: DOMAIN_EVENT_TYPES.UserCreated,
        payload: { userId: input.userId, salonId: input.salonId, role: 'OWNER' },
      },
    ],
  });

  for (const name of starterServiceNamesForRegistration(input.email)) {
    await insertSalonService(tx, {
      tenantId: input.salonId,
      actorId: input.userId,
      name,
      now: input.now,
    });
  }

  await tx.auditLog.create({
    data: {
      id: createId(),
      tenantId: input.salonId,
      actorId: input.userId,
      action: 'USER_REGISTERED',
      resource: 'user',
      resourceId: input.userId,
      result: 'SUCCESS',
      metadata: {
        role: 'OWNER',
        accessState: input.accessState,
        login: 'phone',
      },
    },
  });
}
