import { type DestinationStream, type Logger, pino } from 'pino';

export type { Logger };

/// Redaction is a safety net: code should never pass message text or secrets
/// to the logger in the first place.
/// No `base`: pino's default adds pid and hostname, and the hostname usually carries
/// the owner's name into pm2 logs.
export function createLogger(dest?: DestinationStream): Logger {
  const options = {
    level: process.env.WASAP_LOG_LEVEL ?? 'info',
    base: undefined,
    redact: {
      paths: ['text', '*.text', 'token', '*.token', 'authKey', 'phone', 'authorization', '*.authorization'],
      censor: '[redacted]',
    },
  };
  return dest ? pino(options, dest) : pino(options);
}
