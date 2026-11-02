// Hints for clients only. The real safety boundary is that write tools are
// never allowlisted in Claude's permissions, so each call asks me first.
export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
export const WHATSAPP_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
