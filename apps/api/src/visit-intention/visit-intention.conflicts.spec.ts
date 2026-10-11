import { Prisma } from '@salon/database';
import { ConflictError } from '@salon/shared';
import { rethrowIntentionError } from './visit-intention.use-cases';

function unique(meta: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.4.1',
    meta,
  });
}

describe('rethrowIntentionError', () => {
  it('maps a column-only open-customer unique to the structured conflict', () => {
    expect(() =>
      rethrowIntentionError(
        unique({ modelName: 'VisitIntention', target: ['salon_id', 'customer_id'] }),
      ),
    ).toThrow(ConflictError);
    try {
      rethrowIntentionError(
        unique({ modelName: 'VisitIntention', target: ['salon_id', 'customer_id'] }),
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
        message: 'An open visit intention already exists for this customer',
      });
    }
  });

  it('maps a named open-VIP unique to the structured conflict', () => {
    try {
      rethrowIntentionError(
        unique({ constraint: 'visit_intentions_one_open_vip_recipient_key' }),
      );
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'An open visit intention already exists for this VIP recipient',
      });
    }
  });

  it('does not relabel an unrelated unique as an open intention', () => {
    try {
      rethrowIntentionError(
        unique({ modelName: 'Customer', target: ['salon_id', 'phone_number'] }),
      );
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'A conflicting record already exists',
      });
    }
  });
});
