import { Prisma } from '@salon/database';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  observedReturnCtes,
  validCommitmentSourceSql,
} from '../recovery-outcomes/eligible-message-evidence.sql';
import type { SalonOverallPerformanceResponseDto } from './salon.dto';

type OverallPerformanceRow = {
  customerCount: number;
  salonCustomerSentMessageCount: number;
  vipSentMessageCount: number;
  agreedReturnCount: number;
  messageAssociatedReturnedCustomerCount: number;
  returningSalonCustomerCount: number;
};

@Injectable()
export class SalonOverallPerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async load(tenantId: string): Promise<SalonOverallPerformanceResponseDto> {
    const rows = await this.prisma.client.$queryRaw<OverallPerformanceRow[]>(Prisma.sql`
      WITH ${observedReturnCtes(tenantId)},
      commitment_backed_customers AS (
        SELECT DISTINCT v.customer_id
        FROM return_commitments c
        INNER JOIN visits v
          ON v.id = c.actual_visit_id AND v.salon_id = c.salon_id
        INNER JOIN message_deliveries d
          ON d.id = c.source_message_delivery_id AND d.salon_id = c.salon_id
        INNER JOIN message_requests r
          ON r.id = c.source_message_request_id AND r.salon_id = c.salon_id
        WHERE c.salon_id = ${tenantId}::uuid
          AND c.actual_visit_id IS NOT NULL
          AND c.customer_id = v.customer_id
          AND ${validCommitmentSourceSql}
          AND v.visited_at > d.submitted_at
      ),
      message_associated_customers AS (
        SELECT customer_id FROM commitment_backed_customers
        UNION
        SELECT customer_id FROM observed
      )
      SELECT
        (SELECT COUNT(*)::int FROM customers WHERE salon_id = ${tenantId}::uuid)
          AS "customerCount",
        (SELECT COUNT(*)::int FROM eligible)
          AS "salonCustomerSentMessageCount",
        (
          SELECT COUNT(*)::int
          FROM message_deliveries d
          INNER JOIN message_requests r
            ON r.id = d.message_request_id AND r.salon_id = d.salon_id
          WHERE d.salon_id = ${tenantId}::uuid
            AND d.status = 'SENT'::"MessageDeliveryStatus"
            AND d.submitted_at IS NOT NULL
            AND r.vip_request_id IS NOT NULL
        ) AS "vipSentMessageCount",
        (SELECT COUNT(*)::int FROM return_commitments WHERE salon_id = ${tenantId}::uuid)
          AS "agreedReturnCount",
        (SELECT COUNT(*)::int FROM message_associated_customers)
          AS "messageAssociatedReturnedCustomerCount",
        (
          SELECT COUNT(*)::int
          FROM (
            SELECT customer_id
            FROM visits
            WHERE salon_id = ${tenantId}::uuid
            GROUP BY customer_id
            HAVING COUNT(*) >= 2
          ) returning_customers
        ) AS "returningSalonCustomerCount"
    `);
    const row = rows[0];
    return {
      customerCount: Number(row?.customerCount ?? 0),
      salonCustomerSentMessageCount: Number(row?.salonCustomerSentMessageCount ?? 0),
      vipSentMessageCount: Number(row?.vipSentMessageCount ?? 0),
      agreedReturnCount: Number(row?.agreedReturnCount ?? 0),
      messageAssociatedReturnedCustomerCount: Number(
        row?.messageAssociatedReturnedCustomerCount ?? 0,
      ),
      returningSalonCustomerCount: Number(row?.returningSalonCustomerCount ?? 0),
    };
  }
}
