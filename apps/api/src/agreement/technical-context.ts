import { normalizeIpAddress } from '@salon/config';
import type { Request } from 'express';
import type { AppRequest } from '../infrastructure/http/request-context';

const CLIENT_TOKEN = /^[A-Za-z0-9._+\-]{1,64}$/;

export type TechnicalContext = {
  /** Exact socket peer. This is the only address the API observed itself. */
  observedSocketIp: string | null;
  /**
   * Equals observedSocketIp unless the socket matched a configured trusted proxy
   * and the forwarded chain was verified. A client-supplied X-Forwarded-For is never
   * stored as this value on its own.
   */
  clientIp: string | null;
  clientIpSource: 'socket' | 'trusted_proxy';
  userAgent: string | null;
  appVersion: string | null;
  appBuild: string | null;
  apiRevision: string;
  requestId: string;
  correlationId: string;
};

export type ProxyTrust = {
  trustedProxyHops: number;
  trustedProxyIps: readonly string[];
};

/**
 * The API process listens directly. Compose has no reverse proxy, and Express
 * trust-proxy is not enabled. The default hop count is zero, so X-Forwarded-For
 * is ignored and the socket address is the client IP.
 *
 * A forwarded address is recorded only when TRUSTED_PROXY_HOPS is nonzero,
 * TRUSTED_PROXY_IPS is configured, and the immediate socket peer is one of those
 * addresses. The rightmost trusted hops in the header must also be those proxies.
 * The next address to the left is the client. Anything further left was supplied
 * before the trusted chain and is ignored. If that check fails, the socket address
 * is kept and the header is not labeled trusted.
 * App version, build, and user agent stay client-reported.
 */
export function readTechnicalContext(
  req: Request,
  trust: ProxyTrust,
  apiRevision: string,
): TechnicalContext {
  const appReq = req as AppRequest;
  const observedSocketIp = socketAddress(req);
  const forwarded = verifiedForwardedClientIp(req, trust, observedSocketIp);
  return {
    observedSocketIp,
    clientIp: forwarded ?? observedSocketIp,
    clientIpSource: forwarded ? 'trusted_proxy' : 'socket',
    userAgent: clientReportedText(headerText(req.headers['user-agent']), 300),
    appVersion: clientToken(headerText(req.headers['x-app-version'])),
    appBuild: clientToken(headerText(req.headers['x-app-build'])),
    apiRevision,
    requestId: typeof appReq.id === 'string' && appReq.id.length > 0 ? appReq.id : 'unknown',
    correlationId: appReq.correlationId ?? (typeof appReq.id === 'string' ? appReq.id : 'unknown'),
  };
}

/**
 * Returns the verified client address, or null when the header must be ignored.
 * Null means the caller keeps the socket address.
 */
export function verifiedForwardedClientIp(
  req: Request,
  trust: ProxyTrust,
  observedSocketIp: string | null,
): string | null {
  if (trust.trustedProxyHops <= 0 || trust.trustedProxyIps.length === 0) {
    return null;
  }
  const socket = observedSocketIp ? normalizeIpAddress(observedSocketIp) : null;
  if (!socket || !trust.trustedProxyIps.includes(socket)) {
    return null;
  }
  const header = forwardedForHeader(req.headers['x-forwarded-for']);
  if (!header) {
    return null;
  }
  const hops = header
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => normalizeIpAddress(item));
  const proxyHopsInHeader = trust.trustedProxyHops - 1;
  if (hops.length < proxyHopsInHeader + 1) {
    return null;
  }
  const clientIndex = hops.length - proxyHopsInHeader - 1;
  for (let index = clientIndex + 1; index < hops.length; index += 1) {
    const hop = hops[index];
    if (!hop || !trust.trustedProxyIps.includes(hop)) {
      return null;
    }
  }
  const client = hops[clientIndex];
  if (!client || trust.trustedProxyIps.includes(client)) {
    return null;
  }
  return client;
}

function forwardedForHeader(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join(', ');
  }
  return null;
}

function socketAddress(req: Request): string | null {
  const address = req.socket?.remoteAddress;
  return address && address.length <= 64 ? address : null;
}

function headerText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function clientToken(value: string | undefined): string | null {
  if (!value || !CLIENT_TOKEN.test(value)) {
    return null;
  }
  return value;
}

function clientReportedText(value: string | undefined, max: number): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.slice(0, max);
}
