import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  ForbiddenError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
  createId,
  type AuthenticatedPrincipal,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  hashIdempotencyPayload,
} from '../infrastructure/http/idempotency';
import {
  decodeCursor,
  encodeCursor,
  parseCursorInstant,
  parseCursorUuid,
  toListPage,
} from '../infrastructure/http/list-page';
import { OBJECT_STORAGE, type ObjectStorage } from '../infrastructure/storage/object-storage';
import {
  ACTIVATION_RECEIPT_LIST_PHASES,
  type ListActivationReceiptsQueryDto,
} from './activation.dto';
import {
  BANK_TRANSFER_ATTESTATION,
  instructionDigest,
  paymentInstructionsForAcceptance,
  readStoredPaymentSnapshot,
  type PaymentInstructionSnapshot,
} from './payment-instructions';
import {
  ACTIVATION_UPLOAD_LEASE_MS,
  activationObjectKey,
  inspectReceiptImage,
  readVerifiedActivationObject,
} from './receipt-image';

const SUBMIT_OPERATION = 'activation_receipt_submit';
const DECIDE_OPERATION = 'activation_receipt_decision';
const ACTIVATION_RECEIPT_PAGE_SIZE = 50;

type AcceptanceRow = {
  id: string;
  versionId: string;
  amountIrr: Prisma.Decimal;
  version: { id: string; versionKey: string; amountIrr: Prisma.Decimal };
};

@Injectable()
export class GetActivationStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(principal: AuthenticatedPrincipal) {
    if (principal.role !== 'OWNER' || principal.sessionScope !== 'onboarding') {
      throw new NotFoundError();
    }
    if (principal.accessState === 'PRODUCT') {
      return { phase: 'APPROVED' as const, receiptReady: false, instructions: null, rejectionReason: null };
    }
    if (principal.accessState !== 'AWAITING_PAYMENT') {
      throw new NotFoundError();
    }
    const salon = await this.prisma.client.salon.findFirst({
      where: {
        id: principal.tenantId,
        status: 'ACTIVE',
        accessState: 'AWAITING_PAYMENT',
        additionalUsersAllowed: false,
      },
      select: { id: true },
    });
    if (!salon) {
      throw new NotFoundError();
    }
    const receipts = await this.prisma.client.activationReceipt.findMany({
      where: { salonId: principal.tenantId, userId: principal.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        agreementAcceptanceId: true,
        phase: true,
        rejectionReason: true,
        submittedAt: true,
      },
    });
    const open = receipts.find((row) => row.phase === 'UNDER_REVIEW');
    if (open) {
      return {
        phase: 'UNDER_REVIEW' as const,
        receiptReady: false,
        receiptId: open.id,
        submittedAt: open.submittedAt?.toISOString() ?? null,
        instructions: null,
        rejectionReason: null,
      };
    }
    if (!this.config.values.MANUAL_TRANSFER_ENABLED) {
      const rejected = receipts.find((row) => row.phase === 'REJECTED');
      return {
        phase: 'PAYMENT_UNAVAILABLE' as const,
        receiptReady: false,
        receiptId: null,
        submittedAt: null,
        rejectionReason: rejected?.rejectionReason ?? null,
        instructions: null,
      };
    }
    const acceptance = await loadPayableAcceptance(this.prisma, principal);
    const scoped = receipts.filter((row) => row.agreementAcceptanceId === acceptance.id);
    const stored = scoped.find((row) => row.phase === 'STORED');
    const rejected = scoped.find((row) => row.phase === 'REJECTED');
    return {
      phase: 'AWAITING_RECEIPT' as const,
      receiptReady: Boolean(stored),
      receiptId: stored?.id ?? null,
      submittedAt: null,
      rejectionReason: rejected?.rejectionReason ?? null,
      instructions: publicInstructions(acceptance),
    };
  }
}

