import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { markRead, sendMessage } from '../../actions/messaging.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { WHATSAPP_WRITE } from './annotations.js';
import { chatId } from './read.js';

const recipient = z.string().min(1).max(128).describe('Chat id (JID) from list_chats or get_pending, or a phone number with country code for someone new');

export function registerMessagingTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'send_message',
    {
      description:
        'Send a WhatsApp message AS THE USER, then mark the chat read. Always show the user the exact text and chat first and only call after they explicitly approve. chat_id is a chat id, or a phone number with country code (e.g. "+56 9 1234 5678" or "56912345678") to message someone with no chat yet: the number is checked with WhatsApp first (NOT_FOUND if it has no account) and the new chat is stored after sending. Unknown groups are rejected. Returns chatId, the id to use with read_history and the other tools. reply_to is the wa id of a stored message to quote.',
      inputSchema: { chat_id: recipient, text: z.string().min(1).max(4096), reply_to: z.string().min(1).max(128).optional() },
      annotations: WHATSAPP_WRITE,
    },
    (a) => run(() => sendMessage(d.actions, a.chat_id, a.text, a.reply_to)),
  );

  server.registerTool(
    'mark_read',
    { description: 'Mark a chat as read in WhatsApp. Returns {marked: false, reason} when there is no stored message to anchor on.', inputSchema: { chat_id: chatId }, annotations: WHATSAPP_WRITE },
    (a) =>
      run(async () =>
        // Silent success would let Claude report a chat as read when nothing happened.
        (await markRead(d.actions, a.chat_id)) ? { marked: true } : { marked: false, reason: 'no messages stored' },
      ),
  );
}
