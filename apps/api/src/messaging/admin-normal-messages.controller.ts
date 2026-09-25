import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { AdminMessageQueueQueryDto, AdminNormalSalonFolderQueryDto } from './admin-message.dto';
import {
  GetAdminNormalSalonFolderUseCase,
  ListAdminNormalSalonFoldersUseCase,
} from './admin-normal-messages.use-cases';

@ApiTags('admin-normal-messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/messages/normal')
export class AdminNormalMessagesController {
  constructor(
    private readonly listFolders: ListAdminNormalSalonFoldersUseCase,
    private readonly getFolder: GetAdminNormalSalonFolderUseCase,
  ) {}

  @Get('salons')
  @ApiOperation({
    summary:
      'Derived admin folders of ordinary customer messages grouped by salonId. Excludes VIP MessageRequests.',
  })
  list(@Query() query: AdminNormalSalonFolderQueryDto) {
    return this.listFolders.execute(query);
  }

  @Get('salons/:salonId')
  @ApiOperation({
    summary: 'Ordinary customer MessageRequests for one salon folder, newest first, cursor paginated',
  })
  get(
    @Param('salonId', UuidParam) salonId: string,
    @Query() query: AdminMessageQueueQueryDto,
  ) {
    return this.getFolder.execute(salonId, query.cursor);
  }
}
