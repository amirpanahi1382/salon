/** Pino redact paths. Never log credentials, tokens, or customer phones. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'phoneNumber',
  '*.phoneNumber',
  'DATABASE_URL',
  '*.DATABASE_URL',
  'JWT_SECRET',
  'accessToken',
  '*.accessToken',
] as const;
