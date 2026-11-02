import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActionDeps } from '../actions/context.js';
import type { Db } from '../store/db.js';
import type { ContactsRepo } from '../store/contacts-repo.js';
import type { VoiceRepo } from '../store/voice-repo.js';
import type { ConnectionState } from '../whatsapp/types.js';
import { registerDestructiveTools } from './tools/destructive.js';
import { registerMessagingTools } from './tools/messaging.js';
import { registerOrganizeTools } from './tools/organize.js';
import { registerReadTools } from './tools/read.js';
import { registerTrackingTools } from './tools/tracking.js';
import { registerVoiceTools } from './tools/voice.js';

export interface StatusReport {
  connection: ConnectionState;
  lastEventAt: string | null;
  chats: number;
  messages: number;
  pending: number;
}

export interface ToolDeps {
  actions: ActionDeps;
  db: Db;
  voice: VoiceRepo;
  contacts: ContactsRepo;
  status: () => StatusReport;
}

export function buildServer(deps: ToolDeps, instructions: string): McpServer {
  const server = new McpServer({ name: 'wasap', version: '0.1.0' }, { instructions });
  registerReadTools(server, deps);
  registerTrackingTools(server, deps);
  registerVoiceTools(server, deps);
  registerMessagingTools(server, deps);
  registerOrganizeTools(server, deps);
  registerDestructiveTools(server, deps);
  return server;
}
