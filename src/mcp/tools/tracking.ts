import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireChat } from '../../actions/context.js';
import { AppError } from '../../domain/errors.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { LOCAL_WRITE } from './annotations.js';
import { category } from './schemas.js';
import { chatId } from './read.js';

export function registerTrackingTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'snooze',
    {
      description: 'Hide a chat from get_pending until the given time (local only, never visible in WhatsApp). A snoozed chat comes back on its own.',
      inputSchema: { chat_id: chatId, until: z.iso.datetime({ offset: true }).max(40).describe('ISO 8601 with offset, in the future') },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        const untilSec = Math.floor(Date.parse(a.until) / 1000);
        if (untilSec <= d.actions.now()) throw new AppError('VALIDATION', 'until must be in the future');
        d.actions.chats.setSnooze(a.chat_id, untilSec);
        return { ok: true, snoozed_until: new Date(untilSec * 1000).toISOString() };
      }),
  );

  server.registerTool(
    'unsnooze',
    { description: 'Bring a snoozed chat back into get_pending.', inputSchema: { chat_id: chatId }, annotations: LOCAL_WRITE },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        d.actions.chats.setSnooze(a.chat_id, null);
        return { ok: true };
      }),
  );

  server.registerTool(
    'set_watch_level',
    {
      description: 'full = tracked closely and listed first in pending; normal = stored and searchable but groups never pending; muted = hidden from pending.',
      inputSchema: { chat_id: chatId, level: z.enum(['full', 'normal', 'muted']) },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        d.actions.chats.setWatchLevel(a.chat_id, a.level);
        return { ok: true };
      }),
  );

  server.registerTool(
    'set_category',
    {
      description: 'Set the chat category (free label such as family, work, partners). Profiles are learned per category. Lowercase letters, digits, - and _, up to 32 chars.',
      inputSchema: { chat_id: chatId, category },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        d.actions.chats.setCategory(a.chat_id, a.category);
        return { ok: true };
      }),
  );
}