@Injectable()
export class UploadActivationReceiptUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    file: { buffer: Buffer; originalname: string; size: number },
  ) {
    if (!this.config.values.MANUAL_TRANSFER_ENABLED) {
      throw new NotFoundError();
    }
    const image = await inspectReceiptImage(file);
    const acceptance = await loadPayableAcceptance(this.prisma, principal);
    if (!this.storage.preparePutObject) {
      throw new InfrastructureError('File storage is temporarily unavailable');
    }
    const receiptId = createId();
    const objectKey = activationObjectKey(principal.tenantId, receiptId);
    const expiresAt = new Date(Date.now() + ACTIVATION_UPLOAD_LEASE_MS);
    const intent = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM salons WHERE id = ${principal.tenantId}::uuid FOR UPDATE`;
      await tx.$executeRaw`
        UPDATE activation_receipts
        SET phase = 'FAILED'::"ActivationReceiptPhase", updated_at = clock_timestamp()
        WHERE salon_id = ${principal.tenantId}::uuid
          AND phase = 'UPLOADING'::"ActivationReceiptPhase"
          AND created_at < clock_timestamp() - interval '60 seconds'
      `;
      const uploading = await tx.activationReceipt.findFirst({
        where: { salonId: principal.tenantId, phase: 'UPLOADING' },
        select: { id: true },
      });
      if (uploading) {
        throw new ConflictError('A receipt upload is already in progress');
      }
      const reviewing = await tx.activationReceipt.findFirst({
        where: { salonId: principal.tenantId, phase: 'UNDER_REVIEW' },
        select: { id: true },
      });
      if (reviewing) {
        throw new ConflictError('A receipt is already under review');
      }
      const stored = await tx.activationReceipt.findFirst({
        where: { salonId: principal.tenantId, phase: 'STORED' },
        select: { id: true },
      });
      await tx.activationReceipt.create({
        data: {
          id: receiptId,
          salonId: principal.tenantId,
          userId: principal.userId,
          agreementAcceptanceId: acceptance.id,
          objectKey,
          contentType: image.contentType,
          byteSize: image.buffer.length,
          sha256: image.sha256,
          phase: 'UPLOADING',
          updatedAt: new Date(),
        },
      });
      const preparedPut = this.storage.preparePutObject!({
        key: objectKey,
        body: image.buffer,
        contentType: image.contentType,
        expiresAt,
      });
      return { previousStoredId: stored?.id ?? null, preparedPut };
    });

    try {
      await intent.preparedPut.execute();
      await readVerifiedActivationObject(this.storage, {
        objectKey,
        salonId: principal.tenantId,
        contentType: image.contentType,
        byteSize: image.buffer.length,
        sha256: image.sha256,
      });
    } catch {
      await this.prisma.client.$executeRaw`
        UPDATE activation_receipts
        SET phase = 'FAILED'::"ActivationReceiptPhase", updated_at = clock_timestamp()
        WHERE id = ${receiptId}::uuid
          AND salon_id = ${principal.tenantId}::uuid
          AND phase = 'UPLOADING'::"ActivationReceiptPhase"
      `;
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw new InfrastructureError('File storage is temporarily unavailable');
    }

    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM salons WHERE id = ${principal.tenantId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM activation_receipts WHERE id = ${receiptId}::uuid FOR UPDATE`;
        if (intent.previousStoredId) {
          await tx.$queryRaw`SELECT id FROM activation_receipts WHERE id = ${intent.previousStoredId}::uuid FOR UPDATE`;
        }
        const current = await tx.activationReceipt.findFirst({
          where: { id: receiptId, salonId: principal.tenantId, phase: 'UPLOADING' },
        });
        if (!current || current.sha256 !== image.sha256 || current.objectKey !== objectKey) {
          throw new ConflictError('The receipt image was not stored');
        }
        if (intent.previousStoredId) {
          const replaced = await tx.$executeRaw`
            UPDATE activation_receipts
            SET phase = 'SUPERSEDED'::"ActivationReceiptPhase", updated_at = clock_timestamp()
            WHERE id = ${intent.previousStoredId}::uuid
              AND salon_id = ${principal.tenantId}::uuid
              AND phase = 'STORED'::"ActivationReceiptPhase"
          `;
          if (replaced !== 1) {
            throw new ConflictError('The receipt image was not stored');
          }
        } else {
          const other = await tx.activationReceipt.findFirst({
            where: { salonId: principal.tenantId, phase: 'STORED' },
            select: { id: true },
          });
          if (other) {
            throw new ConflictError('The receipt image was not stored');
          }
        }
        const stored = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE activation_receipts
          SET phase = 'STORED'::"ActivationReceiptPhase",
              stored_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = ${receiptId}::uuid
            AND salon_id = ${principal.tenantId}::uuid
            AND phase = 'UPLOADING'::"ActivationReceiptPhase"
            AND object_key = ${objectKey}
            AND sha256 = ${image.sha256}
          RETURNING id
        `;
        if (stored.length !== 1) {
          throw new ConflictError('The receipt image was not stored');
        }
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'ACTIVATION_RECEIPT_STORED',
            resource: 'activation_receipt',
            resourceId: receiptId,
            result: 'SUCCESS',
            metadata: {
              agreementAcceptanceId: acceptance.id,
              objectKey,
              sha256: image.sha256,
              byteSize: image.buffer.length,
              contentType: image.contentType,
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        await this.prisma.client.$executeRaw`
          UPDATE activation_receipts
          SET phase = 'FAILED'::"ActivationReceiptPhase", updated_at = clock_timestamp()
          WHERE id = ${receiptId}::uuid
            AND salon_id = ${principal.tenantId}::uuid
            AND phase = 'UPLOADING'::"ActivationReceiptPhase"
        `;
      }
      throw error;
    }
    return {
      receiptId,
      phase: 'STORED' as const,
      byteSize: image.buffer.length,
      contentType: image.contentType,
    };
  }
}

@Injectable()
export class SubmitActivationReceiptUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(principal: AuthenticatedPrincipal, receiptId: string, idempotencyKey: string) {
    if (!this.config.values.MANUAL_TRANSFER_ENABLED) {
      throw new NotFoundError();
    }
    const acceptance = await loadPayableAcceptance(this.prisma, principal);
    const snapshot = paymentInstructionsForAcceptance({
      amountIrr: acceptance.amountIrr.toFixed(2),
      versionKey: acceptance.version.versionKey,
      acceptanceId: acceptance.id,
      versionId: acceptance.versionId,
    });
    if (!snapshot) {
      throw new ConflictError('The accepted agreement cannot be paid in this state');
    }
    const digest = instructionDigest(snapshot);
    const requestHash = hashIdempotencyPayload(
      SUBMIT_OPERATION,
      `${receiptId}:${snapshot.amountIrr}:${digest}`,
    );
    const receipt = await this.prisma.client.activationReceipt.findFirst({
      where: { id: receiptId, salonId: principal.tenantId, userId: principal.userId },
    });
    if (!receipt || receipt.agreementAcceptanceId !== acceptance.id) {
      throw new NotFoundError('Receipt not found');
    }
    if (receipt.phase === 'STORED') {
      await readVerifiedActivationObject(this.storage, {
        objectKey: receipt.objectKey,
        salonId: principal.tenantId,
        contentType: receipt.contentType,
        byteSize: receipt.byteSize,
        sha256: receipt.sha256,
      });
    }
    const submitted = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM salons WHERE id = ${principal.tenantId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM activation_receipts WHERE id = ${receiptId}::uuid FOR UPDATE`;
      const current = await tx.activationReceipt.findFirst({
        where: { id: receiptId, salonId: principal.tenantId, userId: principal.userId },
      });
      if (!current || current.agreementAcceptanceId !== acceptance.id) {
        throw new NotFoundError('Receipt not found');
      }
      const existing = await findIdempotencyRecord(tx, {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        operation: SUBMIT_OPERATION,
        key: idempotencyKey,
      });
      if (existing) {
        assertSameIdempotentRequest(existing.requestHash, requestHash);
        if (existing.resourceId !== current.id) {
          throw new ConflictError('Idempotency-Key was already used with a different request');
        }
        return { replayed: true, submittedAt: current.submittedAt };
      }
      if (current.submissionIdempotencyKey === idempotencyKey && current.phase !== 'STORED' && current.phase !== 'UPLOADING' && current.phase !== 'FAILED') {
        return { replayed: true, submittedAt: current.submittedAt };
      }
      if (current.phase !== 'STORED') {
        throw new ConflictError('This receipt cannot be submitted');
      }
      const rows = await tx.$queryRaw<Array<{ submitted_at: Date }>>`
        UPDATE activation_receipts
        SET phase = 'UNDER_REVIEW'::"ActivationReceiptPhase",
            submitted_at = clock_timestamp(),
            submission_idempotency_key = ${idempotencyKey},
            amount_irr = ${snapshot.amountIrr}::numeric,
            instruction_snapshot = ${JSON.stringify(snapshot)}::jsonb,
            instruction_digest = ${digest},
            updated_at = clock_timestamp()
        WHERE id = ${receiptId}::uuid
          AND salon_id = ${principal.tenantId}::uuid
          AND phase = 'STORED'::"ActivationReceiptPhase"
          AND sha256 = ${current.sha256}
        RETURNING submitted_at
      `;
      if (rows.length !== 1) {
        throw new ConflictError('This receipt cannot be submitted');
      }
      const claim = await claimIdempotencyKey(tx, {
        id: createId(),
        tenantId: principal.tenantId,
        actorId: principal.userId,
        operation: SUBMIT_OPERATION,
        key: idempotencyKey,
        requestHash,
        resourceType: 'activation_receipt',
        resourceId: receiptId,
      });
      if (!claim.inserted) {
        throw new ConflictError('Idempotency-Key was already used with a different request');
      }
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'ACTIVATION_RECEIPT_SUBMITTED',
          resource: 'activation_receipt',
          resourceId: receiptId,
          result: 'SUCCESS',
          metadata: {
            agreementAcceptanceId: acceptance.id,
            agreementVersionId: acceptance.versionId,
            agreementVersionKey: acceptance.version.versionKey,
            amountIrr: snapshot.amountIrr,
            instructionDigest: digest,
            objectKey: current.objectKey,
            sha256: current.sha256,
            byteSize: current.byteSize,
            contentType: current.contentType,
            idempotencyKey,
          },
        },
      });
      return { replayed: false, submittedAt: rows[0]?.submitted_at ?? null };
    });
    return {
      receiptId,
      phase: 'UNDER_REVIEW' as const,
      submittedAt: submitted.submittedAt?.toISOString() ?? null,
      replayed: submitted.replayed,
    };
  }
}

