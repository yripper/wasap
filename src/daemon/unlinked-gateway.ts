import { AppError } from '../domain/errors.js';
import type { WhatsAppGateway } from '../whatsapp/types.js';

export const NOT_LINKED = 'WhatsApp is not linked: run `pm2 stop wasap && wasap login && pm2 start wasap`';

/// Stands in for the Baileys gateway when the auth dir has no paired device, so
/// the daemon stays up (no pm2 crash loop), `status` and store reads keep working,
/// and every WhatsApp call fails with an actionable LOGGED_OUT instead.
/// `reason` is the factory's log-safe AppError message (not linked vs unreadable session).
export function createUnlinkedGateway(reason: string = NOT_LINKED): WhatsAppGateway {
  const reject = (): Promise<never> => Promise.reject(new AppError('LOGGED_OUT', reason));
  return {
    onEvent: () => {},
    sendText: reject,
    markRead: reject,
    setArchived: reject,
    setMuted: reject,
    leaveGroup: reject,
    groupTitle: reject,
    onWhatsApp: reject,
    state: () => 'logged_out',
    stop: async () => {},
  };
}
