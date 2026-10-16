import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ValidationError, InfrastructureError } from '@salon/shared';
import type { ObjectStorage } from '../infrastructure/storage/object-storage';
import { assertSafeObjectFileName, detectVipImageContentType, type VipImageKind } from '../vip/image-signature';

export const ACTIVATION_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const ACTIVATION_RECEIPT_MAX_DIMENSION = 8_000;
export const ACTIVATION_RECEIPT_MAX_PIXELS = 16_000_000;
export const ACTIVATION_UPLOAD_LEASE_MS = 60_000;

const DANGEROUS_MARKERS = ['<script', '<svg', '<?php', '<!doctype', 'javascript:'];

const FORMAT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type ReceiptImage = {
  buffer: Buffer;
  contentType: VipImageKind;
  sha256: string;
};

/**
 * Accepts the original bytes only after a full decode.
 * The returned buffer is that same upload; it is not recompressed.
 */
export async function inspectReceiptImage(file: {
  buffer: Buffer;
  originalname: string;
  size: number;
}): Promise<ReceiptImage> {
  if (!file?.buffer?.length) {
    throw new ValidationError('Upload a JPEG, PNG, or WebP image');
  }
  try {
    assertSafeObjectFileName(file.originalname || 'receipt.jpg');
  } catch {
    throw new ValidationError('Upload a JPEG, PNG, or WebP image');
  }
  if (file.size > ACTIVATION_RECEIPT_MAX_BYTES || file.buffer.length > ACTIVATION_RECEIPT_MAX_BYTES) {
    throw new ValidationError('The receipt image must be at most 5 MB');
  }
  const contentType = detectVipImageContentType(file.buffer);
  if (!contentType) {
    throw new ValidationError('Upload a JPEG, PNG, or WebP image');
  }
  const sample = file.buffer.subarray(0, Math.min(file.buffer.length, 262_144)).toString('latin1').toLowerCase();
  if (DANGEROUS_MARKERS.some((marker) => sample.includes(marker))) {
    throw new ValidationError('Upload a JPEG, PNG, or WebP image');
  }
  await assertFullyDecodable(file.buffer, contentType);
  return {
    buffer: file.buffer,
    contentType,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

export function activationObjectKey(salonId: string, receiptId: string): string {
  return `activation-receipts/${salonId}/${receiptId}`;
}

export async function readVerifiedActivationObject(
  storage: ObjectStorage,
  expected: { objectKey: string; salonId: string; contentType: string; byteSize: number; sha256: string },
): Promise<{ body: Buffer; contentType: string }> {
  if (expected.objectKey !== activationObjectKey(expected.salonId, expected.objectKey.split('/').at(-1) ?? '')) {
    throw new InfrastructureError('File storage is temporarily unavailable');
  }
  const stored = await storage.getObject(expected.objectKey);
  const digest = createHash('sha256').update(stored.body).digest('hex');
  const detected = detectVipImageContentType(stored.body);
  if (
    stored.body.length !== expected.byteSize ||
    stored.contentType !== expected.contentType ||
    detected !== expected.contentType ||
    digest !== expected.sha256
  ) {
    throw new InfrastructureError('File storage is temporarily unavailable');
  }
  return stored;
}

async function assertFullyDecodable(buffer: Buffer, contentType: VipImageKind): Promise<void> {
  const options = {
    failOn: 'truncated' as const,
    limitInputPixels: ACTIVATION_RECEIPT_MAX_PIXELS,
    animated: false,
    sequentialRead: true,
  };
  let width = 0;
  let height = 0;
  let format: string | undefined;
  let pages = 1;
  try {
    const meta = await sharp(buffer, options).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    format = meta.format;
    pages = meta.pages ?? 1;
  } catch (error) {
    throw decodeFailure(error);
  }
  const pixels = width * height;
  if (
    width > ACTIVATION_RECEIPT_MAX_DIMENSION ||
    height > ACTIVATION_RECEIPT_MAX_DIMENSION ||
    pixels > ACTIVATION_RECEIPT_MAX_PIXELS
  ) {
    throw new ValidationError('The receipt image dimensions are too large');
  }
  if (format !== FORMAT_BY_CONTENT_TYPE[contentType] || width < 1 || height < 1 || pages > 1) {
    throw new ValidationError('Upload a complete JPEG, PNG, or WebP image');
  }
  try {
    await sharp(buffer, options).raw().toBuffer();
  } catch (error) {
    throw decodeFailure(error);
  }
}

function decodeFailure(error: unknown): ValidationError {
  const text = error instanceof Error ? error.message : '';
  if (/pixel limit|exceeds pixel/i.test(text)) {
    return new ValidationError('The receipt image dimensions are too large');
  }
  return new ValidationError('Upload a complete JPEG, PNG, or WebP image');
}
