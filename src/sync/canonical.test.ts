import { describe, expect, it } from 'vitest';
import type { ChatRow } from '../store/types.js';
import { chooseCanonical } from './canonical.js';

const LID = '222@lid';
const PN = '111@s.whatsapp.net';

function row(id: string, createdAt: number): ChatRow {
  return {
    id, kind: 'dm', title: null, unreadCount: 0, markedUnread: false, archived: false, waMutedUntil: null,
    watchLevel: 'normal', category: 'general', snoozeUntil: null, lastMsgTs: null, lastMsgFromMe: null, createdAt,
  };
}

describe('chooseCanonical', () => {
  it('older chat wins when both exist', () => {
    expect(chooseCanonical(LID, PN, { lid: row(LID, 5), pn: row(PN, 9) })).toEqual({ canonical: LID, mergeFrom: PN });
    expect(chooseCanonical(LID, PN, { lid: row(LID, 9), pn: row(PN, 5) })).toEqual({ canonical: PN, mergeFrom: LID });
  });
  it('tie goes to the phone form', () => {
    expect(chooseCanonical(LID, PN, { lid: row(LID, 5), pn: row(PN, 5) })).toEqual({ canonical: PN, mergeFrom: LID });
  });
  it('the only existing chat wins', () => {
    expect(chooseCanonical(LID, PN, { lid: row(LID, 5), pn: null })).toEqual({ canonical: LID, mergeFrom: null });
    expect(chooseCanonical(LID, PN, { lid: null, pn: row(PN, 5) })).toEqual({ canonical: PN, mergeFrom: null });
  });
  it('phone form wins when neither exists', () => {
    expect(chooseCanonical(LID, PN, { lid: null, pn: null })).toEqual({ canonical: PN, mergeFrom: null });
  });
});
