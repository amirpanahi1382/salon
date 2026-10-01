import { randomUUID } from 'node:crypto';
import { S3CompatibleObjectStorage } from './s3-compatible.object-storage';

const describeIfDisposable = process.env.PHASE10_OBJECT_STORAGE_TEST === 'true' ? describe : describe.skip;

describeIfDisposable('S3CompatibleObjectStorage (disposable MinIO)', () => {
  const storage = new S3CompatibleObjectStorage({
    MINIO_ENDPOINT: process.env.PHASE10_MINIO_HOST ?? '127.0.0.1',
    MINIO_PORT: Number(process.env.PHASE10_MINIO_PORT ?? 59010),
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: process.env.PHASE10_MINIO_ACCESS_KEY ?? 'phase10test',
    MINIO_SECRET_KEY: process.env.PHASE10_MINIO_SECRET_KEY ?? 'phase10testsecret',
    MINIO_BUCKET: process.env.PHASE10_MINIO_BUCKET ?? 'phase10-vip-test',
    MINIO_REQUEST_TIMEOUT_MS: 2_000,
  });

  it('puts, reads, and deletes a generation-specific object', async () => {
    const key = `vip/disposable/${randomUUID()}/g1`;
    const body = Buffer.from('phase-10-object-bytes');
    await expect(storage.putObject({ key, body, contentType: 'image/jpeg' })).resolves.toEqual({
      key,
      contentType: 'image/jpeg',
      byteSize: body.length,
    });
    await expect(storage.getObject(key)).resolves.toEqual({ body, contentType: 'image/jpeg' });
    await expect(storage.deleteObject(key)).resolves.toBeUndefined();
    await expect(storage.getObject(key)).rejects.toMatchObject({ code: 'INFRASTRUCTURE_ERROR' });
  });
});
