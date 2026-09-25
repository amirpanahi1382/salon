import { Injectable } from '@nestjs/common';
import {
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  utcNow,
  type AuthenticatedPrincipal,
  resolveOwnerBusinessWeek,
} from '@salon/shared';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import type { ListRecoveryOutcomeReturnsQueryDto } from './recovery-outcomes.dto';
import {
  RECOVERY_OUTCOME_RETURN_LIST_LIMIT,
  RecoveryOutcomesRepository,
} from './recovery-outcomes.repository';

@Injectable()
export class ListRecoveryOutcomeReturnsUseCase {
  constructor(private readonly outcomes: RecoveryOutcomesRepository) {}

  async execute(principal: AuthenticatedPrincipal, query: ListRecoveryOutcomeReturnsQueryDto) {
    const week = resolveOwnerBusinessWeek(query.weekStart, utcNow());
    const cursor = parseVisitCursor(query.cursor);
    const rows =
      query.kind === COMMITMENT_BACKED_ASSOCIATION_KIND
        ? await this.outcomes.listCommitmentBackedReturns(principal.tenantId, week, cursor)
        : await this.outcomes.listObservedOnlyReturns(principal.tenantId, week, cursor);

    return toListPage(rows, RECOVERY_OUTCOME_RETURN_LIST_LIMIT, (item) =>
      encodeCursor([item.visitedAt, item.visitId]),
    );
  }
}

function parseVisitCursor(cursor?: string) {
  const parts = decodeCursor(cursor, 2);
  if (!parts) {
    return undefined;
  }
  return { visitedAt: parseCursorInstant(parts[0]!), visitId: parseCursorUuid(parts[1]!) };
}
