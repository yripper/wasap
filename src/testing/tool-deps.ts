import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildInstructions } from '../mcp/instructions.js';
import { buildServer, type ToolDeps } from '../mcp/server.js';
import { ContactsRepo } from '../store/contacts-repo.js';
import { VoiceRepo } from '../store/voice-repo.js';
import { listPending } from '../store/pending-query.js';
import { makeActionDeps } from './action-deps.js';

export function makeToolDeps(): { deps: ToolDeps; t: ReturnType<typeof makeActionDeps>; contacts: ContactsRepo; voice: VoiceRepo } {
  const t = makeActionDeps();
  const contacts = new ContactsRepo(t.db);
  const voice = new VoiceRepo(t.db);
  const count = (table: string): number => (t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const deps: ToolDeps = {
    actions: t.deps,
    db: t.db,
    voice,
    contacts,
    status: () => ({
      connection: t.gateway.state(),
      lastEventAt: null,
      chats: count('chats'),
      messages: count('messages'),
      pending: listPending(t.db, t.deps.now(), 100_000).length,
    }),
  };
  return { deps, t, contacts, voice };
}

export async function connect(deps: ToolDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([buildServer(deps, buildInstructions(null)).connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
