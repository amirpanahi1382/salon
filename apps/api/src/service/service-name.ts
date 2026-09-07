import { ValidationError } from '@salon/shared';

export const SERVICE_NAME_MAX_LENGTH = 80;

export function normalizeServiceName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new ValidationError('name is required');
  }
  if (name.length > SERVICE_NAME_MAX_LENGTH) {
    throw new ValidationError('name must be at most 80 characters');
  }
  return name;
}
