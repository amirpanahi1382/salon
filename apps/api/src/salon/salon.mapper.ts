import type { SalonProfileResponseDto } from './salon.dto';

export function toSalonProfileResponse(salon: {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
  updatedAt: Date;
}): SalonProfileResponseDto {
  return {
    id: salon.id,
    name: salon.name,
    phone: salon.phone,
    address: salon.address,
    status: salon.status,
    createdAt: salon.createdAt.toISOString(),
    updatedAt: salon.updatedAt.toISOString(),
  };
}
