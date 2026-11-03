import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { createUnlinkedGateway } from './unlinked-gateway.js';

const key = { waId: 'M1', fromMe: false, senderJid: null, ts: 1 };

describe('createUnlinkedGateway', () => {
  it('reports logged_out', () => {
    expect(createUnlinkedGateway().state()).toBe('logged_out');
  });

  it('rejects every WhatsApp call with LOGGED_OUT', async () => {
    const gw = createUnlinkedGateway();
    const calls = [
      gw.sendText('111@s.whatsapp.net', 'x'),
      gw.markRead('111@s.whatsapp.net', key),
      gw.setArchived('111@s.whatsapp.net', true, key),
      gw.setMuted('111@s.whatsapp.net', null),
      gw.leaveGroup('999-1@g.us'),
      gw.groupTitle('999-1@g.us'),
    ];
    for (const c of calls) {
      const err: unknown = await c.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('LOGGED_OUT');
    }
  });

  it('accepts handlers and stops without error', async () => {
    const gw = createUnlinkedGateway();
    gw.onEvent(() => {});
    await expect(gw.stop()).resolves.toBeUndefined();
  });
});
