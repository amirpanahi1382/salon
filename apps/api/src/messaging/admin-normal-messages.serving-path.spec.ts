import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('admin normal message folder serving path', () => {
  const repositorySource = readFileSync(
    join(__dirname, 'admin-normal-messages.repository.ts'),
    'utf8',
  );
  const useCaseSource = readFileSync(join(__dirname, 'admin-normal-messages.use-cases.ts'), 'utf8');
  const controllerSource = readFileSync(
    join(__dirname, 'admin-normal-messages.controller.ts'),
    'utf8',
  );

  it('is a derived salonId grouping, not a persisted folder table', () => {
    expect(repositorySource).not.toContain('messageFolder');
    expect(repositorySource).not.toContain('message_folders');
    expect(useCaseSource).not.toContain('messageFolder');
    expect(repositorySource).toContain('GROUP BY s.id, s.name');
    expect(repositorySource).toContain('vip_request_id IS NULL');
    expect(repositorySource).toContain('customer_id IS NOT NULL');
  });

  it('aggregates folder counts in SQL instead of grouping in Node', () => {
    expect(repositorySource).toContain('$queryRaw');
    expect(repositorySource).toContain("FILTER (WHERE ${EXECUTION_SQL} = 'SENT')");
    expect(useCaseSource).not.toContain('groupBy');
  });

  it('exposes platform-admin salon folder routes without a second write path', () => {
    expect(controllerSource).toContain('admin/messages/normal');
    expect(controllerSource).toContain('salons/:salonId');
    expect(useCaseSource).not.toContain('messageRequest.create');
    expect(useCaseSource).not.toContain('messageRequest.update');
  });
});
