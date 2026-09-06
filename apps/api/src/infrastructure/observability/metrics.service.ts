import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const HTTP_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

type CounterKey = string;

@Injectable()
export class MetricsService {
  private readonly httpRequests = new Map<CounterKey, number>();
  private readonly httpDurationCount = new Map<CounterKey, number>();
  private readonly httpDurationSum = new Map<CounterKey, number>();
  private readonly httpDurationBuckets = new Map<CounterKey, number[]>();

  constructor(private readonly prisma: PrismaService) {}

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const safeRoute = sanitizeRoute(route);
    const safeMethod = method.toUpperCase();
    const status = String(statusCode);
    const labels = labelsKey({ method: safeMethod, route: safeRoute, status });
    this.httpRequests.set(labels, (this.httpRequests.get(labels) ?? 0) + 1);

    const histKey = labelsKey({ method: safeMethod, route: safeRoute });
    this.httpDurationCount.set(histKey, (this.httpDurationCount.get(histKey) ?? 0) + 1);
    this.httpDurationSum.set(histKey, (this.httpDurationSum.get(histKey) ?? 0) + durationMs);
    const buckets = this.httpDurationBuckets.get(histKey) ?? HTTP_BUCKETS_MS.map(() => 0);
    for (let i = 0; i < HTTP_BUCKETS_MS.length; i += 1) {
      const bound = HTTP_BUCKETS_MS[i];
      if (bound !== undefined && durationMs <= bound) {
        buckets[i] = (buckets[i] ?? 0) + 1;
      }
    }
    this.httpDurationBuckets.set(histKey, buckets);
  }

  async renderPrometheus(): Promise<string> {
    const lines: string[] = [];
    lines.push('# HELP http_requests_total HTTP requests handled by this API process');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, value] of this.httpRequests) {
      lines.push(`http_requests_total{${key}} ${value}`);
    }

    lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds');
    lines.push('# TYPE http_request_duration_ms histogram');
    for (const [key, count] of this.httpDurationCount) {
      const buckets = this.httpDurationBuckets.get(key) ?? HTTP_BUCKETS_MS.map(() => 0);
      const sum = this.httpDurationSum.get(key) ?? 0;
      for (let i = 0; i < HTTP_BUCKETS_MS.length; i += 1) {
        lines.push(
          `http_request_duration_ms_bucket{${key},le="${HTTP_BUCKETS_MS[i]}"} ${buckets[i] ?? 0}`,
        );
      }
      lines.push(`http_request_duration_ms_bucket{${key},le="+Inf"} ${count}`);
      lines.push(`http_request_duration_ms_sum{${key}} ${sum}`);
      lines.push(`http_request_duration_ms_count{${key}} ${count}`);
    }

    const outbox = await this.outboxCounts();
    lines.push('# HELP outbox_events Outbox rows by status (database, not this process)');
    lines.push('# TYPE outbox_events gauge');
    for (const [status, count] of Object.entries(outbox)) {
      lines.push(`outbox_events{status="${status}"} ${count}`);
    }

    return `${lines.join('\n')}\n`;
  }

  private async outboxCounts(): Promise<Record<string, number>> {
    const counts = {
      PENDING: 0,
      PROCESSING: 0,
      PROCESSED: 0,
      DEAD_LETTER: 0,
    };
    try {
      const rows = await this.prisma.client.outboxEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      for (const row of rows) {
        counts[row.status] = row._count._all;
      }
    } catch {
      // Metrics must not fail the scrape when the database is down.
    }
    return counts;
  }
}

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(',');
}

function sanitizeRoute(route: string): string {
  const trimmed = route.split('?')[0] ?? 'unknown';
  if (trimmed.length === 0 || trimmed.length > 120) {
    return 'unknown';
  }
  return trimmed.replace(/\\/g, '/').replace(/"/g, '');
}
