import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { ValidationError } from '@salon/shared';
import {
  ACTIVATION_RECEIPT_MAX_DIMENSION,
  inspectReceiptImage,
} from './receipt-image';

describe('receipt image decode', () => {
  it('keeps a fully decoded JPEG’s original bytes and digest', async () => {
    const original = await sharp({
      create: { width: 12, height: 9, channels: 3, background: { r: 12, g: 80, b: 160 } },
    }).jpeg().toBuffer();
    const inspected = await inspectReceiptImage({
      buffer: original,
      originalname: 'receipt.jpg',
      size: original.length,
    });
    expect(inspected.buffer).toBe(original);
    expect(inspected.contentType).toBe('image/jpeg');
    expect(inspected.sha256).toBe(createHash('sha256').update(original).digest('hex'));
  });

  it('rejects a JPEG header whose body is truncated', async () => {
    const original = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();
    const truncated = original.subarray(0, 24);
    await expect(inspectReceiptImage({
      buffer: truncated,
      originalname: 'receipt.jpg',
      size: truncated.length,
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a fully decoded PNG and WebP without replacing their bytes', async () => {
    const png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: { r: 20, g: 30, b: 40 } },
    }).png().toBuffer();
    const webp = await sharp({
      create: { width: 4, height: 3, channels: 3, background: { r: 50, g: 60, b: 70 } },
    }).webp().toBuffer();
    for (const [original, name] of [[png, 'receipt.png'], [webp, 'receipt.webp']] as const) {
      const inspected = await inspectReceiptImage({
        buffer: original,
        originalname: name,
        size: original.length,
      });
      expect(inspected.buffer).toBe(original);
      expect(inspected.sha256).toBe(createHash('sha256').update(original).digest('hex'));
    }
  });

  it('rejects an image whose dimensions exceed the configured limit', async () => {
    const wide = await sharp({
      create: {
        width: ACTIVATION_RECEIPT_MAX_DIMENSION + 1,
        height: 1,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    }).png().toBuffer();
    await expect(inspectReceiptImage({
      buffer: wide,
      originalname: 'receipt.png',
      size: wide.length,
    })).rejects.toThrow('The receipt image dimensions are too large');
  });

  it('rejects a small compressed image whose pixel count exceeds the limit', async () => {
    const bomb = solidPng(4_100, 4_100);
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(inspectReceiptImage({
      buffer: bomb,
      originalname: 'receipt.png',
      size: bomb.length,
    })).rejects.toThrow('The receipt image dimensions are too large');
  });
});

function solidPng(width: number, height: number): Buffer {
  const scanline = Buffer.alloc(1 + width * 3);
  const raw = Buffer.alloc(scanline.length * height);
  for (let row = 0; row < height; row += 1) scanline.copy(raw, row * scanline.length);
  return png(width, height, deflateSync(raw));
}

function png(width: number, height: number, idat: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}
