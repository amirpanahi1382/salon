/**
 * First platform admin for a new empty database.
 * The operator supplies PLATFORM_ADMIN_PHONE, PLATFORM_ADMIN_PASSWORD, and,
 * on the second run, PLATFORM_ADMIN_OTP_CODE. No phone is hard-coded.
 * Requires PLATFORM_ADMIN_EXPECTED_DATABASE, PLATFORM_ADMIN_EXPECTED_SYSTEM_IDENTIFIER,
 * and PLATFORM_ADMIN_EXPECTED_DATABASE_COMMENT. Those must match the live connection
 * before any verification message or insert. Also refuses databases named salon and
 * salon_preview. Does not print the phone, the code, the password, the URL, or the key.
 *
 *   pnpm db:bootstrap-admin
 */
const argon2 = require('argon2');
const { loadConfig } = require('@salon/config');
const { createPrismaClient } = require('@salon/database');
const { createId } = require('@salon/shared');

function assertBootstrapDatabaseAllowed(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL could not be read for the bootstrap target check');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database === 'salon' || database === 'salon_preview') {
    throw new Error('Refusing to establish a platform admin in database salon or salon_preview');
  }
}

function createOperatorOtp(config) {
  const http = globalThis.fetch.bind(globalThis);
  async function post(path, body) {
    const key = config.OTPY_API_KEY;
    if (!key) {
      throw new Error('OTPY_API_KEY is required to verify the first platform admin');
    }
    const timeoutAbort = new AbortController();
    const timer = setTimeout(() => timeoutAbort.abort(), config.OTPY_TIMEOUT_MS);
    try {
      const response = await http(`${config.OTPY_BASE_URL.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: timeoutAbort.signal,
      });
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined);
        throw new Error('Platform admin verification could not be completed');
      }
      const value = await response.json();
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Platform admin verification could not be completed');
      }
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async send(phone) {
      const result = await post('/v1/otp/send', { phone });
      if (typeof result.request_id !== 'string' || typeof result.ttl_seconds !== 'number') {
        throw new Error('Platform admin verification could not be completed');
      }
      return { requestId: result.request_id, ttlSeconds: result.ttl_seconds };
    },
    async verify(phone, code) {
      const result = await post('/v1/otp/verify', { phone, code });
      if (typeof result.verified !== 'boolean') {
        throw new Error('Platform admin verification could not be completed');
      }
      return result.verified;
    },
  };
}

async function main() {
  const config = loadConfig();
  assertBootstrapDatabaseAllowed(config.DATABASE_URL);
  let establishPlatformAdmin;
  try {
    ({ establishPlatformAdmin } = require('../dist/auth/establish-platform-admin.js'));
  } catch {
    throw new Error('Build the API before establishing a platform admin');
  }
  const prisma = createPrismaClient(config.DATABASE_URL, { connectionLimit: 2 });
  try {
    const result = await establishPlatformAdmin({
      prisma,
      databaseUrl: config.DATABASE_URL,
      expected: {
        databaseName: process.env.PLATFORM_ADMIN_EXPECTED_DATABASE,
        systemIdentifier: process.env.PLATFORM_ADMIN_EXPECTED_SYSTEM_IDENTIFIER,
        databaseComment: process.env.PLATFORM_ADMIN_EXPECTED_DATABASE_COMMENT,
      },
      phone: process.env.PLATFORM_ADMIN_PHONE,
      password: process.env.PLATFORM_ADMIN_PASSWORD,
      otpCode: process.env.PLATFORM_ADMIN_OTP_CODE,
      otp: createOperatorOtp(config),
      hashPassword: (password) => argon2.hash(password, { type: argon2.argon2id }),
      createId,
    });
    if (result.outcome === 'verification_sent') {
      console.log('Verification message sent. Set PLATFORM_ADMIN_OTP_CODE and run this command again.');
      return;
    }
    console.log('Platform admin established.');
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { assertBootstrapDatabaseAllowed };

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'bootstrap-platform-admin failed');
    process.exit(1);
  });
}
