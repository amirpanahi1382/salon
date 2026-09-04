export function normalizeCustomerPhone(phone: string): string {
  return phone.trim();
}

export function isUsableCustomerPhone(phone: string): boolean {
  return normalizeCustomerPhone(phone).length >= 8;
}
