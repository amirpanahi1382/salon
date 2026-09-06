import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { ShutdownState } from './shutdown-state';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [MetricsController],
  providers: [ShutdownState, MetricsService],
  exports: [ShutdownState, MetricsService],
})
export class ObservabilityModule {}
