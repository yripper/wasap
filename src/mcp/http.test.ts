import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostAllowed, type RunningHttp, startHttpServer, tokenMatches } from './http.js';

const TOKEN = 'test-token-123';
let running: RunningHttp;

function send(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: running.port, method: opts.method ?? 'POST', path: opts.path ?? '/mcp', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

const auth = (): Record<string, string> => ({ authorization: `Bearer ${TOKEN}`, host: `127.0.0.1:${running.port}` });

beforeEach(async () => {
  running = await startHttpServer({ port: 0, token: TOKEN, log: () => {}, buildServer: () => new McpServer({ name: 'wasap', version: '0.1.0' }) });
});

afterEach(async () => {
  await running.close();
});

describe('startHttpServer', () => {
  it('rejects requests without the bearer token', async () => {
    expect((await send({ headers: { host: `127.0.0.1:${running.port}` } })).status).toBe(401);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    expect((await send({ headers: { ...auth(), host: `evil.example:${running.port}` } })).status).toBe(403);
  });

  it('only serves /mcp', async () => {
    expect((await send({ path: '/other', headers: auth() })).status).toBe(404);
  });

  it('rejects non-POST methods', async () => {
    expect((await send({ method: 'GET', headers: auth() })).status).toBe(405);
  });

  it('checks Host before the token: foreign Host without a token is 403, not 401', async () => {
    expect((await send({ headers: { host: `evil.example:${running.port}` } })).status).toBe(403);
  });

  it('checks the token before the method: GET without a token is 401', async () => {
    expect((await send({ method: 'GET', headers: { host: `127.0.0.1:${running.port}` } })).status).toBe(401);
  });

  it('rejects a wrong token of the same length', async () => {
    const wrong = 'x'.repeat(TOKEN.length);
    expect((await send({ headers: { host: `127.0.0.1:${running.port}`, authorization: `Bearer ${wrong}` } })).status).toBe(401);
  });

  it.each(['Basic x', `bearer ${TOKEN}`, TOKEN])('rejects a malformed authorization scheme (%s)', async (authorization) => {
    expect((await send({ headers: { host: `127.0.0.1:${running.port}`, authorization } })).status).toBe(401);
  });

  it('answers 500 instead of an unhandled rejection when building the server throws', async () => {
    await running.close();
    const lines: string[] = [];
    running = await startHttpServer({
      port: 0,
      token: TOKEN,
      log: (l) => lines.push(l),
      buildServer: () => {
        throw new Error('boom');
      },
    });
    expect((await send({ headers: auth(), body: '{}' })).status).toBe(500);
    expect(lines).toEqual(['mcp: request failed: Error: boom']);
  });

  it('answers an MCP initialize request', async () => {
    const res = await send({
      headers: { ...auth(), 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).result.serverInfo.name).toBe('wasap');
  });
});

describe('tokenMatches / hostAllowed', () => {
  it('compares the full bearer header', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN)).toBe(false);
  });

  it('fails closed on an empty configured token', () => {
    expect(tokenMatches('Bearer ', '')).toBe(false);
    expect(tokenMatches(undefined, '')).toBe(false);
  });

  it('allows only loopback hosts on the right port', () => {
    expect(hostAllowed('127.0.0.1:7777', 7777)).toBe(true);
    expect(hostAllowed('localhost:7777', 7777)).toBe(true);
    expect(hostAllowed('localhost:7778', 7777)).toBe(false);
    expect(hostAllowed(undefined, 7777)).toBe(false);
  });
});
