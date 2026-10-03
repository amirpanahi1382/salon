import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { InfrastructureError } from '@salon/shared';
import type { ObjectStorage, ObjectStorageConfig, PreparedObjectPut, StoredObject } from './index.js';

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

/** Focused signed S3-compatible adapter shared by the API and recovery worker. */
export class S3CompatibleObjectStorage implements ObjectStorage {
  constructor(private readonly config: ObjectStorageConfig) {}

  async putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    await this.request('PUT', input.key, input.body, { 'content-type': input.contentType });
    return { key: input.key, contentType: input.contentType, byteSize: input.body.length };
  }

  preparePutObject(input: { key: string; body: Buffer; contentType: string; expiresAt: Date }): PreparedObjectPut {
    const config = this.config;
    const host = `${config.MINIO_ENDPOINT}:${config.MINIO_PORT}`;
    const signedAt = new Date();
    const { amz, stamp } = amzDate(signedAt);
    const signedSecond = Date.UTC(signedAt.getUTCFullYear(), signedAt.getUTCMonth(),
      signedAt.getUTCDate(), signedAt.getUTCHours(), signedAt.getUTCMinutes(), signedAt.getUTCSeconds());
    const expiresSeconds = Math.floor((input.expiresAt.getTime() - signedSecond) / 1000);
    if (expiresSeconds < 1 || expiresSeconds > 604_800) {
      throw new InfrastructureError('File storage is temporarily unavailable');
    }
    const path = `/${config.MINIO_BUCKET}/${input.key.split('/').map(encodeURIComponent).join('/')}`;
    const scope = `${stamp}/us-east-1/s3/aws4_request`;
    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${config.MINIO_ACCESS_KEY}/${scope}`,
      'X-Amz-Date': amz,
      'X-Amz-Expires': String(expiresSeconds),
      'X-Amz-SignedHeaders': 'content-type;host',
    });
    query.sort();
    const canonical = [
      'PUT', path, query.toString(),
      `content-type:${input.contentType}\nhost:${host}\n`,
      'content-type;host', 'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonical)].join('\n');
    const signature = createHmac('sha256', signingKey(config.MINIO_SECRET_KEY, stamp, 'us-east-1', 's3'))
      .update(stringToSign).digest('hex');
    query.set('X-Amz-Signature', signature);
    const authorizedPath = `${path}?${query.toString()}`;
    return {
      execute: async () => {
        await this.send('PUT', authorizedPath, input.body, {
          host, 'content-type': input.contentType, 'content-length': String(input.body.length),
        });
        return { key: input.key, contentType: input.contentType, byteSize: input.body.length };
      },
    };
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const { body, headers } = await this.request('GET', key);
    return { body, contentType: headers['content-type']?.split(';')[0] || 'application/octet-stream' };
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
    const config = this.config;
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const path = `/${config.MINIO_BUCKET}/${encodedKey}`;
    const host = `${config.MINIO_ENDPOINT}:${config.MINIO_PORT}`;
    const { amz, stamp } = amzDate(new Date());
    const payloadHash = sha256Hex(body);
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const region = 'us-east-1';
    const credentialScope = `${stamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', amz, credentialScope, sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = createHmac(
      'sha256',
      signingKey(config.MINIO_SECRET_KEY, stamp, region, 's3'),
    ).update(stringToSign).digest('hex');
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.MINIO_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...extraHeaders,
    };
    if (method === 'PUT') headers['content-length'] = String(body.length);

    return this.send(method, path, body, headers);
  }

  private send(method: 'GET' | 'PUT' | 'DELETE', path: string, body: Buffer,
    headers: Record<string, string>): Promise<{ body: Buffer; headers: Record<string, string> }> {
    const config = this.config;
    const transport = config.MINIO_USE_SSL ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new InfrastructureError('File storage is temporarily unavailable'));
      };
      const req = transport({
        hostname: config.MINIO_ENDPOINT,
        port: config.MINIO_PORT,
        method,
        path,
        headers,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          if (settled) return;
          const responseBody = Buffer.concat(chunks);
          if (!res.statusCode || res.statusCode >= 400) return fail();
          settled = true;
          const responseHeaders: Record<string, string> = {};
          for (const [header, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') responseHeaders[header] = value;
          }
          resolve({ body: responseBody, headers: responseHeaders });
        });
      });
      req.setTimeout(config.MINIO_REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        fail();
      });
      req.on('error', fail);
      if (method === 'PUT' && body.length) req.write(body);
      req.end();
    });
  }
}
