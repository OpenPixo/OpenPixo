import { INTEGRATIONS_MCP_PATH } from '@openpixo/contracts';

export function renderConnectedExternalMcpDirective(
  connectedExternalMcp:
    | ReadonlyArray<{ id: string; label?: string | undefined }>
    | undefined,
): string {
  if (!connectedExternalMcp || connectedExternalMcp.length === 0) return '';
  const lines = connectedExternalMcp
    .map((s) => {
      const id = typeof s?.id === 'string' ? s.id.trim() : '';
      if (!id) return null;
      const label = typeof s?.label === 'string' && s.label.trim() ? s.label.trim() : id;
      return `- \`${id}\`${label !== id ? ` (${label})` : ''}`;
    })
    .filter((line): line is string => typeof line === 'string');
  if (lines.length === 0) return '';
  // No leading separator: callers place this in a `---`-joined slice.
  return [
    '## External MCP servers — already authenticated\n\n',
    'The following external MCP servers are already authenticated for this run via an OAuth Bearer token the daemon injected into `.mcp.json`. You can call their real tools directly:\n\n',
    lines.join('\n'),
    '\n\n',
    '**Do NOT call any tool whose name matches `mcp__<server>__authenticate` or `mcp__<server>__complete_authentication` for the servers above.** Those are synthetic fallback tools Claude Code exposes when its first HTTP connect briefly flipped the server into a needs-auth state. The flow they drive (a `localhost:<random>/callback` redirect) cannot complete in this environment, and the real tools (e.g. `generate_image`, `models_explore`, `balance`, …) are already reachable.\n\n',
    `If a real tool actually fails with an auth-related error, report the exact tool name and error text and stop — the user will reconnect the server in ${INTEGRATIONS_MCP_PATH}. Do not retry by invoking any \`*_authenticate\` tool.\n`,
  ].join('');
}
