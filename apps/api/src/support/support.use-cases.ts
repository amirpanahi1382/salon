import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  NotFoundError,
  ValidationError,
  type AuthenticatedPrincipal,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { adminSupportMessageHash, salonSupportMessageHash } from './support-idempotency';
import { toAdminSupportMessage, toAdminThread, toSalonSupportMessage, toSalonThread } from './support.mapper';
import {
  ADMIN_SUPPORT_MESSAGE_OPERATION,
  SALON_SUPPORT_MESSAGE_OPERATION,
  SupportRepository,
} from './support.repository';
import { normalizeSupportText } from './support.constants';

function rethrowSupportWrite(error: unknown): never {
  if (error instanceof ValidationError || error instanceof NotFoundError) {
    throw error;
  }
  const mapped = mapPrismaError(error);
  if (mapped) {
    throw mapped;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    throw new ValidationError('Support message could not be recorded');
  }
  throw error;
}

@Injectable()
export class GetSalonSupportUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, cursor?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const conversation = await this.support.findOwnConversation(
        tx,
        principal.tenantId,
        principal.userId,
      );
      if (!conversation) {
        return toSalonThread(null, { items: [], hasMore: false, nextCursor: null });
      }
      const page = await this.support.listOwnMessages(tx, {
        salonId: principal.tenantId,
        userId: principal.userId,
        conversationId: conversation.id,
        cursor,
      });
      return toSalonThread(conversation, page);
    });
  }
}

@Injectable()
export class PostSalonSupportMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, text: string, idempotencyKey: string) {
    const body = normalizeSupportText(text);
    if (!body) {
      throw new ValidationError('Support text is invalid');
    }
    const requestHash = salonSupportMessageHash(body);
    try {
      const message = await this.prisma.client.$transaction(async (tx) => {
        const conversationId = await this.support.lockOrCreateOwn(tx, {
          salonId: principal.tenantId,
          userId: principal.userId,
        });
        return this.support.commitMessage(tx, {
          conversationId,
          salonId: principal.tenantId,
          actorId: principal.userId,
          tenantId: principal.tenantId,
          operation: SALON_SUPPORT_MESSAGE_OPERATION,
          idempotencyKey,
          requestHash,
          authorUserId: principal.userId,
          authorPlatformAdminId: null,
          body,
        });
      });
      return toSalonSupportMessage(message);
    } catch (error: unknown) {
      rethrowSupportWrite(error);
    }
  }
}

@Injectable()
export class ListAdminSupportUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportRepository,
  ) {}

  async execute(cursor?: string) {
    const page = await this.prisma.client.$transaction((tx) =>
      this.support.listConversations(tx, cursor),
    );
    return {
      items: page.items.map((row) => ({
        id: row.id,
        userName: row.userName,
        userEmail: row.userEmail,
        salonName: row.salonName,
        lastMessageAt: row.lastMessageAt.toISOString(),
        awaitingSupportReply: row.awaitingSupportReply,
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class GetAdminSupportUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportRepository,
  ) {}

  async execute(conversationId: string, cursor?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const conversation = await this.support.findConversation(tx, conversationId);
      if (!conversation) {
        throw new NotFoundError('Support conversation not found');
      }
      const page = await this.support.listConversationMessages(tx, conversationId, cursor);
      return toAdminThread(conversation, page);
    });
  }
}

@Injectable()
export class PostAdminSupportMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportRepository,
  ) {}

  async execute(
    admin: PlatformAdminPrincipal,
    conversationId: string,
    text: string,
    idempotencyKey: string,
  ) {
    const body = normalizeSupportText(text);
    if (!body) {
      throw new ValidationError('Support text is invalid');
    }
    const requestHash = adminSupportMessageHash(conversationId, body);
    try {
      const message = await this.prisma.client.$transaction(async (tx) => {
        const conversation = await this.support.lockConversation(tx, conversationId);
        return this.support.commitMessage(tx, {
          conversationId: conversation.id,
          salonId: conversation.salonId,
          actorId: admin.adminId,
          tenantId: conversation.salonId,
          operation: ADMIN_SUPPORT_MESSAGE_OPERATION,
          idempotencyKey,
          requestHash,
          authorUserId: null,
          authorPlatformAdminId: admin.adminId,
          body,
        });
      });
      return toAdminSupportMessage(message);
    } catch (error: unknown) {
      rethrowSupportWrite(error);
    }
  }
}
