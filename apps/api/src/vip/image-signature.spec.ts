import { detectVipImageContentType, assertSafeObjectFileName } from './image-signature';

describe('VIP image signatures', () => {
  it('detects jpeg png and webp magic bytes', () => {
    expect(detectVipImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBe(
      'image/jpeg',
    );
    expect(
      detectVipImageContentType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]),
      ),
    ).toBe('image/png');
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    expect(detectVipImageContentType(webp)).toBe('image/webp');
    expect(detectVipImageContentType(Buffer.from('not-an-image'))).toBeNull();
  });

  it('rejects path traversal filenames', () => {
    expect(() => assertSafeObjectFileName('../a.jpg')).toThrow('UNSAFE_NAME');
    expect(() => assertSafeObjectFileName('a/b.jpg')).toThrow('UNSAFE_NAME');
  });
});
