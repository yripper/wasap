export function connectionSnippets(port: number, token: string): string {
  const url = `http://127.0.0.1:${port}/mcp`;
  // Claude Desktop's connectors run in Anthropic's cloud and can't reach
  // localhost, so Desktop goes through the local mcp-remote stdio bridge.
  // No space after "Authorization:" because Desktop on Windows mangles spaces in args.
  const desktop = {
    wasap: {
      command: 'npx',
      args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
      env: { AUTH_HEADER: `Bearer ${token}` },
    },
  };
  return [
    'Claude Code:',
    `  claude mcp add --transport http wasap ${url} --header "Authorization: Bearer ${token}"`,
    '',
    'Claude Desktop (add under "mcpServers" in claude_desktop_config.json):',
    JSON.stringify(desktop, null, 2),
  ].join('\n');
}
