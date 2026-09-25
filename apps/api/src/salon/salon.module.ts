import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GetSalonProfileUseCase } from './get-salon-profile.use-case';
import { GetSalonOverallPerformanceUseCase } from './get-salon-overall-performance.use-case';
import { SalonController } from './salon.controller';
import { SalonOverallPerformanceRepository } from './salon-overall-performance.repository';
import { UpdateSalonProfileUseCase } from './update-salon-profile.use-case';

@Module({
  imports: [AuthModule],
  controllers: [SalonController],
  providers: [
    GetSalonProfileUseCase,
    UpdateSalonProfileUseCase,
    GetSalonOverallPerformanceUseCase,
    SalonOverallPerformanceRepository,
  ],
})
export class SalonModule {}
