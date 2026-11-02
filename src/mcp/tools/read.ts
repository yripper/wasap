import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireChat } from '../../actions/context.js';
import { listPending } from '../../store/pending-query.js';
import { formatChat, formatMessage, formatPending } from '../format.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { READ } from './annotations.js';

export const chatId = z.string().min(1).max(128).describe('Chat id (JID) from list_chats or get_pending');

export function registerReadTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'status',
    { description: 'Wasap health: WhatsApp connection state, last event time, store size and how many chats are pending. Local reads work in every state; WhatsApp calls need connection open.', inputSchema: {}, annotations: READ },
    () => run(() => d.status()),
  );

  server.registerTool(
    'list_chats',
    {
      description: 'List chats from the local mirror, most recent first. Filter by kind, watch level, category, or title/id text.',
      inputSchema: {
        kind: z.enum(['dm', 'group']).optional(),
        watch_level: z.enum(['full', 'normal', 'muted']).optional(),
        category: z.string().min(1).max(32).optional(),
        query: z.string().min(1).max(256).optional().describe('Case-insensitive match on title or id'),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).max(100000).default(0),
      },
      annotations: READ,
    },
    (a) =>
      run(() => {
        const now = d.actions.now();
        return d.actions.chats
          .list({ kind: a.kind, watchLevel: a.watch_level, category: a.category, query: a.query, limit: a.limit, offset: a.offset })
          .map((c) => formatChat(c, now));
      }),
  );

  server.registerTool(
    'get_pending',
    {
      description:
        "WhatsApp's unread list: chats marked unread, DMs with unread messages and groups on full watch with unread messages. Excludes archived, muted-watch and snoozed chats. Marked-unread first, then full watch, then newest first. Each item carries the reason and the latest incoming message.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(30) },
      annotations: READ,
    },
    (a) =>
      run(() => {
        const now = d.actions.now();
        return listPending(d.db, now, a.limit).map((p) => formatPending(p, now));
      }),
  );

  server.registerTool(
    'read_history',
    {
      description: 'Messages in a chat from the local mirror, newest first. Paginate backwards with before_seq (the smallest seq you already have). Does not mark anything read.',
      inputSchema: {
        chat_id: chatId,
        limit: z.number().int().min(1).max(100).default(50),
        before_seq: z.number().int().positive().optional(),
      },
      annotations: READ,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        return d.actions.messages.history(a.chat_id, { limit: a.limit, beforeSeq: a.before_seq }).map(formatMessage);
      }),
  );

  server.registerTool(
    'search_messages',
    {
      description: 'Full-text search over mirrored messages (words matched literally), newest first. Optionally within one chat.',
      inputSchema: { query: z.string().min(1).max(256), chat_id: chatId.optional(), limit: z.number().int().min(1).max(100).default(30) },
      annotations: READ,
    },
    (a) =>
      run(() =>
        d.actions.messages.search(a.query, { chatId: a.chat_id, limit: a.limit }).map((m) => ({ chat_id: m.chatId, ...formatMessage(m) })),
      ),
  );

  server.registerTool(
    'get_chat_info',
    { description: 'One chat with its watch level, category, mute and snooze state.', inputSchema: { chat_id: chatId }, annotations: READ },
    (a) => run(() => formatChat(requireChat(d.actions, a.chat_id), d.actions.now())),
  );
}
