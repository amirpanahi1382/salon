import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('salon overall performance serving path', () => {
  const repositorySource = readFileSync(
    join(__dirname, 'salon-overall-performance.repository.ts'),
    'utf8',
  );
  const useCaseSource = readFileSync(
    join(__dirname, 'get-salon-overall-performance.use-case.ts'),
    'utf8',
  );
  const moduleSource = readFileSync(join(__dirname, 'salon.module.ts'), 'utf8');

  it('sums submitted VIP requested counts and formats revenue as text', () => {
    expect(repositorySource).toContain('SUM(requested_count)');
    expect(repositorySource).toContain("'SUBMITTED'::\"VipRequestStatus\"");
    expect(repositorySource).toContain("'MANUAL_QUEUED'::\"VipRequestStatus\"");
    expect(repositorySource).toContain("'BALE_NOT_IMPLEMENTED'::\"VipRequestStatus\"");
    expect(repositorySource).not.toContain('vip_request_id IS NOT NULL)\n          AS "vipMessageRequestCount"');
    expect(repositorySource).toContain('::numeric(19,2)::text');
    expect(repositorySource).toContain('formatExactMoneyText');
    expect(repositorySource).toContain('operationallyOpenReturnCommitmentSql');
    expect(repositorySource).toContain('openVisitIntentionSql');
    expect(repositorySource).not.toContain('FROM return_commitments WHERE salon_id');
    expect(repositorySource).not.toContain('parseFloat');
    expect(repositorySource).not.toContain('Number(row?.monthlyRecordedRevenueIrr');
  });

  it('does not import the 5,000-customer intelligence scan', () => {
    expect(repositorySource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(repositorySource).not.toContain('intelligence-aggregates');
    expect(repositorySource).not.toContain('loadSalonBehaviorRows');
    expect(useCaseSource).not.toContain('IntelligenceQueryService');
    expect(useCaseSource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(moduleSource).not.toContain('IntelligenceModule');
  });
});
