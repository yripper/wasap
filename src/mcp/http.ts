import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { describeError } from '../domain/errors.js';

export interface HttpOptions {
  port: number;
  token: string;
  buildServer: () => McpServer;
  log: (line: string) => void;
}

export interface RunningHttp {
  port: number;
  close(): Promise<void>;
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  // Fail closed: an empty token would accept the literal header "Bearer ".
  if (!token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? '');
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/// A malicious web page can rebind its own hostname to 127.0.0.1, but the
/// browser still sends that hostname in Host, so loopback-only Host values
/// block it. The SDK's built-in host validation is deprecated in favor of
/// external checks, hence this one.
export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

const reply = (res: ServerResponse, status: number): void => {
  res.writeHead(status).end();
};

export async function startHttpServer(o: HttpOptions): Promise<RunningHttp> {
  let port = o.port;

  // Stateless: a fresh server + transport per request (SDK's stateless example),
  // so no session state can leak between Claude clients.
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, port)) return reply(res, 403);
    if ((req.url ?? '').split('?')[0] !== '/mcp') return reply(res, 404);
    if (!tokenMatches(req.headers.authorization, o.token)) return reply(res, 401);
    if (req.method !== 'POST') return reply(res, 405);
    // Everything that can throw sits inside the try: the listener calls
    // handle() with `void`, so an escaping rejection would be unhandled.
    try {
      const mcp = o.buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close().catch((e: unknown) => o.log(`mcp: transport close failed: ${describeError(e)}`));
        mcp.close().catch((e: unknown) => o.log(`mcp: server close failed: ${describeError(e)}`));
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      o.log(`mcp: request failed: ${describeError(e)}`);
      if (!res.headersSent) reply(res, 500);
    }
  }

  const server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address && typeof address === 'object') port = address.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
