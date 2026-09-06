import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreateServiceUseCase } from './create-service.use-case';
import { ListServicesUseCase } from './list-services.use-case';
import { ServiceController } from './service.controller';
import { ServiceRepository } from './service.repository';
import { UpdateServiceUseCase } from './update-service.use-case';

@Module({
  imports: [AuthModule],
  controllers: [ServiceController],
  providers: [ServiceRepository, CreateServiceUseCase, ListServicesUseCase, UpdateServiceUseCase],
  exports: [ServiceRepository],
})
export class ServiceModule {}
