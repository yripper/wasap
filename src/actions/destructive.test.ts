import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { leaveGroup } from './destructive.js';

const DM = '111@s.whatsapp.net';
const GROUP = '999-1@g.us';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps({ destructivePerMinute: 1 });
  t.chats.upsert({ id: DM, kind: 'dm' }, 0);
  t.chats.upsert({ id: GROUP, kind: 'group' }, 0);
  t.chats.upsert({ id: '999-2@g.us', kind: 'group' }, 0);
});

describe('leaveGroup', () => {
  it('leaves, audits and mutes the chat locally', async () => {
    await leaveGroup(t.deps, GROUP);
    expect(t.gateway.callsTo('leaveGroup')).toEqual([[GROUP]]);
    expect(t.chats.get(GROUP)?.watchLevel).toBe('muted');
    expect(t.audit.recent(1)[0]).toMatchObject({ action: 'leave_group', chatId: GROUP, outcome: 'ok' });
  });

  it('rejects DMs and unknown chats without calling WhatsApp', async () => {
    await expect(leaveGroup(t.deps, DM)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(leaveGroup(t.deps, '999-9@g.us')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.gateway.callsTo('leaveGroup')).toHaveLength(0);
  });

  it('is rate limited by the destructive limiter', async () => {
    await leaveGroup(t.deps, GROUP);
    await expect(leaveGroup(t.deps, '999-2@g.us')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('leaves watch level alone when WhatsApp fails', async () => {
    t.gateway.failOn.set('leaveGroup', new Error('boom'));
    await expect(leaveGroup(t.deps, GROUP)).rejects.toThrow('boom');
    expect(t.chats.get(GROUP)?.watchLevel).not.toBe('muted');
  });
});
