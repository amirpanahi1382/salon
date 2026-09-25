import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('admin VIP outreach serving path', () => {
  const repositorySource = readFileSync(
    join(__dirname, 'admin-vip-outreach.repository.ts'),
    'utf8',
  );
  const useCaseSource = readFileSync(join(__dirname, 'admin-vip-outreach.use-cases.ts'), 'utf8');
  const controllerSource = readFileSync(join(__dirname, 'admin-vip.controller.ts'), 'utf8');

  it('is a derived salonId grouping, not a persisted folder table', () => {
    expect(repositorySource).not.toContain('vipFolder');
    expect(repositorySource).not.toContain('vip_folders');
    expect(useCaseSource).not.toContain('vipFolder');
    expect(repositorySource).toContain('GROUP BY r.salon_id');
    expect(repositorySource).toContain('FROM vip_requests r');
  });

  it('aggregates folder counts in SQL instead of loading recipients in Node', () => {
    expect(repositorySource).toContain('$queryRaw');
    expect(repositorySource).toContain("FILTER (WHERE ${EXECUTION_SQL} = 'SENT')");
    expect(repositorySource).not.toContain('findMany({');
    expect(useCaseSource).not.toContain('listContacts');
  });

  it('does not invent a second dispatch write path', () => {
    expect(controllerSource).toContain('outreach/salons');
    expect(controllerSource).toContain('dispatch-manual');
    expect(useCaseSource).not.toContain('messageRequest.create');
    expect(useCaseSource).not.toContain('DispatchVipRequestUseCase');
  });
});
