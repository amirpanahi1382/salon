import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GetCustomerIntelligenceUseCase } from './get-customer-intelligence.use-case';
import { GetIntelligenceSummaryUseCase } from './get-intelligence-summary.use-case';
import { IntelligenceQueryService } from './intelligence-query.service';
import { IntelligenceController } from './intelligence.controller';
import { ListCustomerSegmentsUseCase } from './list-customer-segments.use-case';
import { ListOpportunitiesUseCase } from './list-opportunities.use-case';
import { ListRevenueDropsUseCase } from './list-revenue-drops.use-case';

@Module({
  imports: [AuthModule],
  controllers: [IntelligenceController],
  providers: [
    IntelligenceQueryService,
    GetCustomerIntelligenceUseCase,
    ListOpportunitiesUseCase,
    ListCustomerSegmentsUseCase,
    GetIntelligenceSummaryUseCase,
    ListRevenueDropsUseCase,
  ],
  exports: [IntelligenceQueryService],
})
export class IntelligenceModule {}
