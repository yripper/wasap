import { describe, expect, it } from 'vitest';
import { connectionSnippets } from './snippets.js';

describe('connectionSnippets', () => {
  it('prints Claude Code and Claude Desktop setup for the local server', () => {
    const out = connectionSnippets(7778, 'tok');
    expect(out).toContain('claude mcp add --transport http wasap http://127.0.0.1:7778/mcp --header "Authorization: Bearer tok"');
    expect(out).toContain('"mcp-remote"');
    expect(out).toContain('"AUTH_HEADER": "Bearer tok"');
  });
});
