import { applyDatabasePoolParams } from './client';

describe('applyDatabasePoolParams', () => {
  it('sets connection_limit and pool_timeout without dropping schema', () => {
    const result = applyDatabasePoolParams(
      'postgresql://salon:salon@localhost:5432/salon?schema=public',
      { connectionLimit: 8, poolTimeoutSeconds: 10 },
    );
    const url = new URL(result);
    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.searchParams.get('connection_limit')).toBe('8');
    expect(url.searchParams.get('pool_timeout')).toBe('10');
  });

  it('leaves the URL unchanged when pool size is not configured', () => {
    const source = 'postgresql://salon:salon@localhost:5432/salon?schema=public';
    const result = applyDatabasePoolParams(source, {});
    expect(new URL(result).searchParams.get('connection_limit')).toBeNull();
  });
});
