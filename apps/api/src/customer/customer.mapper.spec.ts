import { toCustomerResponse } from './customer.mapper';

describe('toCustomerResponse', () => {
  it('maps profile fields without salonId or internal records', () => {
    const response = toCustomerResponse({
      id: '11111111-1111-7111-8111-111111111111',
      firstName: 'Sara',
      lastName: 'Ahmadi',
      phoneNumber: '09121234567',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(response).not.toHaveProperty('salonId');
    expect(response).not.toHaveProperty('status');
    expect(Object.keys(response)).toEqual([
      'id',
      'firstName',
      'lastName',
      'phoneNumber',
      'createdAt',
      'updatedAt',
    ]);
  });
});
