import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('opportunities workspace serving path', () => {
  const repositorySource = readFileSync(
    join(__dirname, 'opportunities-workspace.repository.ts'),
    'utf8',
  );
  const useCaseSource = readFileSync(join(__dirname, 'get-opportunities-workspace.use-case.ts'), 'utf8');
  const moduleSource = readFileSync(join(__dirname, 'opportunities.module.ts'), 'utf8');
  const controllerSource = readFileSync(join(__dirname, 'opportunities.controller.ts'), 'utf8');

  it('does not import the 5,000-customer intelligence scan', () => {
    expect(repositorySource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(repositorySource).not.toContain('intelligence-aggregates');
    expect(repositorySource).not.toContain('loadSalonBehaviorRows');
    expect(repositorySource).not.toContain('RuleBasedRetentionAnalyzer');
    expect(useCaseSource).not.toContain('IntelligenceQueryService');
    expect(useCaseSource).not.toContain('INTELLIGENCE_CUSTOMER_CAP');
    expect(moduleSource).not.toContain('IntelligenceModule');
    expect(controllerSource).not.toContain('intelligence/opportunities');
  });

  it('reuses canonical observed-return SQL instead of inventing a second evidence join', () => {
    expect(repositorySource).toContain('observedReturnCtes');
    expect(repositorySource).toContain('eligible-message-evidence.sql');
  });
});