@Injectable()
export class ReadOwnerActivationReceiptUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(principal: AuthenticatedPrincipal, receiptId: string) {
    if (principal.role !== 'OWNER' || principal.accessState !== 'AWAITING_PAYMENT') {
      throw new NotFoundError();
    }
    const receipt = await this.prisma.client.activationReceipt.findFirst({
      where: {
        id: receiptId,
        salonId: principal.tenantId,
        userId: principal.userId,
        phase: 'STORED',
      },
    });
    if (!receipt) {
      throw new NotFoundError('Receipt not found');
    }
    return readVerifiedActivationObject(this.storage, {
      objectKey: receipt.objectKey,
      salonId: principal.tenantId,
      contentType: receipt.contentType,
      byteSize: receipt.byteSize,
      sha256: receipt.sha256,
    });
  }
}

@Injectable()
export class ListActivationReceiptsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListActivationReceiptsQueryDto) {
    const selected = query.phase;
    const scope = selected ?? 'ALL';
    const parts = decodeCursor(query.cursor, 3);
    let cursor: { submittedAt: Date; id: string } | undefined;
    if (parts) {
      if (parts[0] !== scope) {
        throw new ValidationError('Invalid cursor');
      }
      cursor = {
        submittedAt: parseCursorInstant(parts[1]!),
        id: parseCursorUuid(parts[2]!),
      };
    }
    const rows = await this.prisma.client.activationReceipt.findMany({
      where: {
        phase: selected ?? { in: [...ACTIVATION_RECEIPT_LIST_PHASES] },
        submittedAt: { not: null },
        ...(cursor
          ? {
              OR: [
                { submittedAt: { lt: cursor.submittedAt } },
                { submittedAt: cursor.submittedAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: ACTIVATION_RECEIPT_PAGE_SIZE + 1,
      include: {
        salon: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });
    const page = toListPage(rows, ACTIVATION_RECEIPT_PAGE_SIZE, (row) =>
      encodeCursor([scope, row.submittedAt!.toISOString(), row.id]),
    );
    return {
      items: page.items.map((row) => ({
        id: row.id,
        phase: row.phase,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        salonId: row.salon.id,
        salonName: row.salon.name,
        ownerId: row.user.id,
        ownerName: row.user.name,
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class GetActivationReceiptReviewUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(receiptId: string) {
    const row = await this.prisma.client.activationReceipt.findUnique({
      where: { id: receiptId },
      include: {
        salon: { select: { id: true, name: true, accessState: true } },
        user: { select: { id: true, name: true } },
        agreementAcceptance: {
          select: { id: true, versionId: true, amountIrr: true, version: { select: { versionKey: true } } },
        },
      },
    });
    if (!row || row.phase === 'UPLOADING' || row.phase === 'FAILED' || row.phase === 'STORED') {
      throw new NotFoundError('Receipt not found');
    }
    const amountIrr = row.amountIrr?.toFixed(2) ?? '';
    const instructions = readStoredPaymentSnapshot(row.instructionSnapshot, amountIrr);
    if (!instructions || instructions.agreementAcceptanceId !== row.agreementAcceptanceId) {
      throw new NotFoundError('Receipt not found');
    }
    return {
      id: row.id,
      phase: row.phase,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      salonId: row.salon.id,
      salonName: row.salon.name,
      accessState: row.salon.accessState,
      ownerId: row.user.id,
      ownerName: row.user.name,
      agreementAcceptanceId: row.agreementAcceptance.id,
      agreementVersionId: row.agreementAcceptance.versionId,
      agreementVersionKey: row.agreementAcceptance.version.versionKey,
      instructions,
      object: {
        key: row.objectKey,
        sha256: row.sha256,
        byteSize: row.byteSize,
        contentType: row.contentType,
      },
      rejectionReason: row.rejectionReason,
      notice: instructions.notice,
      requiredBankAttestation: row.phase === 'UNDER_REVIEW' ? BANK_TRANSFER_ATTESTATION : null,
      bankAttestationWording: row.bankAttestationWording,
    };
  }
}

@Injectable()
export class ReadAdminActivationReceiptUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(admin: PlatformAdminPrincipal, receiptId: string) {
    const receipt = await this.prisma.client.activationReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt || receipt.phase === 'UPLOADING' || receipt.phase === 'FAILED') {
      throw new NotFoundError('Receipt not found');
    }
    const stored = await readVerifiedActivationObject(this.storage, {
      objectKey: receipt.objectKey,
      salonId: receipt.salonId,
      contentType: receipt.contentType,
      byteSize: receipt.byteSize,
      sha256: receipt.sha256,
    });
    await this.prisma.client.auditLog.create({
      data: {
        id: createId(),
        tenantId: receipt.salonId,
        actorId: admin.adminId,
        action: 'ACTIVATION_RECEIPT_VIEWED',
        resource: 'activation_receipt',
        resourceId: receipt.id,
        result: 'SUCCESS',
        metadata: {
          sha256: receipt.sha256,
          byteSize: receipt.byteSize,
          contentType: receipt.contentType,
          objectKey: receipt.objectKey,
        },
      },
    });
    return stored;
  }
}

@Injectable()
export class DecideActivationReceiptUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    receiptId: string,
    decision: 'APPROVE' | 'REJECT',
    idempotencyKey: string,
    reason?: string,
    bankAttestation?: string,
  ) {
    if (!this.config.values.MANUAL_TRANSFER_ENABLED) {
      throw new NotFoundError();
    }
    const rejectionReason = decision === 'REJECT' ? reason?.trim() ?? '' : null;
    if (decision === 'REJECT' && (rejectionReason == null || rejectionReason.length < 3 || rejectionReason.length > 500)) {
      throw new ValidationError('A rejection reason is required');
    }
    if (decision === 'APPROVE' && bankAttestation !== BANK_TRANSFER_ATTESTATION) {
      throw new ValidationError('A manual bank-transfer attestation is required');
    }
    const preview = await this.prisma.client.activationReceipt.findUnique({ where: { id: receiptId } });
    if (!preview) {
      throw new NotFoundError('Receipt not found');
    }
    if (decision === 'APPROVE' && preview.phase === 'UNDER_REVIEW') {
      await readVerifiedActivationObject(this.storage, {
        objectKey: preview.objectKey,
        salonId: preview.salonId,
        contentType: preview.contentType,
        byteSize: preview.byteSize,
        sha256: preview.sha256,
      });
    }
    const requestHash = hashIdempotencyPayload(
      DECIDE_OPERATION,
      `${receiptId}:${decision}:${rejectionReason ?? ''}:${decision === 'APPROVE' ? BANK_TRANSFER_ATTESTATION : ''}`,
    );
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM activation_receipts WHERE id = ${receiptId}::uuid FOR UPDATE`;
      const current = await tx.activationReceipt.findUnique({ where: { id: receiptId } });
      if (!current) {
        throw new NotFoundError('Receipt not found');
      }
      await tx.$queryRaw`SELECT id FROM salons WHERE id = ${current.salonId}::uuid FOR UPDATE`;
      const existing = await findIdempotencyRecord(tx, {
        tenantId: current.salonId,
        actorId: admin.adminId,
        operation: DECIDE_OPERATION,
        key: idempotencyKey,
      });
      if (existing) {
        assertSameIdempotentRequest(existing.requestHash, requestHash);
        if (existing.resourceId !== current.id) {
          throw new ConflictError('Idempotency-Key was already used with a different request');
        }
      }
      const sameDecision = current.decisionIdempotencyKey === idempotencyKey
        && ((decision === 'APPROVE' && current.phase === 'APPROVED')
          || (decision === 'REJECT' && current.phase === 'REJECTED' && current.rejectionReason === rejectionReason));
      if (existing || sameDecision) {
        const salon = await tx.salon.findUniqueOrThrow({
          where: { id: current.salonId },
          select: { accessState: true },
        });
        return {
          receiptId: current.id,
          phase: current.phase,
          accessState: salon.accessState,
          replayed: true,
        };
      }
      if (current.phase !== 'UNDER_REVIEW') {
        throw new ConflictError('This receipt is no longer awaiting review');
      }
      let decidedAt: Date | null = null;
      if (decision === 'APPROVE') {
        const approved = await tx.$queryRaw<Array<{ decided_at: Date }>>`
          UPDATE activation_receipts
          SET phase = 'APPROVED'::"ActivationReceiptPhase",
              decided_at = clock_timestamp(),
              decided_by_admin_id = ${admin.adminId}::uuid,
              decision_idempotency_key = ${idempotencyKey},
              bank_attestation_wording = ${BANK_TRANSFER_ATTESTATION},
              updated_at = clock_timestamp()
          WHERE id = ${receiptId}::uuid
            AND phase = 'UNDER_REVIEW'::"ActivationReceiptPhase"
          RETURNING decided_at
        `;
        if (approved.length !== 1) {
          throw new ConflictError('This receipt is no longer awaiting review');
        }
        decidedAt = approved[0]?.decided_at ?? null;
        const activated = await tx.$executeRaw`
          UPDATE salons
          SET access_state = 'PRODUCT'::"SalonAccessState", updated_at = clock_timestamp()
          WHERE id = ${current.salonId}::uuid
            AND access_state = 'AWAITING_PAYMENT'::"SalonAccessState"
            AND status = 'ACTIVE'::"SalonStatus"
        `;
        if (activated !== 1) {
          throw new ConflictError('The salon cannot be activated from its current access state');
        }
      } else {
        const updated = await tx.$executeRaw`
          UPDATE activation_receipts
          SET phase = 'REJECTED'::"ActivationReceiptPhase",
              decided_at = clock_timestamp(),
              decided_by_admin_id = ${admin.adminId}::uuid,
              decision_idempotency_key = ${idempotencyKey},
              rejection_reason = ${rejectionReason},
              updated_at = clock_timestamp()
          WHERE id = ${receiptId}::uuid
            AND phase = 'UNDER_REVIEW'::"ActivationReceiptPhase"
        `;
        if (updated !== 1) {
          throw new ConflictError('This receipt is no longer awaiting review');
        }
      }
      const claim = await claimIdempotencyKey(tx, {
        id: createId(),
        tenantId: current.salonId,
        actorId: admin.adminId,
        operation: DECIDE_OPERATION,
        key: idempotencyKey,
        requestHash,
        resourceType: 'activation_receipt',
        resourceId: receiptId,
      });
      if (!claim.inserted) {
        throw new ConflictError('Idempotency-Key was already used with a different request');
      }
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: current.salonId,
          actorId: admin.adminId,
          action: decision === 'APPROVE' ? 'ACTIVATION_RECEIPT_APPROVED' : 'ACTIVATION_RECEIPT_REJECTED',
          resource: 'activation_receipt',
          resourceId: receiptId,
          result: 'SUCCESS',
          metadata: {
            agreementAcceptanceId: current.agreementAcceptanceId,
            amountIrr: current.amountIrr?.toFixed(2),
            instructionDigest: current.instructionDigest,
            objectKey: current.objectKey,
            sha256: current.sha256,
            decision,
            idempotencyKey,
            rejectionReason: rejectionReason ?? undefined,
            receiptId,
            decidedByAdminId: admin.adminId,
            decidedAt: decidedAt?.toISOString(),
            bankAttestationWording: decision === 'APPROVE' ? BANK_TRANSFER_ATTESTATION : undefined,
            attestation: decision === 'APPROVE' ? 'MANUAL_PLATFORM_ADMIN' : undefined,
          },
        },
      });
      return {
        receiptId,
        phase: decision === 'APPROVE' ? 'APPROVED' as const : 'REJECTED' as const,
        accessState: decision === 'APPROVE' ? 'PRODUCT' as const : 'AWAITING_PAYMENT' as const,
        replayed: false,
      };
    });
  }
}

async function loadPayableAcceptance(
  prisma: PrismaService,
  principal: AuthenticatedPrincipal,
): Promise<AcceptanceRow> {
  if (principal.role !== 'OWNER' || principal.accessState !== 'AWAITING_PAYMENT') {
    throw new NotFoundError();
  }
  const salon = await prisma.client.salon.findFirst({
    where: {
      id: principal.tenantId,
      status: 'ACTIVE',
      accessState: 'AWAITING_PAYMENT',
      additionalUsersAllowed: false,
    },
    select: { id: true },
  });
  if (!salon) {
    throw new NotFoundError();
  }
  const acceptance = await prisma.client.agreementAcceptance.findFirst({
    where: { salonId: principal.tenantId, userId: principal.userId },
    orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
    include: { version: { select: { id: true, versionKey: true, amountIrr: true } } },
  });
  if (!acceptance || acceptance.amountIrr.toFixed(2) !== acceptance.version.amountIrr.toFixed(2)) {
    throw new ConflictError('The accepted agreement cannot be paid in this state');
  }
  if (!paymentInstructionsForAcceptance({
    amountIrr: acceptance.amountIrr.toFixed(2),
    versionKey: acceptance.version.versionKey,
    acceptanceId: acceptance.id,
    versionId: acceptance.versionId,
  })) {
    throw new ConflictError('The accepted agreement cannot be paid in this state');
  }
  return acceptance;
}

function publicInstructions(acceptance: AcceptanceRow) {
  const snapshot = paymentInstructionsForAcceptance({
    amountIrr: acceptance.amountIrr.toFixed(2),
    versionKey: acceptance.version.versionKey,
    acceptanceId: acceptance.id,
    versionId: acceptance.versionId,
  });
  if (!snapshot) {
    throw new ConflictError('The accepted agreement cannot be paid in this state');
  }
  return {
    cardNumber: snapshot.cardNumber,
    cardNumberCopy: snapshot.cardNumber,
    cardholderName: snapshot.cardholderName,
    amountIrr: snapshot.amountIrr,
    amountLabel: snapshot.amountLabel,
    amountCopy: snapshot.amountLabel,
    currency: snapshot.currency,
    agreementAcceptanceId: snapshot.agreementAcceptanceId,
    agreementVersionKey: snapshot.agreementVersionKey,
    notice: snapshot.notice,
  };
}

export type { PaymentInstructionSnapshot };
