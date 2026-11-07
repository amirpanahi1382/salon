import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { signupPendingResponse } from './signup-phone';

export function recoveryMac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function recoveryPhoneHash(secret: string, phone: string): string {
  return recoveryMac(secret, `recovery-phone:${phone}`);
}

export function recoveryStartHash(secret: string, phone: string): string {
  return recoveryMac(secret, `recovery-start:${phone}`);
}

export function recoveryVerifyHash(secret: string, phone: string, otpCode: string): string {
  return recoveryMac(secret, `recovery-verify:${phone}:${otpCode}`);
}

export function issueRecoveryProof(): string {
  return randomBytes(32).toString('base64url');
}

export function recoveryProofHash(secret: string, proof: string): string {
  return recoveryMac(secret, `recovery-proof:${proof}`);
}

export function recoveryProofMatches(secret: string, proof: string, storedHash: string): boolean {
  const actual = Buffer.from(recoveryProofHash(secret, proof), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function recoveryCompletionHash(
  secret: string,
  input: { phone: string; password: string; proof: string },
): string {
  return recoveryMac(
    secret,
    `recovery-complete:${input.phone}\n${input.password}\n${input.proof}`,
  );
}

export function recoveryPendingResponse(expiresInSeconds: number, resendAvailableInSeconds: number) {
  return signupPendingResponse(expiresInSeconds, resendAvailableInSeconds);
}

export function credentialsVersionFromJwt(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647) {
    return value;
  }
  return -1;
}

/**
 * Recovery OTP is sent only for one unambiguous ACTIVE identity:
 * an ACTIVE salon user on an ACTIVE salon, or an ACTIVE platform admin.
 * PRODUCT access is not required. Unknown, disabled, suspended, and
 * cross-role collisions are ineligible.
 */
export type RecoveryEligibilitySnapshot = {
  user: { status: string; salonStatus: string } | null;
  admin: { status: string } | null;
};

export type RecoveryEligibility =
  | { eligible: true; kind: 'salon' }
  | { eligible: true; kind: 'admin' }
  | { eligible: false };

export function resolveRecoveryEligibility(
  snapshot: RecoveryEligibilitySnapshot,
): RecoveryEligibility {
  const salonMatch =
    snapshot.user !== null &&
    snapshot.user.status === 'ACTIVE' &&
    snapshot.user.salonStatus === 'ACTIVE';
  const adminMatch = snapshot.admin !== null && snapshot.admin.status === 'ACTIVE';
  if (salonMatch && !adminMatch) {
    return { eligible: true, kind: 'salon' };
  }
  if (adminMatch && !salonMatch) {
    return { eligible: true, kind: 'admin' };
  }
  return { eligible: false };
}
