import type { ConnectionState, MessageKeyRef, WaEvent, WhatsAppGateway } from '../whatsapp/types.js';

/// In-memory WhatsApp for tests: records every call, failures are injectable per method.
export class FakeGateway implements WhatsAppGateway {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly failOn = new Map<string, Error>();
  readonly groupTitles = new Map<string, string>();
  connection: ConnectionState = 'open';
  private handlers: ((e: WaEvent) => void)[] = [];
  private nextId = 1;

  callsTo(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    const error = this.failOn.get(method);
    if (error) throw error;
  }

  emit(e: WaEvent): void {
    for (const h of this.handlers) h(e);
  }

  onEvent(h: (e: WaEvent) => void): void {
    this.handlers.push(h);
  }

  async sendText(chatId: string, text: string, quoted?: MessageKeyRef): Promise<{ waId: string; ts: number }> {
    this.record('sendText', [chatId, text, quoted]);
    return { waId: `SENT${this.nextId++}`, ts: 1700000000 };
  }

  async markRead(chatId: string, last: MessageKeyRef): Promise<void> {
    this.record('markRead', [chatId, last]);
  }

  async setArchived(chatId: string, archived: boolean, last: MessageKeyRef): Promise<void> {
    this.record('setArchived', [chatId, archived, last]);
  }

  async setMuted(chatId: string, untilSec: number | null): Promise<void> {
    this.record('setMuted', [chatId, untilSec]);
  }

  async leaveGroup(chatId: string): Promise<void> {
    this.record('leaveGroup', [chatId]);
  }

  async groupTitle(chatId: string): Promise<string | null> {
    this.record('groupTitle', [chatId]);
    return this.groupTitles.get(chatId) ?? null;
  }

  state(): ConnectionState {
    return this.connection;
  }
}
