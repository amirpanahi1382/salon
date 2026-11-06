import { assertCanonicalDatabase } from './assert-canonical-database';

const expected = {
  databaseName: 'salon-db',
  systemIdentifier: '7700113693112733735',
  databaseComment: 'phone-first-empty:20261024T061347Z',
};

function client(rows: unknown[] | Error) {
  return {
    $queryRaw: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)),
  };
}

describe('assertCanonicalDatabase', () => {
  it('accepts the expected identity tuple', async () => {
    await expect(
      assertCanonicalDatabase(client([{
        database_name: expected.databaseName,
        system_identifier: expected.systemIdentifier,
        database_comment: expected.databaseComment,
      }]) as never, expected),
    ).resolves.toBeUndefined();
  });

  it('rejects each mismatched identity field and an unreadable function without exposing its error', async () => {
    await expect(
      assertCanonicalDatabase(client([{
        database_name: 'salon_opp_integrity_20261024',
        system_identifier: expected.systemIdentifier,
        database_comment: expected.databaseComment,
      }]) as never, expected),
    ).rejects.toThrow(/does not match/);
    await expect(
      assertCanonicalDatabase(client([{
        database_name: expected.databaseName,
        system_identifier: '1',
        database_comment: expected.databaseComment,
      }]) as never, expected),
    ).rejects.toThrow(/does not match/);
    await expect(
      assertCanonicalDatabase(client([{
        database_name: expected.databaseName,
        system_identifier: expected.systemIdentifier,
        database_comment: 'other',
      }]) as never, expected),
    ).rejects.toThrow(/does not match/);
    await expect(
      assertCanonicalDatabase(client(new Error('permission denied')) as never, expected),
    ).rejects.toThrow(/could not be read/);
  });

  it('rejects incomplete canonical configuration before querying', async () => {
    const query = jest.fn();
    await expect(
      assertCanonicalDatabase({ $queryRaw: query } as never, {
        ...expected,
        databaseComment: '',
      }),
    ).rejects.toThrow(/identity is incomplete/);
    expect(query).not.toHaveBeenCalled();
  });
});
