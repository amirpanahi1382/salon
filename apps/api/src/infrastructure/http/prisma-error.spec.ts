import { Prisma } from '@salon/database';
import { ConflictError, NotFoundError, ValidationError } from '@salon/shared';
import { mapPrismaError } from './prisma-error';

function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError('db', {
    code,
    clientVersion: '6.4.1',
  });
}

describe('mapPrismaError', () => {
  it('maps unique conflicts to 409', () => {
    const mapped = mapPrismaError(known('P2002'));
    expect(mapped).toBeInstanceOf(ConflictError);
    expect(mapped?.code).toBe('CONFLICT');
  });

  it('maps foreign-key failures to 409 by default', () => {
    const mapped = mapPrismaError(known('P2003'));
    expect(mapped).toBeInstanceOf(ConflictError);
    expect(mapped?.statusCode).toBe(409);
  });

  it('maps missing records to 404', () => {
    expect(mapPrismaError(known('P2025'))).toBeInstanceOf(NotFoundError);
  });

  it('maps invalid UUID/column data to 400', () => {
    expect(mapPrismaError(known('P2023'))).toBeInstanceOf(ValidationError);
  });

  it('leaves unexpected errors unmapped', () => {
    expect(mapPrismaError(known('P1001'))).toBeUndefined();
    expect(mapPrismaError(new Error('boom'))).toBeUndefined();
  });

  it('maps only recognized payload-free money trigger failures', () => {
    const error = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, {
      clientVersion: '6.4.1',
    });
    expect(mapPrismaError(error('Error in connector: ERROR: transaction total must equal its nonempty item total'))).toBeInstanceOf(ValidationError);
    expect(mapPrismaError(error('Error in connector: ERROR: transaction item total must equal quantity times unit price'))).toBeInstanceOf(ValidationError);
    expect(mapPrismaError(error('ConnectorError(QueryError(PostgresError { code: "23514", message: "transaction item total must equal quantity times unit price", severity: "ERROR" }))'))).toBeInstanceOf(ValidationError);
    expect(mapPrismaError(error('ConnectorError(QueryError(PostgresError { code: "23503", message: "transaction item total must equal quantity times unit price", severity: "ERROR" }))'))).toBeUndefined();
    expect(mapPrismaError(error('Error in connector: ERROR: another constraint failed'))).toBeUndefined();
    expect(mapPrismaError(error('ERROR: prefix transaction item total must equal quantity times unit price suffix'))).toBeUndefined();
    expect(mapPrismaError(error('Error in connector: ERROR: financial writes require read committed isolation'))).toBeUndefined();
  });

  it('maps database statement, lock, and idle timeouts to 503', () => {
    const statement = new Prisma.PrismaClientKnownRequestError(
      'canceling statement due to statement timeout',
      { code: 'P2010', clientVersion: '6.4.1' },
    );
    const lock = new Prisma.PrismaClientUnknownRequestError(
      'ERROR: canceling statement due to lock timeout (SQLSTATE 55P03)',
      { clientVersion: '6.4.1' },
    );
    const idle = new Prisma.PrismaClientUnknownRequestError(
      'ERROR: terminating connection due to idle-in-transaction timeout (SQLSTATE 25P03)',
      { clientVersion: '6.4.1' },
    );
    expect(mapPrismaError(statement)?.code).toBe('INFRASTRUCTURE_ERROR');
    expect(mapPrismaError(lock)?.statusCode).toBe(503);
    expect(mapPrismaError(idle)?.message).toBe('The database transaction idle timeout elapsed');
  });
});
