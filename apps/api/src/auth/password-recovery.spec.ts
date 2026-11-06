import {
  credentialsVersionFromJwt,
  recoveryCompletionHash,
  recoveryPhoneHash,
  recoveryProofHash,
  recoveryProofMatches,
  recoveryStartHash,
  recoveryVerifyHash,
} from './password-recovery';
import { signupPhoneHash, signupProofHash } from './signup-phone';

const secret = 'password-recovery-hash-secret-at-least-32';
const signupSecret = 'phone-signup-hash-secret-at-least-32';

describe('password recovery hashes', () => {
  it('stores keyed hashes that are not the phone, proof, or password', () => {
    const phone = '09120000000';
    const proof = 'recovery-proof-token-value-not-stored';
    expect(recoveryPhoneHash(secret, phone)).not.toContain(phone);
    expect(recoveryProofHash(secret, proof)).not.toContain(proof);
    expect(recoveryProofMatches(secret, proof, recoveryProofHash(secret, proof))).toBe(true);
    expect(recoveryProofMatches(secret, 'other-proof-token-value', recoveryProofHash(secret, proof))).toBe(
      false,
    );
    const completion = recoveryCompletionHash(secret, {
      phone,
      password: 'correct-horse',
      proof,
    });
    expect(completion).toHaveLength(64);
    expect(completion).not.toContain('correct-horse');
    expect(completion).not.toBe(
      recoveryCompletionHash(secret, { phone, password: 'other-horse', proof }),
    );
  });

  it('keeps recovery hashes distinct from signup hashes', () => {
    const phone = '09120000000';
    const proof = 'shared-token-value-not-stored';
    expect(recoveryPhoneHash(secret, phone)).not.toBe(signupPhoneHash(signupSecret, phone));
    expect(recoveryPhoneHash(secret, phone)).not.toBe(signupPhoneHash(secret, phone));
    expect(recoveryProofHash(secret, proof)).not.toBe(signupProofHash(secret, proof));
    expect(recoveryStartHash(secret, phone)).not.toBe(recoveryVerifyHash(secret, phone, '222222'));
  });

  it('treats a missing JWT version as zero and rejects malformed versions', () => {
    expect(credentialsVersionFromJwt(undefined)).toBe(0);
    expect(credentialsVersionFromJwt(0)).toBe(0);
    expect(credentialsVersionFromJwt(3)).toBe(3);
    expect(credentialsVersionFromJwt(-1)).toBe(-1);
    expect(credentialsVersionFromJwt(1.5)).toBe(-1);
    expect(credentialsVersionFromJwt('1')).toBe(-1);
  });
});
