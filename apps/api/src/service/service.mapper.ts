import type { Service } from '@salon/database';
import type { ServiceResponseDto } from './service.dto';

export const SERVICE_SELECT = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toServiceResponse(
  row: Pick<Service, 'id' | 'name' | 'status' | 'createdAt' | 'updatedAt'>,
): ServiceResponseDto {
  return {
    id: row.id,
    name: row.name.trim(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
