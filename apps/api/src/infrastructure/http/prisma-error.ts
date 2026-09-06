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

  return undefined;
}

export function rethrowMappedPrisma(error: unknown): never {
  const mapped = mapPrismaError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}
