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
