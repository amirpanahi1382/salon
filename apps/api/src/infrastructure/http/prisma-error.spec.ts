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
});
