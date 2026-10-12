import { Injectable } from '@nestjs/common';
import {
  blockUnsentMessagesForPhone,
  isActivePlatformMessageStop,
  lockPlatformMessagePhone,
  PLATFORM_MESSAGE_STOP_REASON,
  recordVipRecipientGlobalStop,
} from '@salon/database';
import {
  createId,
  GlobalMessageStopError,
  isUsableCustomerPhone,
  ValidationError,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';

type PolicyTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

export type PlatformMessageStopView = {
  phoneNumber: string;
  active: boolean;
  reasonCode: typeof PLATFORM_MESSAGE_STOP_REASON;
  registeredAt: string;
  liftedAt: string | null;
  blockedRequestCount: number;
  skippedRecipientCount: number;
};

@Injectable()
export class PlatformMessageStopService {
  constructor(private readonly prisma: PrismaService) {}

  async search(phoneNumber: string): Promise<PlatformMessageStopView | null> {
    const phone = requireCanonicalPhone(phoneNumber);
    const row = await this.prisma.client.platformMessageStop.findUnique({ where: { phoneNumber: phone } });
    if (!row) return null;
    return this.toView(row, 0, 0);
  }

  async register(admin: PlatformAdminPrincipal, phoneNumber: string, confirmed: boolean) {
    if (confirmed !== true) {
      throw new ValidationError('Confirmation is required');
    }
    const phone = requireCanonicalPhone(phoneNumber);
    const now = new Date();
    return this.prisma.client.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, phone);
      const existing = await tx.platformMessageStop.findUnique({ where: { phoneNumber: phone } });
      if (existing?.active) {
        return this.toView(existing, 0, 0);
      }
      const stop = existing
        ? await tx.platformMessageStop.update({
            where: { id: existing.id },
            data: {
              active: true,
              reasonCode: PLATFORM_MESSAGE_STOP_REASON,
              registeredByAdminId: admin.adminId,
              registeredAt: now,
              liftedByAdminId: null,
              liftedAt: null,
              updatedAt: now,
            },
          })
        : await tx.platformMessageStop.create({
            data: {
              id: createId(),
              phoneNumber: phone,
              active: true,
              reasonCode: PLATFORM_MESSAGE_STOP_REASON,
              registeredByAdminId: admin.adminId,
              registeredAt: now,
              updatedAt: now,
            },
          });
      await tx.platformMessageStopEvent.create({
        data: {
          id: createId(),
          stopId: stop.id,
          phoneNumber: phone,
          action: 'REGISTERED',
          reasonCode: PLATFORM_MESSAGE_STOP_REASON,
          actorAdminId: admin.adminId,
          createdAt: now,
        },
      });
      const blockedRequestCount = await blockUnsentMessagesForPhone(tx, phone, now);
      const skippedRecipientCount = await this.skipOpenVipRecipients(tx, phone, now);
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: null,
          actorId: admin.adminId,
          action: 'PLATFORM_MESSAGE_STOP_REGISTERED',
          resource: 'platform_message_stop',
          resourceId: stop.id,
          result: 'SUCCESS',
          metadata: {
            reasonCode: PLATFORM_MESSAGE_STOP_REASON,
            blockedRequestCount,
            skippedRecipientCount,
          },
        },
      });
      return this.toView(stop, blockedRequestCount, skippedRecipientCount);
    });
  }

  async lift(admin: PlatformAdminPrincipal, phoneNumber: string, confirmed: boolean) {
    if (confirmed !== true) {
      throw new ValidationError('Confirmation is required');
    }
    const phone = requireCanonicalPhone(phoneNumber);
    const now = new Date();
    return this.prisma.client.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, phone);
      const existing = await tx.platformMessageStop.findUnique({ where: { phoneNumber: phone } });
      if (!existing || !existing.active) {
        if (!existing) {
          throw new ValidationError('No stop is registered for this phone');
        }
        return this.toView(existing, 0, 0);
      }
      const stop = await tx.platformMessageStop.update({
        where: { id: existing.id },
        data: {
          active: false,
          liftedByAdminId: admin.adminId,
          liftedAt: now,
          updatedAt: now,
        },
      });
      await tx.platformMessageStopEvent.create({
        data: {
          id: createId(),
          stopId: stop.id,
          phoneNumber: phone,
          action: 'LIFTED',
          reasonCode: PLATFORM_MESSAGE_STOP_REASON,
          actorAdminId: admin.adminId,
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: null,
          actorId: admin.adminId,
          action: 'PLATFORM_MESSAGE_STOP_LIFTED',
          resource: 'platform_message_stop',
          resourceId: stop.id,
          result: 'SUCCESS',
          metadata: { reasonCode: PLATFORM_MESSAGE_STOP_REASON },
        },
      });
      return this.toView(stop, 0, 0);
    });
  }

  async assertSendable(tx: PolicyTx, phone: string): Promise<void> {
    await lockPlatformMessagePhone(tx, phone);
    if (await isActivePlatformMessageStop(tx, phone)) {
      throw new GlobalMessageStopError();
    }
  }

  async active(tx: PolicyTx, phone: string): Promise<boolean> {
    await lockPlatformMessagePhone(tx, phone);
    return isActivePlatformMessageStop(tx, phone);
  }

  private async skipOpenVipRecipients(tx: PolicyTx, phone: string, now: Date): Promise<number> {
    const recipients = await tx.vipRequestRecipient.findMany({
      where: {
        phoneNumber: phone,
        messageRequestId: null,
        globalStopOutcome: null,
        vipRequest: { status: { in: ['SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED'] } },
      },
      select: { id: true, salonId: true },
    });
    let skipped = 0;
    for (const recipient of recipients) {
      const inserted = await recordVipRecipientGlobalStop(tx, {
        recipientId: recipient.id,
        salonId: recipient.salonId,
        phone,
        now,
      });
      if (inserted) skipped += 1;
    }
    return skipped;
  }

  private toView(
    row: {
      phoneNumber: string;
      active: boolean;
      reasonCode: string;
      registeredAt: Date;
      liftedAt: Date | null;
    },
    blockedRequestCount: number,
    skippedRecipientCount: number,
  ): PlatformMessageStopView {
    return {
      phoneNumber: row.phoneNumber,
      active: row.active,
      reasonCode: PLATFORM_MESSAGE_STOP_REASON,
      registeredAt: row.registeredAt.toISOString(),
      liftedAt: row.liftedAt?.toISOString() ?? null,
      blockedRequestCount,
      skippedRecipientCount,
    };
  }
}

export function requireCanonicalPhone(phone: string): string {
  if (!isUsableCustomerPhone(phone)) {
    throw new ValidationError('Phone number must be exactly 11 digits and start with 09.');
  }
  return phone;
}
