import { Injectable } from '@nestjs/common';
import {
  analyzeCustomerBehavior,
  type AuthenticatedPrincipal,
  type CustomerStatus,
} from '@salon/shared';
import { IntelligenceQueryService } from './intelligence-query.service';
import { INTELLIGENCE_SCAN_BATCH_SIZE } from './intelligence-aggregates';
import { parseSegmentCursor, segmentCursor } from './intelligence-cursor';
import { toSegmentItem } from './intelligence.mapper';
import { INTELLIGENCE_LIST_LIMIT } from './list-opportunities.use-case';

@Injectable()
export class ListCustomerSegmentsUseCase {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async execute(principal: AuthenticatedPrincipal, status?: CustomerStatus, cursor?: string) {
    const { asOf, position } = parseSegmentCursor(cursor, status);
    const items: Array<{
      days: number;
      customerId: string;
      dto: ReturnType<typeof toSegmentItem>;
    }> = [];
    let after = position ? { days: position.days, id: position.customerId } : undefined;

    while (items.length <= INTELLIGENCE_LIST_LIMIT) {
      const rows = await this.intelligence.loadRankedChunk(principal.tenantId, asOf, -1, after);
      if (rows.length === 0) break;
      for (const row of rows) {
        const { behavior, result } = analyzeCustomerBehavior(
          row.behavior,
          this.intelligence.getAnalyzer(),
        );
        if (!this.intelligence.filterByStatus(status, result.status)) continue;
        items.push({
          days: row.rankDays,
          customerId: row.customer.id,
          dto: toSegmentItem(row.customer, behavior, result),
        });
        if (items.length > INTELLIGENCE_LIST_LIMIT) break;
      }
      if (items.length > INTELLIGENCE_LIST_LIMIT || rows.length < INTELLIGENCE_SCAN_BATCH_SIZE) break;
      const last = rows.at(-1)!;
      after = { days: last.rankDays, id: last.customer.id };
    }

    const hasMore = items.length > INTELLIGENCE_LIST_LIMIT;
    const page = items.slice(0, INTELLIGENCE_LIST_LIMIT);
    const last = page.at(-1);
    return {
      items: page.map((item) => item.dto),
      hasMore,
      nextCursor: hasMore && last
        ? segmentCursor(asOf, status, { days: last.days, customerId: last.customerId })
        : null,
    };
  }
}
