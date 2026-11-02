import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cleanupApply, cleanupPlan } from '../../actions/cleanup.js';
import { leaveGroup } from '../../actions/destructive.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { DESTRUCTIVE, LOCAL_WRITE } from './annotations.js';
import { chatId } from './read.js';

const iso = (sec: number | null): string | null => (sec === null ? null : new Date(sec * 1000).toISOString());

export function registerDestructiveTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'leave_group',
    { description: 'Leave a WhatsApp group. Confirm with the user first.', inputSchema: { chat_id: chatId }, annotations: DESTRUCTIVE },
    (a) => run(() => leaveGroup(d.actions, a.chat_id)),
  );

  // Not READ: it stores a draft plan row (local only, nothing changes in WhatsApp).
  server.registerTool(
    'cleanup_plan',
    {
      description:
        'Step 1 of group cleanup: list groups where the user has not sent a message in inactive_days, without changing anything. Groups on full watch are never included. Show the numbered list to the user, then call cleanup_apply with the chat ids they approved. Plans expire after 30 minutes.',
      inputSchema: { inactive_days: z.number().int().min(1).max(3650) },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        const plan = cleanupPlan(d.actions, { inactiveDays: a.inactive_days, excludeFull: true });
        return {
          plan_id: plan.id,
          expires_at: iso(plan.expiresAt),
          count: plan.items.length,
          items: plan.items.map((item, i) => ({
            n: i + 1,
            chat_id: item.chatId,
            title: item.title,
            unread: item.unreadCount,
            last_message_at: iso(item.lastMsgTs),
            my_last_message_at: iso(item.myLastMsgTs),
          })),
        };
      }),
  );

  server.registerTool(
    'cleanup_apply',
    {
      description:
        'Step 2 of group cleanup: leave the given groups from a cleanup_plan. chat_ids are the ones the user approved. Single-use plan. Returns {left, failed}; ids not in the plan or now on full watch go to failed. Confirm with the user first.',
      inputSchema: { plan_id: z.string().min(1).max(64), chat_ids: z.array(chatId).min(1).max(500) },
      annotations: DESTRUCTIVE,
    },
    (a) => run(() => cleanupApply(d.actions, a.plan_id, a.chat_ids)),
  );
}
