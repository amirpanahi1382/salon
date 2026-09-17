import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('recovery outcomes serving path', () => {
  const repositorySource = readFileSync(join(__dirname, 'recovery-outcomes.repository.ts'), 'utf8');
  const moduleSource = readFileSync(join(__dirname, 'recovery-outcomes.module.ts'), 'utf8');
  const useCaseSource = readFileSync(
    join(__dirname, 'get-recovery-outcomes-summary.use-case.ts'),
    'utf8',
  );

  it('does not import the 5,000-customer intelligence scan', () => {
    expect(repositorySource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(repositorySource).not.toContain('intelligence-aggregates');
    expect(repositorySource).not.toContain('loadSalonBehaviorRows');
    expect(moduleSource).not.toContain('IntelligenceModule');
    expect(useCaseSource).not.toContain('IntelligenceQueryService');
    expect(useCaseSource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
  });
});
