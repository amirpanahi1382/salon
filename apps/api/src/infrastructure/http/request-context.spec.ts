import { resolveRequestContext, requestLogFields, type AppRequest } from './request-context';

describe('request context', () => {
  it('accepts a safe UUID request id and defaults correlation to it', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const context = resolveRequestContext({
      headers: { 'x-request-id': id },
    } as unknown as AppRequest);
    expect(context.requestId).toBe(id);
    expect(context.correlationId).toBe(id);
  });

  it('rejects unsafe incoming IDs', () => {
    const context = resolveRequestContext({
      headers: { 'x-request-id': 'not a uuid\nAuthorization: Bearer secret' },
    } as unknown as AppRequest);
    expect(context.requestId).not.toContain('secret');
    expect(context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('takes tenant and user only from authenticated request.user', () => {
    const fields = requestLogFields({
      id: 'req-1',
      correlationId: 'corr-1',
      user: { tenantId: 'tenant-from-jwt', userId: 'user-from-jwt', role: 'OWNER' },
      body: { tenantId: 'forged-tenant', userId: 'forged-user' },
      method: 'GET',
      path: '/customers',
      operation: 'CustomerController.list',
    } as unknown as AppRequest);
    expect(fields.tenantId).toBe('tenant-from-jwt');
    expect(fields.userId).toBe('user-from-jwt');
    expect(JSON.stringify(fields)).not.toContain('forged');
  });
});
