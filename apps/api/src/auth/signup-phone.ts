import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Canonical Iranian mobile, `09` plus nine digits. Returns null when the input is not one. */
export function normalizeIranianMobile(input: string): string | null {
  const ascii = input.trim().replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = PERSIAN_DIGITS.indexOf(digit);
    if (persian >= 0) {
      return String(persian);
    }
    return String(ARABIC_DIGITS.indexOf(digit));
  });
  const compact = ascii.replace(/[\s()-]/g, '');
  let national = compact;
  if (national.startsWith('+98')) {
    national = `0${national.slice(3)}`;
  } else if (national.startsWith('0098')) {
    national = `0${national.slice(4)}`;
  } else if (national.startsWith('98') && national.length === 12) {
    national = `0${national.slice(2)}`;
  }
  return /^09\d{9}$/.test(national) ? national : null;
}

export function signupMac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function signupPhoneHash(secret: string, phone: string): string {
  return signupMac(secret, `signup-phone:${phone}`);
}

export function signupStartHash(secret: string, phone: string): string {
  return signupMac(secret, `signup-start:${phone}`);
}

export function signupVerifyHash(secret: string, phone: string, otpCode: string): string {
  return signupMac(secret, `signup-verify:${phone}:${otpCode}`);
}

export function issueSignupProof(): string {
  return randomBytes(32).toString('base64url');
}

export function signupProofHash(secret: string, proof: string): string {
  return signupMac(secret, `signup-proof:${proof}`);
}

/** HMAC of the canonical completion. The stored record keeps only this hash. */
export function signupCompletionHash(
  secret: string,
  input: {
    phone: string;
    salonName: string;
    ownerName: string;
    password: string;
    proof: string;
  },
): string {
  return signupMac(
    secret,
    `signup-complete:${input.phone}\n${input.salonName}\n${input.ownerName}\n${input.password}\n${input.proof}`,
  );
}

export function signupProofMatches(secret: string, proof: string, storedHash: string): boolean {
  const actual = Buffer.from(signupProofHash(secret, proof), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Earlier of our cap and the provider TTL, measured from the same instant. */
export function signupDeadline(now: Date, maxTtlSeconds: number, providerTtlSeconds: number): Date {
  const cap = now.getTime() + maxTtlSeconds * 1000;
  const provider = now.getTime() + providerTtlSeconds * 1000;
  return new Date(Math.min(cap, provider));
}

export function secondsUntil(deadline: Date, now: Date): number {
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));
}

export function cooldownRemaining(createdAt: Date, now: Date, cooldownSeconds: number): number {
  const elapsedMs = now.getTime() - createdAt.getTime();
  const remainingMs = cooldownSeconds * 1000 - elapsedMs;
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}
