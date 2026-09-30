import { Prisma } from '@salon/database';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AppError,
} from '@salon/shared';

/**
 * Maps expected Prisma failures to stable AppErrors.
 * P2003 defaults to 409 (related rows prevent the write). Visit insert maps
 * P2003 to 404 because the parent customer is gone.
 */
export function mapPrismaError(error: unknown): AppError | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return new ConflictError('A conflicting record already exists');
      case 'P2003':
        // Default: related rows prevent the write (e.g. delete blocked by children).
        // Visit insert maps P2003 to 404 because the parent customer is gone.
        return new ConflictError('Related records prevent this change');
      case 'P2025':
        return new NotFoundError('Record not found');
      case 'P2023':
      case 'P2020':
        return new ValidationError('Invalid identifier');
      default:
        return undefined;
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new ValidationError('Invalid request data');
  }

  // Prisma 6 reports deferred PostgreSQL constraint-trigger failures at
  // interactive transaction commit as UnknownRequestError, without SQLSTATE
  // or constraint metadata. Match only this fixed, payload-free DB message.
  if (error instanceof Prisma.PrismaClientUnknownRequestError &&
      error.message.endsWith('ERROR: transaction total must equal its nonempty item total')) {
    return new ValidationError('Sum of item totals must equal the transaction amount');
  }
  const itemMathMessage = 'transaction item total must equal quantity times unit price';
  if (error instanceof Prisma.PrismaClientUnknownRequestError &&
      (error.message.endsWith(`ERROR: ${itemMathMessage}`) ||
        error.message.includes(
          `PostgresError { code: "23514", message: "${itemMathMessage}",`,
        ))) {
    return new ValidationError('Item total must equal quantity times unit price');
  }

  return undefined;
}

export function rethrowMappedPrisma(error: unknown): never {
  const mapped = mapPrismaError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}
