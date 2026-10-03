import type { ObjectStorage, StoredObject } from './object-storage';
import { InfrastructureError } from '@salon/shared';

/** In-process storage for unit tests. Not used in production. */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key, contentType: input.contentType, byteSize: input.body.length };
  }

  preparePutObject(input: { key: string; body: Buffer; contentType: string; expiresAt: Date }) {
    return { execute: async () => {
      if (Date.now() >= input.expiresAt.getTime()) {
        throw new InfrastructureError('File storage is temporarily unavailable');
      }
      return this.putObject(input);
    } };
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const found = this.objects.get(key);
    if (!found) {
      throw new InfrastructureError('File storage is temporarily unavailable');
    }
    return found;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
