import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminSupportController, SalonSupportController } from './support.controller';
import { SupportRepository } from './support.repository';
import {
  GetAdminSupportUseCase,
  GetSalonSupportUseCase,
  ListAdminSupportUseCase,
  PostAdminSupportMessageUseCase,
  PostSalonSupportMessageUseCase,
} from './support.use-cases';

@Module({
  imports: [AuthModule],
  controllers: [SalonSupportController, AdminSupportController],
  providers: [
    SupportRepository,
    GetSalonSupportUseCase,
    PostSalonSupportMessageUseCase,
    ListAdminSupportUseCase,
    GetAdminSupportUseCase,
    PostAdminSupportMessageUseCase,
  ],
})
export class SupportModule {}
