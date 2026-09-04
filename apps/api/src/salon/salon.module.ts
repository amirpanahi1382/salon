import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GetSalonProfileUseCase } from './get-salon-profile.use-case';
import { SalonController } from './salon.controller';
import { UpdateSalonProfileUseCase } from './update-salon-profile.use-case';

@Module({
  imports: [AuthModule],
  controllers: [SalonController],
  providers: [GetSalonProfileUseCase, UpdateSalonProfileUseCase],
})
export class SalonModule {}
