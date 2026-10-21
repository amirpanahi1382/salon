import { NotFoundError } from '@salon/shared';
import { EmailRegistrationGuard } from './email-registration.guard';
import { PhoneSignupEnabledGuard } from './phone-signup-enabled.guard';
import {
  cooldownRemaining,
  normalizeIranianMobile,
  signupDeadline,
  signupPendingResponse,
  signupPhoneHash,
  signupCompletionHash,
  signupProofHash,
  signupProofMatches,
} from './signup-phone';

const secret = 'phone-signup-hash-secret-at-least-32';

describe('signup phone normalization and deadlines', () => {
  it('canonicalizes Iranian mobiles and rejects other numbers', () => {
    expect(normalizeIranianMobile('09120000000')).toBe('09120000000');
    expect(normalizeIranianMobile('+989120000000')).toBe('09120000000');
    expect(normalizeIranianMobile('00989120000000')).toBe('09120000000');
    expect(normalizeIranianMobile('989120000000')).toBe('09120000000');
    expect(normalizeIranianMobile('۰۹۱۲۰۰۰۰۰۰۰')).toBe('09120000000');
    expect(normalizeIranianMobile('0912 000 0000')).toBe('09120000000');
    expect(normalizeIranianMobile('08120000000')).toBeNull();
    expect(normalizeIranianMobile('0912000000')).toBeNull();
  });

  it('never lets the local deadline exceed the provider TTL or the configured cap', () => {
    const now = new Date('2026-10-15T00:00:00.000Z');
    expect(signupDeadline(now, 60, 299).toISOString()).toBe('2026-10-15T00:01:00.000Z');
    expect(signupDeadline(now, 60, 30).toISOString()).toBe('2026-10-15T00:00:30.000Z');
  });

  it('hashes phones and proofs so the stored value is not the secret', () => {
    const phone = '09120000000';
    const proof = 'proof-token-value-not-stored';
    expect(signupPhoneHash(secret, phone)).not.toContain(phone);
    expect(signupProofHash(secret, proof)).not.toContain(proof);
    expect(signupProofMatches(secret, proof, signupProofHash(secret, proof))).toBe(true);
    expect(signupProofMatches(secret, 'other-proof-token-value', signupProofHash(secret, proof))).toBe(
      false,
    );
    const completion = signupCompletionHash(secret, {
      phone,
      salonName: 'Salon',
      ownerName: 'Owner',
      password: 'correct-horse',
      proof,
    });
    expect(completion).toHaveLength(64);
    expect(completion).not.toContain('correct-horse');
    expect(completion).not.toBe(
      signupCompletionHash(secret, {
        phone,
        salonName: 'Other',
        ownerName: 'Owner',
        password: 'correct-horse',
        proof,
      }),
    );
  });

  it('keeps a zero resend window instead of substituting the cooldown', () => {
    expect(signupPendingResponse(60, 0)).toEqual({
      outcome: 'pending',
      expiresInSeconds: 60,
      resendAvailableInSeconds: 0,
    });
    expect(signupPendingResponse(45, 17).resendAvailableInSeconds).toBe(17);
  });

  it('counts a full cooldown second while the window is still open', () => {
    const createdAt = new Date(Date.now() - 59_100);
    expect(cooldownRemaining(createdAt, new Date(), 60)).toBe(1);
    expect(cooldownRemaining(new Date(Date.now() - 61_000), new Date(), 60)).toBe(0);
  });

  it('keeps email registration closed in every mode', () => {
    for (const mode of ['email', 'phone', 'closed']) {
      expect(() =>
        new EmailRegistrationGuard({
          values: { PUBLIC_REGISTRATION_MODE: mode },
        } as never).canActivate(),
      ).toThrow(NotFoundError);
    }
  });

  it('hides the routes when the feature flag is off', () => {
    const guard = new PhoneSignupEnabledGuard({
      values: { PHONE_SIGNUP_ENABLED: false },
    } as never);
    expect(() => guard.canActivate()).toThrow(NotFoundError);
    expect(
      new PhoneSignupEnabledGuard({
        values: { PHONE_SIGNUP_ENABLED: true },
      } as never).canActivate(),
    ).toBe(true);
  });
});