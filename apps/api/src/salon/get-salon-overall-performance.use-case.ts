import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { SalonOverallPerformanceRepository } from './salon-overall-performance.repository';
import type { SalonOverallPerformanceResponseDto } from './salon.dto';

@Injectable()
export class GetSalonOverallPerformanceUseCase {
  constructor(private readonly overallPerformance: SalonOverallPerformanceRepository) {}

  execute(principal: AuthenticatedPrincipal): Promise<SalonOverallPerformanceResponseDto> {
    return this.overallPerformance.load(principal.tenantId);
  }
}
