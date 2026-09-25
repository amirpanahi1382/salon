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

  it('does not import the 5,000-customer intelligence scan', () => {
    expect(repositorySource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(repositorySource).not.toContain('intelligence-aggregates');
    expect(repositorySource).not.toContain('loadSalonBehaviorRows');
    expect(useCaseSource).not.toContain('IntelligenceQueryService');
    expect(useCaseSource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(moduleSource).not.toContain('IntelligenceModule');
  });
});
