import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgreementAcceptanceEnabledGuard } from './agreement-enabled.guard';
import { AdminAgreementController, AgreementController } from './agreement.controller';
import {
  AcceptAgreementUseCase,
  AgreementDocumentUseCase,
  AgreementReceiptUseCase,
  ExportAgreementEvidenceUseCase,
  GetCurrentAgreementUseCase,
  PresentAgreementUseCase,
  PublishAgreementVersionUseCase,
} from './agreement.use-cases';

@Module({
  imports: [AuthModule],
  controllers: [AgreementController, AdminAgreementController],
  providers: [
    AgreementAcceptanceEnabledGuard,
    PublishAgreementVersionUseCase,
    GetCurrentAgreementUseCase,
    PresentAgreementUseCase,
    AcceptAgreementUseCase,
    AgreementReceiptUseCase,
    AgreementDocumentUseCase,
    ExportAgreementEvidenceUseCase,
  ],
})
export class AgreementModule {}
