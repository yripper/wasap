import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireChat } from '../../actions/context.js';
import { AppError } from '../../domain/errors.js';
import { staleProfiles, voiceContext } from '../../domain/voice.js';
import type { MessageRow } from '../../store/types.js';
import { formatMessage } from '../format.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { LOCAL_WRITE, READ } from './annotations.js';
import { chatId } from './read.js';
import { category } from './schemas.js';

const CHAT_SAMPLE = 60;
const CATEGORY_SAMPLE = 40;

/// Only messages with words in them teach a style; deleted and media-only rows don't.
function ownTexts(rows: MessageRow[]): MessageRow[] {
  return rows.filter((m) => m.deletedAt === null && m.text);
}

function categoryChatIds(d: ToolDeps, name: string): string[] {
  return d.actions.chats.list({ category: name, limit: 100_000, offset: 0 }).map((c) => c.id);
}

export function registerVoiceTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'get_voice',
    {
      description:
        "Call before drafting for a chat. Returns the chat's category, the saved tone profile and chat notes, and staleness flags. When needsLearning (no profile, or it is stale) or the notes are stale, also returns the user's own recent messages in this chat (up to 60) and, when needsLearning, across the category (up to 40) so you can learn the style, then call save_profile / save_chat_notes.",
      inputSchema: { chat_id: chatId },
      annotations: READ,
    },
    (a) =>
      run(() => {
        const ctx = voiceContext({ chats: d.actions.chats, messages: d.actions.messages, voice: d.voice }, a.chat_id, d.actions.now());
        const out: Record<string, unknown> = { ...ctx };
        if (ctx.needsLearning || ctx.notesStale) {
          out.my_messages_in_chat = ownTexts(d.actions.messages.outgoing([a.chat_id], { limit: CHAT_SAMPLE })).map(formatMessage);
        }
        if (ctx.needsLearning) {
          const rows = d.actions.messages.outgoing(categoryChatIds(d, ctx.category), { limit: CATEGORY_SAMPLE });
          out.my_messages_in_category = ownTexts(rows).map((m) => ({ chat_id: m.chatId, ...formatMessage(m) }));
        }
        return out;
      }),
  );

  server.registerTool(
    'get_my_messages',
    {
      description: "The user's own recent messages, newest first, from one chat or across a category. Give exactly one of chat_id or category.",
      inputSchema: { chat_id: chatId.optional(), category: category.optional(), limit: z.number().int().min(1).max(200).default(60) },
      annotations: READ,
    },
    (a) =>
      run(() => {
        if ((a.chat_id === undefined) === (a.category === undefined)) {
          throw new AppError('VALIDATION', 'give exactly one of chat_id or category');
        }
        if (a.chat_id !== undefined) requireChat(d.actions, a.chat_id);
        const ids = a.chat_id !== undefined ? [a.chat_id] : categoryChatIds(d, a.category ?? '');
        return ownTexts(d.actions.messages.outgoing(ids, { limit: a.limit })).map((m) => ({ chat_id: m.chatId, ...formatMessage(m) }));
      }),
  );

  server.registerTool(
    'save_profile',
    {
      description: 'Save the tone profile for a category (replaces the previous one). Describe the style; do not copy private facts verbatim.',
      inputSchema: { category, body: z.string().min(1).max(4000) },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        d.voice.saveProfile(a.category, a.body, d.actions.now());
        return { ok: true };
      }),
  );

  server.registerTool(
    'save_chat_notes',
    {
      description: 'Save notes about how the user writes in one chat (replaces the previous ones). Describe the style; do not copy private facts verbatim.',
      inputSchema: { chat_id: chatId, body: z.string().min(1).max(2000) },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        d.voice.saveNotes(a.chat_id, a.body, d.actions.now());
        return { ok: true };
      }),
  );

  server.registerTool(
    'list_stale_profiles',
    { description: 'Categories whose saved tone profile is due for a refresh.', inputSchema: {}, annotations: READ },
    () => run(() => ({ categories: staleProfiles({ chats: d.actions.chats, messages: d.actions.messages, voice: d.voice }, d.actions.now()) })),
  );
}
