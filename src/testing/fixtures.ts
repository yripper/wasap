import type { WAMessage, proto } from '@whiskeysockets/baileys';

export const DM_JID = '111@s.whatsapp.net';
export const LID_JID = '222@lid';
export const GROUP_JID = '999-1@g.us';

export function waMessage(opts: {
  chat?: string;
  id?: string;
  fromMe?: boolean;
  participant?: string;
  message?: proto.IMessage | null;
  ts?: number;
  remoteJidAlt?: string;
  participantAlt?: string;
  pushName?: string;
}): WAMessage {
  return {
    key: {
      remoteJid: opts.chat ?? DM_JID,
      id: opts.id ?? 'M1',
      fromMe: opts.fromMe ?? false,
      participant: opts.participant,
      remoteJidAlt: opts.remoteJidAlt,
      participantAlt: opts.participantAlt,
    },
    message: opts.message === undefined ? { conversation: 'hello' } : opts.message,
    messageTimestamp: opts.ts ?? 1700000000,
    ...(opts.pushName === undefined ? {} : { pushName: opts.pushName }),
  };
}
