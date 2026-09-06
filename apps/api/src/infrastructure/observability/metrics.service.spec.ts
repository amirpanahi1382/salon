import { MetricsService } from './metrics.service';
import { PrismaService } from '../database/prisma.service';

describe('MetricsService', () => {
  it('renders low-cardinality HTTP metrics without tenant or request IDs', async () => {
    const prisma = {
      client: {
        outboxEvent: {
          groupBy: jest.fn().mockResolvedValue([
            { status: 'PENDING', _count: { _all: 2 } },
            { status: 'DEAD_LETTER', _count: { _all: 1 } },
          ]),
        },
      },
    } as unknown as PrismaService;
    const metrics = new MetricsService(prisma);
    metrics.recordHttpRequest('GET', '/customers/:id', 200, 12);
    metrics.recordHttpRequest('GET', '/customers/:id', 500, 40);

    const text = await metrics.renderPrometheus();
    expect(text).toContain('http_requests_total');
    expect(text).toContain('route="/customers/:id"');
    expect(text).toContain('outbox_events{status="DEAD_LETTER"} 1');
    expect(text).not.toContain('tenant');
    expect(text).not.toContain('userId');
    expect(text).not.toContain('requestId');
  });
});
