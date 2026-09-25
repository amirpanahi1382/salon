import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { encodeCursor, toListPage } from '../infrastructure/http/list-page';
import { ADMIN_MESSAGE_LIST_LIMIT } from './admin-message.repository';
import { toAdminMessageItem, type AdminMessageRow } from './admin-message.mapper';
import { AdminNormalMessagesRepository } from './admin-normal-messages.repository';
import { AdminNormalSalonFolderQueryDto } from './admin-message.dto';

@Injectable()
export class ListAdminNormalSalonFoldersUseCase {
  constructor(private readonly folders: AdminNormalMessagesRepository) {}

  async execute(query: AdminNormalSalonFolderQueryDto) {
    const page = await this.folders.listSalonFolders(query);
    return {
      items: page.items.map((row) => ({
        salonId: row.salonId,
        salonName: row.salonName,
        totalMessageCount: row.totalMessageCount,
        sentMessageCount: row.sentMessageCount,
        pendingMessageCount: row.pendingMessageCount,
        failedMessageCount: row.failedMessageCount,
        cancelledMessageCount: row.cancelledMessageCount,
        latestActivityAt: row.latestActivityAt.toISOString(),
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}

@Injectable()
export class GetAdminNormalSalonFolderUseCase {
  constructor(
    private readonly folders: AdminNormalMessagesRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(salonId: string, cursor?: string) {
    const header = await this.folders.findSalonFolder(salonId);
    if (!header) {
      throw new NotFoundError('Salon not found');
    }
    const rows = (await this.folders.listSalonMessages(salonId, cursor)) as AdminMessageRow[];
    const page = toListPage(rows, ADMIN_MESSAGE_LIST_LIMIT, (row) =>
      encodeCursor([row.requestedAt.toISOString(), row.id]),
    );
    return {
      salonId: header.salonId,
      salonName: header.salonName,
      totalMessageCount: header.totalMessageCount,
      sentMessageCount: header.sentMessageCount,
      pendingMessageCount: header.pendingMessageCount,
      failedMessageCount: header.failedMessageCount,
      cancelledMessageCount: header.cancelledMessageCount,
      items: page.items.map((row) => toAdminMessageItem(row, this.config.values, null)),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
