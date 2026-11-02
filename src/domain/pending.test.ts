import { describe, expect, it } from 'vitest';
import type { ChatRow } from '../store/types.js';
import { pendingReason } from './pending.js';

const NOW = 1000;

function chat(over: Partial<ChatRow> = {}): ChatRow {
  return {
    id: '999-1@g.us',
    kind: 'group',
    title: null,
    unreadCount: 0,
    markedUnread: false,
    archived: false,
    waMutedUntil: null,
    watchLevel: 'normal',
    category: 'general',
    snoozeUntil: null,
    lastMsgTs: null,
    lastMsgFromMe: null,
    createdAt: 1,
    ...over,
  };
}

describe('pendingReason', () => {
  it('marked-unread group on normal is marked_unread', () => {
    expect(pendingReason(chat({ markedUnread: true }), NOW)).toBe('marked_unread');
  });
  it('unread group on normal is not pending', () => {
    expect(pendingReason(chat({ unreadCount: 3 }), NOW)).toBeNull();
  });
  it('unread group on full is unread', () => {
    expect(pendingReason(chat({ unreadCount: 3, watchLevel: 'full' }), NOW)).toBe('unread');
  });
  it('unread DM is unread', () => {
    expect(pendingReason(chat({ kind: 'dm', id: '111@s.whatsapp.net', unreadCount: 1 }), NOW)).toBe('unread');
  });
  it('read DM is not pending', () => {
    expect(pendingReason(chat({ kind: 'dm' }), NOW)).toBeNull();
  });
  it('active snooze hides, expired snooze (or exactly now) shows again', () => {
    const base = { kind: 'dm' as const, unreadCount: 1 };
    expect(pendingReason(chat({ ...base, snoozeUntil: NOW + 1 }), NOW)).toBeNull();
    expect(pendingReason(chat({ ...base, snoozeUntil: NOW }), NOW)).toBe('unread');
    expect(pendingReason(chat({ ...base, snoozeUntil: NOW - 1 }), NOW)).toBe('unread');
  });
  it('ignores WhatsApp mute', () => {
    expect(pendingReason(chat({ kind: 'dm', unreadCount: 1, waMutedUntil: NOW + 9999 }), NOW)).toBe('unread');
  });
  it('archived and muted watch level are never pending', () => {
    expect(pendingReason(chat({ kind: 'dm', unreadCount: 1, archived: true }), NOW)).toBeNull();
    expect(pendingReason(chat({ kind: 'dm', unreadCount: 1, markedUnread: true, watchLevel: 'muted' }), NOW)).toBeNull();
  });
});
