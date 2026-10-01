export type StoredObject = {
  key: string;
  contentType: string;
  byteSize: number;
};

export interface ObjectStorage {
  putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string }>;
  deleteObject(key: string): Promise<void>;
}

export type ObjectStorageConfig = {
  MINIO_ENDPOINT: string;
  MINIO_PORT: number;
  MINIO_USE_SSL: boolean;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET: string;
  MINIO_REQUEST_TIMEOUT_MS: number;
};

export { S3CompatibleObjectStorage } from './s3-compatible.object-storage.js';
