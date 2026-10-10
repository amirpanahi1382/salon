import { sanitizePrismaLogEvent } from './client';

const marker = 'SUPPORT_LOG_MARKER_q7m4';

describe('sanitizePrismaLogEvent', () => {
  it('keeps the code and operation from a raw check failure and drops the row text', () => {
    const message = [
      'Invalid `prisma.$executeRaw()` invocation:',
      '',
      'Raw query failed. Code: `23514`. Message: `ERROR: new row for relation "support_messages" violates check constraint "support_messages_author_xor_chk"',
      `DETAIL: Failing row contains (fceebb71-de86-4418-baad-6ae6f4e425c1, ${marker}, 2026-10-10 15:25:40.389+00).\``,
    ].join('\n');

    const sanitized = sanitizePrismaLogEvent(message, 'client');

    expect(sanitized).toEqual({
      target: 'client',
      operation: '$executeRaw',
      code: '23514',
    });
    expect(JSON.stringify(sanitized)).not.toContain(marker);
  });

  it('keeps the code and operation from a Prisma create connector error and drops the row text', () => {
    const message = [
      'Invalid `prisma.supportMessage.create()` invocation:',
      '',
      'Error occurred during query execution:',
      'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row violates check constraint", severity: "ERROR", detail: Some("Failing row contains (id, ' +
        marker +
        ')."), column: None, hint: None }), transient: false })',
    ].join('\n');

    const sanitized = sanitizePrismaLogEvent(message, 'client');

    expect(sanitized).toEqual({
      target: 'client',
      operation: 'supportMessage.create',
      code: '23514',
    });
    expect(JSON.stringify(sanitized)).not.toContain(marker);
    expect(JSON.stringify(sanitized)).not.toContain('ConnectorError');
    expect(JSON.stringify(sanitized)).not.toContain('Failing row');
  });

  it('uses the Prisma event target as the operation when the message has no invocation line', () => {
    const message = [
      'Error occurred during query execution:',
      'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "check constraint", severity: "ERROR", detail: Some("Failing row contains (' +
        marker +
        ')."), column: None, hint: None }), transient: false })',
    ].join('\n');

    expect(sanitizePrismaLogEvent(message, 'supportMessage.create')).toEqual({
      operation: 'supportMessage.create',
      code: '23514',
    });
    expect(JSON.stringify(sanitizePrismaLogEvent(message, 'supportMessage.create'))).not.toContain(marker);
  });

  it('does not read an error code planted in the rejected row', () => {
    const message = [
      'Invalid `prisma.supportMessage.create()` invocation:',
      'Query failed without a structured code.',
      `detail: Failing row contains (${marker} code: "99999").`,
    ].join('\n');

    const sanitized = sanitizePrismaLogEvent(message, 'not a safe target');

    expect(sanitized).toEqual({ operation: 'supportMessage.create' });
    expect(JSON.stringify(sanitized)).not.toContain(marker);
    expect(JSON.stringify(sanitized)).not.toContain('99999');
  });
});
