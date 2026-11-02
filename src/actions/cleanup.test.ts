import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { cleanupApply, cleanupPlan, CLEANUP_CALL_GAP_MS } from './cleanup.js';

const DAY = 86_400;
const NOW = 10_000_000;
const STALE = '999-1@g.us';
const NEVER = '999-2@g.us';
const ACTIVE = '999-3@g.us';
const FULL = '999-4@g.us';
const DM = '111@s.whatsapp.net';

let t: ReturnType<typeof makeActionDeps>;

function msg(chatId: string, waId: string, ts: number, fromMe: boolean): void {
  t.messages.insertMany([{ chatId, waId, fromMe, senderJid: fromMe ? null : '222@lid', ts, text: 'hello', mediaKind: null, quotedId: null, sentViaWasap: false }]);
}

beforeEach(() => {
  t = makeActionDeps();
  for (const id of [STALE, NEVER, ACTIVE, FULL]) t.chats.upsert({ id, kind: 'group', title: `Group ${id}` }, 0);
  t.chats.upsert({ id: DM, kind: 'dm' }, 0);
  t.chats.setWatchLevel(FULL, 'full');
  msg(STALE, 'a', NOW - 100 * DAY, true);
  msg(STALE, 'b', NOW - 50 * DAY, false);
  msg(NEVER, 'c', NOW - 5 * DAY, false);
  msg(ACTIVE, 'd', NOW - 2 * DAY, true);
  msg(FULL, 'e', NOW - 200 * DAY, true);
  msg(DM, 'f', NOW - 200 * DAY, true);
});

const criteria = { inactiveDays: 30, excludeFull: true } as const;

describe('cleanupPlan', () => {
  it('lists inactive non-full groups with member-free stats and persists the plan', () => {
    const plan = cleanupPlan(t.deps, criteria);
    expect(plan.status).toBe('draft');
    expect(plan.items.map((i) => i.chatId).sort()).toEqual([STALE, NEVER]);
    expect(plan.items.find((i) => i.chatId === STALE)).toEqual({
      chatId: STALE, title: `Group ${STALE}`, kind: 'group', action: 'leave', lastMsgTs: NOW - 50 * DAY, myLastMsgTs: NOW - 100 * DAY, unreadCount: 0,
    });
    expect(plan.items.find((i) => i.chatId === NEVER)?.myLastMsgTs).toBeNull();
    expect(t.deps.plans.get(plan.id)).toEqual(plan);
    expect(t.gateway.callsTo('leaveGroup')).toHaveLength(0);
  });
});

describe('cleanupApply', () => {
  it('leaves only requested ids that are in the plan, paced with sleeps', async () => {
    const plan = cleanupPlan(t.deps, criteria);
    const res = await cleanupApply(t.deps, plan.id, [STALE, NEVER, ACTIVE]);
    expect(res).toEqual({ left: [STALE, NEVER], failed: [ACTIVE] });
    expect(t.gateway.callsTo('leaveGroup')).toEqual([[STALE], [NEVER]]);
    expect(t.sleeps).toEqual([CLEANUP_CALL_GAP_MS]);
    expect(t.deps.plans.get(plan.id)?.status).toBe('applied');
  });

  it('collects gateway failures instead of throwing', async () => {
    const plan = cleanupPlan(t.deps, criteria);
    t.gateway.failOn.set('leaveGroup', new Error('boom'));
    expect(await cleanupApply(t.deps, plan.id, [STALE])).toEqual({ left: [], failed: [STALE] });
  });

  it('skips a group promoted to full after planning', async () => {
    const plan = cleanupPlan(t.deps, criteria);
    t.chats.setWatchLevel(STALE, 'full');
    expect(await cleanupApply(t.deps, plan.id, [STALE])).toEqual({ left: [], failed: [STALE] });
    expect(t.gateway.callsTo('leaveGroup')).toHaveLength(0);
  });

  it('waits out the destructive limiter once per chat', async () => {
    const small = makeActionDeps({ destructivePerMinute: 1 });
    t = small;
    for (const id of [STALE, NEVER]) t.chats.upsert({ id, kind: 'group' }, 0);
    const plan = cleanupPlan(t.deps, { inactiveDays: 0, excludeFull: true });
    const res = await cleanupApply(t.deps, plan.id, [STALE, NEVER]);
    expect(res.left).toEqual([STALE]);
    expect(res.failed).toEqual([NEVER]);
    expect(t.sleeps.some((ms) => ms >= 59_000)).toBe(true);
  });

  it('rejects unknown, expired and already applied plans', async () => {
    await expect(cleanupApply(t.deps, 'nope', [STALE])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const plan = cleanupPlan(t.deps, criteria);
    await cleanupApply(t.deps, plan.id, [STALE]);
    await expect(cleanupApply(t.deps, plan.id, [NEVER])).rejects.toMatchObject({ code: 'VALIDATION' });
    const old = cleanupPlan(t.deps, criteria);
    t.clock.ms += 31 * 60 * 1000;
    await expect(cleanupApply(t.deps, old.id, [NEVER])).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('audits metadata only', async () => {
    const plan = cleanupPlan(t.deps, criteria);
    await cleanupApply(t.deps, plan.id, [STALE]);
    const rows = t.audit.recent(10);
    expect(rows[0]).toMatchObject({ action: 'leave_group', chatId: STALE, outcome: 'ok' });
    expect(JSON.stringify(rows)).not.toContain('hello');
  });
});
