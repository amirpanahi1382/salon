import { createHash } from 'node:crypto';
import { InfrastructureError } from '@salon/shared';
import type { ObjectStorage } from '../infrastructure/storage/object-storage';

export type ExpectedVipSampleObject = {
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
};

export async function readVerifiedVipSampleObject(
  storage: ObjectStorage,
  expected: ExpectedVipSampleObject,
) {
  const stored = await storage.getObject(expected.objectKey);
  const digest = createHash('sha256').update(stored.body).digest('hex');
  if (
    stored.body.length !== expected.byteSize ||
    stored.contentType !== expected.contentType ||
    digest !== expected.sha256
  ) {
    throw new InfrastructureError('Stored sample work failed integrity verification');
  }
  return stored;
}
