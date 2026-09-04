import type { CustomerResponseDto } from './customer.dto';

export const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toCustomerResponse(customer: {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
}): CustomerResponseDto {
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phoneNumber: customer.phoneNumber,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}
