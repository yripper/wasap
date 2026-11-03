import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppError, describeError } from '../domain/errors.js';

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
}

/// `CODE: message` so Claude can branch on the code (e.g. wait on FLOOD_WAIT,
/// tell me to log in on AUTH_REQUIRED) instead of parsing prose.
export function fail(e: unknown): CallToolResult {
  const err = e instanceof AppError ? e : new AppError('INTERNAL', describeError(e));
  const retry = err.retryAfterSec === undefined ? '' : ` (retry after ${err.retryAfterSec}s)`;
  return { isError: true, content: [{ type: 'text', text: `${err.code}: ${err.message}${retry}` }] };
}

export async function run(fn: () => unknown): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}
