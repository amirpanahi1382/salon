import { Injectable } from '@nestjs/common';
import { NotFoundError, vipRecipientAdminCapabilities } from '@salon/shared';
import {
  AdminVipOutreachRepository,
  toOutreachRequestDto,
} from './admin-vip-outreach.repository';
import { VipRepository } from './vip.repository';

@Injectable()
export class ListAdminVipOutreachSalonsUseCase {
  constructor(private readonly outreach: AdminVipOutreachRepository) {}

  execute(query: { cursor?: string; q?: string }) {
    return this.outreach.listSalonFolders(query);
  }
}

@Injectable()
export class ListAdminVipListSalonResultsUseCase {
  constructor(
    private readonly outreach: AdminVipOutreachRepository,
    private readonly vip: VipRepository,
  ) {}

  async execute(listId: string, cursor?: string) {
    if (!(await this.vip.findListById(listId))) {
      throw new NotFoundError('VIP list not found');
    }
    return this.outreach.listListSalonResults(listId, cursor);
  }
}

@Injectable()
export class GetAdminVipOutreachSalonUseCase {
  constructor(private readonly outreach: AdminVipOutreachRepository) {}

  async execute(salonId: string, cursor?: string) {
    const page = await this.outreach.listSalonRequests(salonId, cursor);
    if (!page) {
      throw new NotFoundError('Salon not found');
    }
    return {
      salonId: page.salonId,
      salonName: page.salonName,
      items: page.items.map(toOutreachRequestDto),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class GetAdminVipOutreachRequestUseCase {
  constructor(private readonly outreach: AdminVipOutreachRepository) {}

  async execute(requestId: string, cursor?: string) {
    const header = await this.outreach.findRequestHeader(requestId);
    if (!header) {
      throw new NotFoundError('VIP request not found');
    }
    const recipients = await this.outreach.listRequestRecipients(requestId, cursor);
    return {
      request: toOutreachRequestDto(header),
      items: recipients.items.map((row) => {
        const capabilities = vipRecipientAdminCapabilities({
          messageRequestStatus: row.messageRequestStatus,
          deliveryStatus: row.deliveryStatus,
          deliveryMode: row.deliveryMode,
          submittedAt: row.submittedAt,
        });
        return {
          id: row.id,
          sortOrder: row.sortOrder,
          displayName: row.displayName,
          phoneNumber: row.phoneNumber,
          messageRequestId: row.messageRequestId,
          messageRequestStatus: row.messageRequestStatus,
          deliveryStatus: row.deliveryStatus,
          deliveryMode: row.deliveryMode,
          submittedAt: row.submittedAt?.toISOString() ?? null,
          executionState: row.executionState,
          globalMessageStopActive: row.globalMessageStopActive,
          canCancel: capabilities.canCancel,
          canMarkManualSent: capabilities.canMarkManualSent,
        };
      }),
      hasMore: recipients.hasMore,
      nextCursor: recipients.nextCursor,
    };
  }
}
