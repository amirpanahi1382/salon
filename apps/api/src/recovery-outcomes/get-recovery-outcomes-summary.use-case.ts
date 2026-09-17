import { Injectable } from '@nestjs/common';
import {
  OWNER_REPORTING_TIMEZONE,
  utcNow,
  type AuthenticatedPrincipal,
  resolveOwnerBusinessWeek,
  shiftOwnerBusinessWeek,
} from '@salon/shared';
import type { RecoveryOutcomesQueryDto, RecoveryOutcomesSummaryDto } from './recovery-outcomes.dto';
import { RecoveryOutcomesRepository } from './recovery-outcomes.repository';

@Injectable()
export class GetRecoveryOutcomesSummaryUseCase {
  constructor(private readonly outcomes: RecoveryOutcomesRepository) {}

  async execute(
    principal: AuthenticatedPrincipal,
    query: RecoveryOutcomesQueryDto,
  ): Promise<RecoveryOutcomesSummaryDto> {
    const now = utcNow();
    const week = resolveOwnerBusinessWeek(query.weekStart, now);
    const current = resolveOwnerBusinessWeek(undefined, now);
    const previous = shiftOwnerBusinessWeek(week, -1);
    const next = shiftOwnerBusinessWeek(week, 1);

    const [sent, returnCommitmentsRecorded, commitmentBacked, observedReturns] = await Promise.all([
      this.outcomes.countSentFollowUps(principal.tenantId, week),
      this.outcomes.countReturnCommitmentsRecorded(principal.tenantId, week),
      this.outcomes.commitmentBackedRevenue(principal.tenantId, week),
      this.outcomes.countObservedOnlyReturns(principal.tenantId, week),
    ]);

    return {
      period: {
        timezone: OWNER_REPORTING_TIMEZONE,
        start: week.start.toISOString(),
        end: week.end.toISOString(),
        previousWeekStart: previous.start.toISOString(),
        nextWeekStart: next.start.toISOString(),
        current: week.start.getTime() === current.start.getTime(),
      },
      sentFollowUps: sent.sentCount,
      returnCommitmentsRecorded,
      commitmentBackedReturns: commitmentBacked.visitCount,
      commitmentBackedRecordedRevenue: commitmentBacked.revenue,
      observedReturns,
      messagingExecution: {
        medianRequestToSentLatencyMs: sent.medianMs,
      },
    };
  }
}
