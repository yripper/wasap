export type ErrorCode =
  | 'NOT_FOUND'
  | 'FLOOD_WAIT'
  | 'FORBIDDEN'
  | 'AUTH_REQUIRED'
  | 'LOGGED_OUT'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/// The one error type that crosses module boundaries. MCP tools turn it into
/// a readable `CODE: message` for Claude, so messages must never contain
/// message text, phone numbers or secrets.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/// For logs: error class and message only. WhatsApp library errors don't carry
/// message content, and AppError messages are written to be log-safe.
export function describeError(e: unknown): string {
  if (e instanceof AppError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return 'unknown error';
}
