export type StoredObject = {
  key: string;
  contentType: string;
  byteSize: number;
};

export interface ObjectStorage {
  putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string }>;
  deleteObject(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
