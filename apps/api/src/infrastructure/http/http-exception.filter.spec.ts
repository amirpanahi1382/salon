import { Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { InfrastructureError, NotFoundError } from '@salon/shared';
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
    expect(logged).toContain('secret-db-host');
    expect(logged).toContain('req-1');
    expect(logged).toContain('tenant-1');
    expect(logged).not.toContain('Authorization');
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
