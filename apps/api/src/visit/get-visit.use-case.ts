import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { VisitRepository } from './visit.repository';
import { toVisitResponse } from './visit.mapper';

@Injectable()
export class GetVisitUseCase {
  constructor(private readonly visits: VisitRepository) {}

  async execute(principal: AuthenticatedPrincipal, visitId: string) {
    const visit = await this.visits.findById(principal.tenantId, visitId);
    if (!visit) {
      throw new NotFoundError('Visit not found');
    }
    return toVisitResponse(visit);
  }
}
