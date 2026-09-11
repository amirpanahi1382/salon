const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_RIFF = Buffer.from('RIFF', 'ascii');
const WEBP_WEBP = Buffer.from('WEBP', 'ascii');

export type VipImageKind = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectVipImageContentType(buffer: Buffer): VipImageKind | null {
  if (buffer.length < 12) {
    return null;
  }
  if (buffer.subarray(0, 3).equals(JPEG)) {
    return 'image/jpeg';
  }
  if (buffer.subarray(0, 8).equals(PNG)) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).equals(WEBP_RIFF) && buffer.subarray(8, 12).equals(WEBP_WEBP)) {
    return 'image/webp';
  }
  return null;
}

export function assertSafeObjectFileName(name: string): void {
  const trimmed = name.trim().toLowerCase();
  if (
    !trimmed ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    throw new Error('UNSAFE_NAME');
  }
}
