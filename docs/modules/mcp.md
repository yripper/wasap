# MCP Module

> **Living document.** Read this before modifying the module. Update it in the same change whenever the module's behavior, public surface, files, or dependencies change.

**Source:** `src/mcp/` · **Last verified:** 2026-11-03

## Purpose

The MCP server Claude talks to: Streamable HTTP on `127.0.0.1` with bearer-token auth. So far only the transport and result helpers exist; the server and tools are added by later tasks.

## Structure

| File | Purpose |
|---|---|
| `src/mcp/http.ts` | `node:http` server: Host check, bearer auth, stateless transport per request |
| `src/mcp/result.ts` | `ok` / `fail` / `run`: tool result envelope and `CODE: message` errors |

## Public surface

- `startHttpServer(o: HttpOptions): Promise<RunningHttp>` (`http.ts:40`): bound to `127.0.0.1` only; `port: 0` picks a free port; `buildServer` is a factory supplied by the caller, called once per request.
- `tokenMatches(header, token)` (`http.ts:19`): constant-time compare of `Bearer <token>`; fails closed on an empty token.
- `hostAllowed(host, port)` (`http.ts:32`): only `127.0.0.1:<port>` or `localhost:<port>`.
- `ok(data)` (`result.ts:4`), `fail(e)` (`result.ts:10`), `run(fn)` (`result.ts:16`): errors come back as `isError: true` with `CODE: message` (plus `(retry after Ns)`).

## Dependencies

- `@modelcontextprotocol/sdk`, `src/domain/errors.ts`.

## Gotchas & invariants

- Check order in `handle`: Host (403), path `/mcp` (404), bearer token (401), POST only (405).
- Stateless: a fresh server and transport per request so no state leaks between clients.
- Handler errors are logged via `describeError`, never tokens or bodies.

## Testing

- `pnpm test src/mcp`: real server on an ephemeral port.
