import { createHash } from 'node:crypto';
import type { Prisma } from '@salon/database';
import { ConflictError, ValidationError } from '@salon/shared';

export const VISIT_CREATE_OPERATION = 'VISIT_CREATE';

const KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function normalizeIdempotencyKey(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const key = value.trim();
  if (!KEY_PATTERN.test(key)) {
    throw new ValidationError(
      'Idempotency-Key must be 8-128 characters using letters, digits, dot, underscore, or hyphen',
    );
  }
  return key;
}

export function visitCreateRequestHash(customerId: string, visitedAt: Date): string {
  return createHash('sha256')
    .update(`VISIT_CREATE:${customerId}:${visitedAt.toISOString()}`)
    .digest('hex');
}

type IdempotencyClaim = {
  inserted: boolean;
};

/**
 * Inserts the idempotency row or no-ops on unique conflict without aborting the transaction
 * (PostgreSQL ON CONFLICT DO NOTHING). Callers must compare requestHash on conflict.
 */
export async function claimIdempotencyKey(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    tenantId: string;
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    resourceType: string;
    resourceId: string;
  },
): Promise<IdempotencyClaim> {
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO idempotency_records (
      id, tenant_id, actor_id, operation, key, request_hash, resource_type, resource_id
    )
    VALUES (
      ${input.id}::uuid,
      ${input.tenantId}::uuid,
      ${input.actorId}::uuid,
      ${input.operation},
      ${input.key},
      ${input.requestHash},
      ${input.resourceType},
      ${input.resourceId}::uuid
    )
    ON CONFLICT (tenant_id, actor_id, operation, key) DO NOTHING
    RETURNING id
  `;
  return { inserted: inserted.length > 0 };
}

export async function findIdempotencyRecord(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; actorId: string; operation: string; key: string },
) {
  return tx.idempotencyRecord.findUnique({
    where: {
      tenantId_actorId_operation_key: {
        tenantId: input.tenantId,
        actorId: input.actorId,
        operation: input.operation,
        key: input.key,
      },
    },
  });
}

export function assertSameIdempotentRequest(existingHash: string, requestHash: string): void {
  if (existingHash !== requestHash) {
    throw new ConflictError('Idempotency-Key was already used with a different request');
  }
}
