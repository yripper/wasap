import { type Logger, pino } from 'pino';

export type { Logger };

/// Redaction is a safety net: code should never pass message text or secrets
/// to the logger in the first place.
export function createLogger(): Logger {
  return pino({
    level: process.env.WASAP_LOG_LEVEL ?? 'info',
    redact: {
      paths: ['text', '*.text', 'token', '*.token', 'authKey', 'phone', 'authorization', '*.authorization'],
      censor: '[redacted]',
    },
  });
}
