import { Prisma } from '@salon/database';
import { createId, DOMAIN_EVENT_TYPES } from '@salon/shared';
import { normalizeServiceName } from './service-name';

export async function insertSalonService(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    actorId: string;
    name: string;
    now?: Date;
  },
) {
  const name = normalizeServiceName(input.name);
  const id = createId();
  const now = input.now ?? new Date();
  const service = await tx.service.create({
    data: {
      id,
      salonId: input.tenantId,
      name,
      status: 'ACTIVE',
      updatedAt: now,
    },
  });
  await tx.outboxEvent.create({
    data: {
      id: createId(),
      tenantId: input.tenantId,
      eventType: DOMAIN_EVENT_TYPES.ServiceCreated,
      payload: { serviceId: id, salonId: input.tenantId },
    },
  });
  await tx.auditLog.create({
    data: {
      id: createId(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'SERVICE_CREATED',
      resource: 'service',
      resourceId: id,
      result: 'SUCCESS',
      metadata: { salonId: input.tenantId },
    },
  });
  return service;
}
