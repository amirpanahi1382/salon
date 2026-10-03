import { Logger } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { ConflictError, InfrastructureError, NotFoundError } from '@salon/shared';
import { HttpExceptionFilter } from './http-exception.filter';

function hostWith(json: jest.Mock, extras: Record<string, unknown> = {}) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status: (code: number) => ({ json: (body: unknown) => json(code, body) }) }),
      getRequest: () => ({
        id: 'req-1',
        headers: {},
        correlationId: 'corr-1',
        user: { tenantId: 'tenant-1', userId: 'user-1', role: 'OWNER' },
        operation: 'CustomerController.get',
        method: 'GET',
        path: '/customers/:id',
        route: { path: '/customers/:id' },
        ...extras,
      }),
    }),
  };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  const synthetic = 'PHONE_FAKE_09120000000 BODY_FAKE_HELLO MONEY_FAKE_1234.56 TOKEN_FAKE_XYZ DBURL_FAKE_postgres OBJECT_FAKE_vip/key';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns INTERNAL_ERROR without Prisma details for unexpected errors', () => {
    const json = jest.fn();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch(new Error('secret-db-host'), hostWith(json) as never);
    expect(json).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR, {
      statusCode: 500,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: 'req-1',
    });
    expect(JSON.stringify(json.mock.calls[0]?.[1])).not.toContain('secret-db-host');
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls[0]);
    expect(logged).not.toContain('secret-db-host');
    expect(logged).toContain('req-1');
    expect(logged).toContain('tenant-1');
    expect(logged).toContain('INTERNAL_ERROR');
    expect(logged).toContain('CustomerController.get');
    expect(logged).not.toContain('Authorization');
  });

  it('keeps synthetic markers out of mapped connector logs and upstream 5xx responses', () => {
    const json = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const connector = new Prisma.PrismaClientKnownRequestError(`connector ${synthetic}`, {
      code: 'P2002', clientVersion: '6.4.1',
    });
    connector.stack = `nested connector ${synthetic}`;
    filter.catch(connector, hostWith(json) as never);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(synthetic);
    expect(JSON.stringify(warn.mock.calls)).toContain('P2002');
    expect(JSON.stringify(warn.mock.calls)).toContain('req-1');
    expect(JSON.stringify(json.mock.calls)).not.toContain(synthetic);

    json.mockClear();
    const upstream = new InfrastructureError(synthetic);
    upstream.stack = `upstream stack ${synthetic}`;
    filter.catch(upstream, hostWith(json) as never);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(synthetic);
    expect(JSON.stringify(json.mock.calls)).not.toContain(synthetic);
    expect(json).toHaveBeenCalledWith(503, expect.objectContaining({
      error: 'INFRASTRUCTURE_ERROR', message: 'A required service is temporarily unavailable',
    }));

    json.mockClear();
    const http = new HttpException({ message: synthetic }, 503);
    http.stack = `http stack ${synthetic}`;
    filter.catch(http, hostWith(json) as never);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(synthetic);
    expect(JSON.stringify(json.mock.calls)).not.toContain(synthetic);
  });

  it('preserves known 4xx response contracts without logging arbitrary error strings', () => {
    const json = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const status of [400, 401, 403, 404, 409, 429]) {
      filter.catch(new HttpException(`known-${status}`, status), hostWith(json) as never);
      expect(json).toHaveBeenLastCalledWith(status, expect.objectContaining({
        statusCode: status, message: `known-${status}`, requestId: 'req-1',
      }));
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain('known-400');
  });

  it('keeps the Phase 8B VIP creator conflict response specific', () => {
    const json = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    filter.catch(new ConflictError('VIP request creator cannot be used for dispatch'), hostWith(json) as never);
    expect(json).toHaveBeenCalledWith(409, {
      statusCode: 409,
      error: 'CONFLICT',
      message: 'VIP request creator cannot be used for dispatch',
      requestId: 'req-1',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('VIP request creator');
  });

  it('does not log connector details inside a recognized financial error', () => {
    const json = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientUnknownRequestError(
      `connector ${synthetic} ERROR: transaction total must equal its nonempty item total`,
      { clientVersion: '6.4.1' },
    );
    error.stack = `nested ${synthetic}`;
    filter.catch(error, hostWith(json) as never);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(synthetic);
    expect(JSON.stringify(json.mock.calls)).not.toContain(synthetic);
    expect(json).toHaveBeenCalledWith(400, expect.objectContaining({ error: 'VALIDATION_ERROR' }));
  });

  it('does not trust an unexpected exception name or malformed Prisma code', () => {
    const json = jest.fn();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const unexpected = new Prisma.PrismaClientKnownRequestError(synthetic, {
      code: synthetic, clientVersion: '6.4.1',
    });
    unexpected.name = synthetic;
    unexpected.stack = `nested ${synthetic}`;
    filter.catch(unexpected, hostWith(json) as never);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(synthetic);
    expect(JSON.stringify(json.mock.calls)).not.toContain(synthetic);
    expect(json).toHaveBeenCalledWith(500, expect.objectContaining({ error: 'INTERNAL_ERROR' }));
  });

  it('does not fall back to an unsafe request ID header before request context is ready', () => {
    const json = jest.fn();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch(new Error(synthetic), hostWith(json, {
      id: undefined, headers: { 'x-request-id': synthetic },
    }) as never);
    const serialized = JSON.stringify([json.mock.calls, errorLog.mock.calls]);
    expect(serialized).not.toContain(synthetic);
    expect(json.mock.calls[0]?.[1]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('maps unique conflicts to CONFLICT', () => {
    const json = jest.fn();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: '6.4.1',
    });
    filter.catch(error, hostWith(json) as never);
    expect(json).toHaveBeenCalledWith(
      HttpStatus.CONFLICT,
      expect.objectContaining({ error: 'CONFLICT' }),
    );
  });

  it('does not leak internals for AppError not-found', () => {
    const json = jest.fn();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    filter.catch(new NotFoundError('Resource not found'), hostWith(json) as never);
    expect(json).toHaveBeenCalledWith(
      HttpStatus.NOT_FOUND,
      expect.objectContaining({ error: 'NOT_FOUND', requestId: 'req-1' }),
    );
  });

  it('maps infrastructure failures to INFRASTRUCTURE_ERROR', () => {
    const json = jest.fn();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch(new InfrastructureError('Outbound request timed out'), hostWith(json) as never);
    expect(json).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
      expect.objectContaining({ error: 'INFRASTRUCTURE_ERROR' }),
    );
  });

  it('returns a stable payload-free response for a Phase 9 aggregate failure', () => {
    const json = jest.fn();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientUnknownRequestError(
      'Error in connector: ERROR: transaction total must equal its nonempty item total',
      { clientVersion: '6.4.1' },
    );
    filter.catch(error, hostWith(json, { method: 'POST', path: '/transactions' }) as never);
    expect(json).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST, {
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'Sum of item totals must equal the transaction amount',
      requestId: 'req-1',
    });
    const response = JSON.stringify(json.mock.calls[0]?.[1]);
    expect(response).not.toContain('connector');
    expect(response).not.toContain('23514');
    expect(response).not.toMatch(/\d+\.\d{2}/);
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toMatch(/\d+\.\d{2}/);
  });

  it('treats an unsupported isolation guard as an internal configuration failure', () => {
    const json = jest.fn();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientUnknownRequestError(
      'Error in connector: ERROR: financial writes require read committed isolation',
      { clientVersion: '6.4.1' },
    );
    filter.catch(error, hostWith(json, { method: 'POST', path: '/transactions' }) as never);
    expect(json).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR, {
      statusCode: 500,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: 'req-1',
    });
    expect(JSON.stringify(json.mock.calls[0]?.[1])).not.toContain('isolation');
  });
});
