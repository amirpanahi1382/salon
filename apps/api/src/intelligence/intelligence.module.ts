import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { VisitModule } from '../visit/visit.module';
import { GetCustomerIntelligenceUseCase } from './get-customer-intelligence.use-case';
import { GetIntelligenceSummaryUseCase } from './get-intelligence-summary.use-case';
import { IntelligenceQueryService } from './intelligence-query.service';
import { IntelligenceController } from './intelligence.controller';
import { ListCustomerSegmentsUseCase } from './list-customer-segments.use-case';
import { ListOpportunitiesUseCase } from './list-opportunities.use-case';

@Module({
  imports: [AuthModule, CustomerModule, VisitModule],
  controllers: [IntelligenceController],
  providers: [
    IntelligenceQueryService,
    GetCustomerIntelligenceUseCase,
    ListOpportunitiesUseCase,
    ListCustomerSegmentsUseCase,
    GetIntelligenceSummaryUseCase,
  ],
})
export class IntelligenceModule {}
