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

  it('logs adminId for platform principals without a tenant', () => {
    const fields = requestLogFields({
      id: 'req-1',
      correlationId: 'corr-1',
      user: { kind: 'platform', adminId: 'admin-1' },
      method: 'GET',
      path: '/admin/message-queue',
      operation: 'AdminMessageQueueController.list',
    } as unknown as AppRequest);
    expect(fields.adminId).toBe('admin-1');
    expect(fields.tenantId).toBeUndefined();
    expect(fields.userId).toBeUndefined();
  });

  it('does not log an unmatched path that may contain sensitive input', () => {
    const fields = requestLogFields({
      id: 'req-1', correlationId: 'corr-1', method: 'GET',
      path: '/not-a-route/PHONE_FAKE_09120000000',
    } as unknown as AppRequest);
    expect(fields.route).toBe('unmatched');
    expect(JSON.stringify(fields)).not.toContain('PHONE_FAKE_09120000000');
  });
});
