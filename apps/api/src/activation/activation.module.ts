import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { MemoryObjectStorage } from '../infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../infrastructure/storage/object-storage';
import { S3CompatibleObjectStorage } from '../infrastructure/storage/s3-compatible.object-storage';
import { ManualTransferEnabledGuard } from './activation-enabled.guard';
import { ActivationController, AdminActivationController } from './activation.controller';
import {
  DecideActivationReceiptUseCase,
  GetActivationReceiptReviewUseCase,
  GetActivationStatusUseCase,
  ListActivationReceiptsUseCase,
  ReadAdminActivationReceiptUseCase,
  ReadOwnerActivationReceiptUseCase,
  SubmitActivationReceiptUseCase,
  UploadActivationReceiptUseCase,
} from './activation.use-cases';

@Module({
  imports: [AuthModule],
  controllers: [ActivationController, AdminActivationController],
  providers: [
    ManualTransferEnabledGuard,
    {
      provide: OBJECT_STORAGE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.values.NODE_ENV === 'test'
          ? new MemoryObjectStorage()
          : new S3CompatibleObjectStorage(config.values),
    },
    GetActivationStatusUseCase,
    UploadActivationReceiptUseCase,
    SubmitActivationReceiptUseCase,
    ReadOwnerActivationReceiptUseCase,
    ListActivationReceiptsUseCase,
    GetActivationReceiptReviewUseCase,
    ReadAdminActivationReceiptUseCase,
    DecideActivationReceiptUseCase,
  ],
})
export class ActivationModule {}
