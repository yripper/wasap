import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { archiveChats, muteChat, unarchiveChats, unmuteChat } from '../../actions/organize.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { WHATSAPP_WRITE } from './annotations.js';
import { chatId } from './read.js';

const chatIds = z.array(chatId).min(1).max(100);

export function registerOrganizeTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'archive_chats',
    { description: 'Move chats to the WhatsApp archive.', inputSchema: { chat_ids: chatIds }, annotations: WHATSAPP_WRITE },
    (a) => run(() => archiveChats(d.actions, a.chat_ids)),
  );

  server.registerTool(
    'unarchive_chats',
    { description: 'Move chats out of the WhatsApp archive.', inputSchema: { chat_ids: chatIds }, annotations: WHATSAPP_WRITE },
    (a) => run(() => unarchiveChats(d.actions, a.chat_ids)),
  );

  server.registerTool(
    'mute_chat',
    {
      description: 'Mute notifications for a chat in WhatsApp. Without until the mute is forever.',
      inputSchema: { chat_id: chatId, until: z.iso.datetime({ offset: true }).max(40).optional().describe('ISO 8601 with offset, in the future') },
      annotations: WHATSAPP_WRITE,
    },
    (a) =>
      run(() => {
        let untilSec: number | null = null;
        if (a.until !== undefined) {
          untilSec = Math.floor(Date.parse(a.until) / 1000);
          if (untilSec <= d.actions.now()) throw new AppError('VALIDATION', 'until must be in the future');
        }
        return muteChat(d.actions, a.chat_id, untilSec);
      }),
  );

  server.registerTool(
    'unmute_chat',
    { description: 'Unmute notifications for a chat in WhatsApp.', inputSchema: { chat_id: chatId }, annotations: WHATSAPP_WRITE },
    (a) => run(() => unmuteChat(d.actions, a.chat_id)),
  );
}
