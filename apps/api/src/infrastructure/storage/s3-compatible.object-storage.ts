import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { InfrastructureError } from '@salon/shared';
import type { AppConfig } from '@salon/config';
import type { ObjectStorage, StoredObject } from './object-storage';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function amzDate(now: Date): { amz: string; stamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz: iso, stamp: iso.slice(0, 8) };
}

/**
 * Signed S3-compatible object storage (MinIO). No extra SDK dependency.
 */
export class S3CompatibleObjectStorage implements ObjectStorage {
  constructor(private readonly config: AppConfig) {}

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    await this.request('PUT', input.key, input.body, { 'content-type': input.contentType });
    return { key: input.key, contentType: input.contentType, byteSize: input.body.length };
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const { body, headers } = await this.request('GET', key);
    const contentType = headers['content-type']?.split(';')[0] || 'application/octet-stream';
    return { body, contentType };
  }

  async deleteObject(key: string): Promise<void> {
    await this.request('DELETE', key);
  }

  private request(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body: Buffer = Buffer.alloc(0),
    extraHeaders: Record<string, string> = {},
  ): Promise<{ body: Buffer; headers: Record<string, string> }> {
    const { MINIO_ENDPOINT, MINIO_PORT, MINIO_USE_SSL, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET } =
      this.config;
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const path = `/${MINIO_BUCKET}/${encodedKey}`;
    const host = `${MINIO_ENDPOINT}:${MINIO_PORT}`;
    const now = new Date();
    const { amz, stamp } = amzDate(now);
    const payloadHash = sha256Hex(body);
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalHeaders =
      `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amz}\n`;
    const canonicalRequest = [
      method,
      path,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const region = 'us-east-1';
    const credentialScope = `${stamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amz,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = createHmac('sha256', signingKey(MINIO_SECRET_KEY, stamp, region, 's3'))
      .update(stringToSign)
      .digest('hex');
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
      authorization: `AWS4-HMAC-SHA256 Credential=${MINIO_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...extraHeaders,
    };
    if (method === 'PUT') {
      headers['content-length'] = String(body.length);
    }

    const transport = MINIO_USE_SSL ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = transport(
        {
          hostname: MINIO_ENDPOINT,
          port: MINIO_PORT,
          method,
          path,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks);
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new InfrastructureError('File storage is temporarily unavailable'));
              return;
            }
            const responseHeaders: Record<string, string> = {};
            for (const [header, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') {
                responseHeaders[header] = value;
              }
            }
            resolve({ body: responseBody, headers: responseHeaders });
          });
        },
      );
      req.on('error', () => reject(new InfrastructureError('File storage is temporarily unavailable')));
      if (method === 'PUT' && body.length) {
        req.write(body);
      }
      req.end();
    });
  }
}
