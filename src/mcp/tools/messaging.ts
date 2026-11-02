import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { markRead, sendMessage } from '../../actions/messaging.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { WHATSAPP_WRITE } from './annotations.js';
import { chatId } from './read.js';

export function registerMessagingTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'send_message',
    {
      description:
        'Send a WhatsApp message AS THE USER, then mark the chat read. Always show the user the exact text and chat first and only call after they explicitly approve. reply_to is the wa id of a stored message to quote.',
      inputSchema: { chat_id: chatId, text: z.string().min(1).max(4096), reply_to: z.string().min(1).max(128).optional() },
      annotations: WHATSAPP_WRITE,
    },
    (a) => run(() => sendMessage(d.actions, a.chat_id, a.text, a.reply_to)),
  );

  server.registerTool(
    'mark_read',
    { description: 'Mark a chat as read in WhatsApp.', inputSchema: { chat_id: chatId }, annotations: WHATSAPP_WRITE },
    (a) => run(() => markRead(d.actions, a.chat_id)),
  );
}
