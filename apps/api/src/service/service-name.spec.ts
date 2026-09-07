import { ValidationError } from '@salon/shared';
import { normalizeServiceName } from './service-name';

describe('normalizeServiceName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeServiceName('  Hair Botox  ')).toBe('Hair Botox');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(() => normalizeServiceName('')).toThrow(ValidationError);
    expect(() => normalizeServiceName('   ')).toThrow(ValidationError);
  });
});
