import type { ChatRow } from '../store/types.js';

/// Picks which chat id survives when a lid/pn pair turns out to be one person.
/// The older chat wins because it is the one the user has been curating; a tie
/// or no chats at all falls to the phone-number form, the stabler identity.
export function chooseCanonical(
  lid: string,
  pn: string,
  existing: { lid: ChatRow | null; pn: ChatRow | null },
): { canonical: string; mergeFrom: string | null } {
  const { lid: l, pn: p } = existing;
  if (l && p) {
    return l.createdAt < p.createdAt ? { canonical: lid, mergeFrom: pn } : { canonical: pn, mergeFrom: lid };
  }
  if (l) return { canonical: lid, mergeFrom: null };
  return { canonical: pn, mergeFrom: null };
}
