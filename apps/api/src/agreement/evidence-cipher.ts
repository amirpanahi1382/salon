import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AppConfig } from '@salon/config';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type EvidenceKeyRing = {
  currentId: string;
  keys: ReadonlyMap<string, Buffer>;
};

export type EvidenceCiphertext = {
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
};

export function loadEvidenceKeyRing(config: AppConfig): EvidenceKeyRing {
  const keys = new Map<string, Buffer>();
  if (config.AGREEMENT_EVIDENCE_KEY) {
    keys.set(config.AGREEMENT_EVIDENCE_KEY_ID, decodeKey(config.AGREEMENT_EVIDENCE_KEY));
  }
  if (config.AGREEMENT_EVIDENCE_DECRYPT_KEYS) {
    for (const part of config.AGREEMENT_EVIDENCE_DECRYPT_KEYS.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const separator = trimmed.indexOf(':');
      if (separator <= 0) {
        throw new Error('Invalid configuration: AGREEMENT_EVIDENCE_DECRYPT_KEYS');
      }
      const keyId = trimmed.slice(0, separator);
      const key = decodeKey(trimmed.slice(separator + 1));
      const existing = keys.get(keyId);
      if (existing && !existing.equals(key)) {
        throw new Error('Invalid configuration: duplicate agreement evidence key id');
      }
      keys.set(keyId, key);
    }
  }
  return { currentId: config.AGREEMENT_EVIDENCE_KEY_ID, keys };
}

export function encryptEvidence(
  ring: EvidenceKeyRing,
  aad: string,
  plaintext: Buffer,
): EvidenceCiphertext {
  const key = ring.keys.get(ring.currentId);
  if (!key) {
    throw new Error('Agreement evidence key is not configured.');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { keyId: ring.currentId, nonce, ciphertext: encrypted };
}

export function decryptEvidence(
  ring: EvidenceKeyRing,
  keyId: string,
  nonce: Buffer,
  ciphertext: Buffer,
  aad: string,
): Buffer {
  const key = ring.keys.get(keyId);
  if (!key || nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) {
    throw new Error('Agreement evidence cannot be decrypted.');
  }
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error('Agreement evidence cannot be decrypted.');
  }
}

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid configuration: agreement evidence keys must be 32 bytes');
  }
  return key;
}
