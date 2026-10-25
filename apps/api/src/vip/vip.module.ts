import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactPolicyModule } from '../contact-policy/contact-policy.module';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { MemoryObjectStorage } from '../infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../infrastructure/storage/object-storage';
import { S3CompatibleObjectStorage } from '../infrastructure/storage/s3-compatible.object-storage';
import { AdminVipController } from './admin-vip.controller';
import { SalonVipController } from './salon-vip.controller';
import { AdminVipOutreachRepository } from './admin-vip-outreach.repository';
import {
  GetAdminVipOutreachRequestUseCase,
  GetAdminVipOutreachSalonUseCase,
  ListAdminVipOutreachSalonsUseCase,
} from './admin-vip-outreach.use-cases';
import { GetAdminSalonProfileUseCase } from './admin-salon-profile.use-case';
import { ListSalonVipRequestHistoryUseCase } from './list-salon-vip-request-history.use-case';
import { VipRepository } from './vip.repository';
import {
  CreateVipRequestUseCase,
  DeleteVipListUseCase,
  DispatchVipRequestUseCase,
  DownloadVipSampleWorkUseCase,
  ExportVipRequestExcelUseCase,
  GetSalonVipRequestUseCase,
  GetVipCapabilityUseCase,
  GetVipListUseCase,
  GrantVipEntitlementUseCase,
  ImportVipListUseCase,
  ListActiveVipListsUseCase,
  ListAdminSalonsUseCase,
  ListVipListsUseCase,
  ListVipRegionsUseCase,
  PatchVipListUseCase,
  RevokeVipEntitlementUseCase,
  SubmitVipRequestUseCase,
  UploadVipSampleWorkUseCase,
} from './vip.use-cases';

@Module({
  imports: [AuthModule, ContactPolicyModule],
  controllers: [AdminVipController, SalonVipController],
  providers: [
    VipRepository,
    AdminVipOutreachRepository,
    {
      provide: OBJECT_STORAGE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.values.NODE_ENV === 'test'
          ? new MemoryObjectStorage()
          : new S3CompatibleObjectStorage(config.values),
    },
    ImportVipListUseCase,
    ListVipListsUseCase,
    GetVipListUseCase,
    PatchVipListUseCase,
    DeleteVipListUseCase,
    GrantVipEntitlementUseCase,
    RevokeVipEntitlementUseCase,
    ListAdminSalonsUseCase,
    GetAdminSalonProfileUseCase,
    GetVipCapabilityUseCase,
    ListVipRegionsUseCase,
    ListActiveVipListsUseCase,
    ListSalonVipRequestHistoryUseCase,
    CreateVipRequestUseCase,
    UploadVipSampleWorkUseCase,
    SubmitVipRequestUseCase,
    GetSalonVipRequestUseCase,
    DownloadVipSampleWorkUseCase,
    ExportVipRequestExcelUseCase,
    DispatchVipRequestUseCase,
    ListAdminVipOutreachSalonsUseCase,
    GetAdminVipOutreachSalonUseCase,
    GetAdminVipOutreachRequestUseCase,
  ],
})
export class VipModule {}
