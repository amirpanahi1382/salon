import { createHash } from 'node:crypto';
import { InfrastructureError } from '@salon/shared';
import type { ObjectStorage } from '../infrastructure/storage/object-storage';
import { readVerifiedVipSampleObject } from './vip-sample-work-integrity';

describe('VIP sample-work object verification', () => {
  const body = Buffer.from('verified-image-bytes');
  const expected = {
    objectKey: 'vip/tenant/request/upload/g1',
    contentType: 'image/jpeg',
    byteSize: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  };

  function storage(storedBody = body, contentType = 'image/jpeg'): ObjectStorage {
    return {
      putObject: jest.fn(),
      deleteObject: jest.fn(),
      getObject: jest.fn().mockResolvedValue({ body: storedBody, contentType }),
    };
  }

  it('returns bytes only when content type, length, and digest all match', async () => {
    await expect(readVerifiedVipSampleObject(storage(), expected)).resolves.toEqual({
      body,
      contentType: 'image/jpeg',
    });
  });

  it.each([
    [Buffer.from('different-image-bytes'), 'image/jpeg'],
    [body, 'image/png'],
    [Buffer.concat([body, Buffer.from('x')]), 'image/jpeg'],
  ])('rejects inconsistent stored metadata or bytes', async (storedBody, contentType) => {
    await expect(readVerifiedVipSampleObject(storage(storedBody, contentType), expected))
      .rejects.toBeInstanceOf(InfrastructureError);
  });
});
