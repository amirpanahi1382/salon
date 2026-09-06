import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ShutdownState } from '../infrastructure/observability/shutdown-state';

describe('HealthController', () => {
  let app: INestApplication;
  let queryRaw: jest.Mock;
  let shutdown: ShutdownState;

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue(1);
    shutdown = new ShutdownState();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        ShutdownState,
        {
          provide: PrismaService,
          useValue: { client: { $queryRaw: queryRaw } },
        },
        {
          provide: AppConfigService,
          useValue: { values: { HEALTH_CHECK_TIMEOUT_MS: 200 } },
        },
      ],
    })
      .overrideProvider(ShutdownState)
      .useValue(shutdown)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps liveness available when postgres is down', async () => {
    queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('returns 503 from readiness when postgres is down', async () => {
    queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.postgres).toBe('down');
    expect(response.body.checks.redis).toBeUndefined();
    expect(response.body.checks.objectStorage).toBeUndefined();
  });

  it('returns 503 from readiness while shutting down', async () => {
    shutdown.markDraining();
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.reason).toBe('shutting_down');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
