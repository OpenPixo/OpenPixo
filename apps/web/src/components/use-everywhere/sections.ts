// Shared content for the integration UI and copied agent guide.
import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
export interface CodeSnippet {
  label: string;
  language: 'bash' | 'json' | 'http' | 'yaml' | 'ts' | 'tsx' | 'text';
  body: string;
}

export interface GuideSection {
  id: 'overview' | 'cli' | 'mcp' | 'http' | 'skills';
  tabLabel: string;
  heading: string;
  intro: string;
  bullets: string[];
  snippets: CodeSnippet[];
  footer?: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'overview',
    tabLabel: 'Overview',
    heading: 'Connect your game development tools to OpenPixo',
    intro: `OpenPixo is a local AI workbench for independent game developers. Open a game folder, work with Codex, and inspect real project files and assets. The desktop UI, ${PRODUCT_CLI_NAME} CLI, HTTP API, and MCP server share the local daemon.`,
    bullets: [
      'Projects and conversations — open existing game folders and continue their task history.',
      'Codex tasks — follow replies, tool output, approvals, interruptions, and child tasks.',
      'Files and changes — inspect code, compare changes, and open files in external tools.',
      'Game assets — preview images, play audio, filter files, and reference selected paths in chat.',
      'Extensions and settings — manage project skills/MCP and configure Codex or supported providers.',
    ],
    snippets: [
      { label: 'Start the source workspace', language: 'bash', body: 'pnpm tools-dev' },
      { label: 'Check the running daemon', language: 'bash', body: 'curl -s http://127.0.0.1:7456/api/health | jq' },
      { label: 'List registered game projects', language: 'bash', body: `${PRODUCT_CLI_NAME} project list --daemon-url http://127.0.0.1:7456 --json` },
    ],
    footer: 'Use the running app’s daemon URL; 7456 is an example port. Storage configuration follows AGENTS.md → Daemon data directory contract. Local use needs no OpenPixo account; model services use their own credentials.',
  },
  {
    id: 'cli',
    tabLabel: `CLI · ${PRODUCT_CLI_NAME}`,
    heading: 'Use game projects from the command line',
    intro: `The CLI keeps its compatible ${PRODUCT_CLI_NAME} name. Start the app first, then use the same local HTTP endpoints as the UI. Import-folder references the existing game folder. Model tasks use the selected Codex account or provider configuration.`,
    bullets: [
      `\`${PRODUCT_CLI_NAME} status\` / \`${PRODUCT_CLI_NAME} doctor\` — check the local daemon and installed agents.`,
      `\`${PRODUCT_CLI_NAME} project import-folder <path>\` — open an existing game project.`,
      `\`${PRODUCT_CLI_NAME} run start\` — send a task to a project and conversation; \`--prompt-file <path|->\` accepts long instructions.`,
      `\`${PRODUCT_CLI_NAME} run approvals\` / \`${PRODUCT_CLI_NAME} run approve\` — inspect and answer explicit permission requests.`,
      `\`${PRODUCT_CLI_NAME} skills list\` / \`${PRODUCT_CLI_NAME} extensions list\` — inspect available skills and project extensions.`,
      `\`${PRODUCT_CLI_NAME} files list\` / \`${PRODUCT_CLI_NAME} files read\` — inspect the actual project files.`,
    ],
    snippets: [
      { label: 'Check the local environment', language: 'bash', body: `${PRODUCT_CLI_NAME} doctor\nod status --json` },
      {
        label: 'Import a game folder and start a Codex task (POSIX shell)',
        language: 'bash',
        body: 'DAEMON_URL=http://127.0.0.1:7456\n' +
          '# Set GAME_DIR to the game folder you want to open.\n' +
          `PROJECT_JSON=$(${PRODUCT_CLI_NAME} project import-folder "$GAME_DIR" --json --daemon-url "$DAEMON_URL")\n` +
          'PROJECT_ID=$(printf \'%s\' "$PROJECT_JSON" | jq -r \'.project.id\')\n' +
          'CONVERSATION_ID=$(printf \'%s\' "$PROJECT_JSON" | jq -r \'.conversationId\')\n' +
          `${PRODUCT_CLI_NAME} run start --project "$PROJECT_ID" --conversation "$CONVERSATION_ID" \\\n` +
          '  --agent codex --prompt-file task.md --daemon-url "$DAEMON_URL" --follow --json',
      },
      {
        label: 'Answer a clarification in the same conversation',
        language: 'bash',
        body: `${PRODUCT_CLI_NAME} run start --project "$PROJECT_ID" --conversation "$CONVERSATION_ID" \\\n` +
          '  --agent codex --message "[form answers - discovery]\n' +
          '- Goal: Review the asset folders and report unused files\n' +
          '- Constraint: Keep the original files unchanged" \\\n' +
          '  --daemon-url "$DAEMON_URL" --follow --json',
      },
      { label: 'Inspect skills and project extensions', language: 'bash', body: `${PRODUCT_CLI_NAME} skills list --json\nod extensions list --project "$PROJECT_ID" --json` },
      { label: 'Inspect files and pending permissions', language: 'bash', body: `${PRODUCT_CLI_NAME} files list "$PROJECT_ID" --daemon-url "$DAEMON_URL" --json\nod run approvals "$RUN_ID" --json` },
    ],
    footer: 'Use the daemon URL reported by your running app. The multi-line variable examples use a POSIX shell; on Windows use PowerShell equivalents or copy project/conversation IDs from --json output. Starting a task consumes the selected model service’s usage.',
  },
  {
    id: 'mcp',
    tabLabel: 'MCP server',
    heading: 'Connect external tools through MCP',
    intro: `There are two directions: project MCP extensions provide tools to Codex inside OpenPixo; the ${PRODUCT_CLI_NAME} mcp server exposes OpenPixo tools to an external MCP client. Configure project tools in the project’s Extensions tab. Use the install-info endpoint for the external-client launch configuration.`,
    bullets: [
      'Project MCP — import or configure a server, check dependencies, and enable it for this project.',
      'Connection feedback — inspect the native runtime’s startup result instead of assuming configuration means connection.',
      'External clients — copy the launch configuration reported by the running daemon.',
      'Packaged installs — preserve the returned command, args, and env; keep data-root configuration aligned with the daemon.',
    ],
    snippets: [
      { label: `Minimal external-client config when ${PRODUCT_CLI_NAME} is on PATH`, language: 'json', body: `{\n  "mcpServers": {\n    "openpixo": {\n      "command": "${PRODUCT_CLI_NAME}",\n      "args": ["mcp", "--daemon-url", "http://127.0.0.1:7456"]\n    }\n  }\n}` },
      { label: 'Get the launch configuration for this installation', language: 'bash', body: 'curl -s http://127.0.0.1:7456/api/mcp/install-info | jq' },
      { label: 'Inspect the MCP CLI options', language: 'bash', body: `${PRODUCT_CLI_NAME} mcp --help` },
    ],
    footer: 'Settings → Integrations configures external clients. Project → Extensions configures the skills/MCP used by Codex in that game project. Installations and connection checks do not prove a tool has completed a real model task.',
  },
  {
    id: 'http',
    tabLabel: 'HTTP API',
    heading: 'Use the same local HTTP endpoints as the UI',
    intro: 'The daemon owns project state and task execution. Use REST for requests and SSE for streamed events. Keep any configured authentication headers with your client; never put credentials into game files or shared prompts.',
    bullets: [
      '`GET /api/health` — daemon availability.',
      '`GET /api/skills` — locally available resources.',
      '`GET /api/projects` — registered projects.',
      '`GET /api/projects/:id/chat` — conversation event stream.',
      '`GET /api/mcp/install-info` — installation-specific MCP launch details.',
      '`GET /api/agents` — detected local agents.',
    ],
    snippets: [
      { label: 'List available skills', language: 'bash', body: 'curl -s http://127.0.0.1:7456/api/skills | jq \'.skills\'' },
      { label: 'List projects', language: 'bash', body: 'curl -s http://127.0.0.1:7456/api/projects | jq' },
      { label: 'Read a conversation event stream', language: 'bash', body: 'curl -N -H \'accept: text/event-stream\' \\\n  \'http://127.0.0.1:7456/api/projects/<projectId>/chat?conversationId=<convId>\'' },
    ],
    footer: 'Shared request/response types remain in @openpixo/contracts for compatibility. The package name does not identify a hosted OpenPixo service.',
  },
  {
    id: 'skills',
    tabLabel: 'Project skills',
    heading: 'Use skills for repeatable game development work',
    intro: 'A skill is a SKILL.md instruction package. Import it from a local folder or GitHub, inspect its source and version, then enable it in the game project. Skills guide Codex; they are distinct from MCP tool connections.',
    bullets: [
      'Keep skills scoped to the game project that needs them.',
      'Review source, version, configuration requirements, and enabled state in Extensions.',
      'Use chat to request code changes, asset checks, or simple batch processing.',
      'For batch work, preserve originals and inspect derived files and execution output.',
      'Update extensions explicitly. Removing an extension keeps project code and assets.',
    ],
    snippets: [
      { label: 'Example asset-review skill', language: 'yaml', body: '---\nname: review-game-assets\ndescription: Review image and audio assets in the current game project\n---\n\n# Game asset review\n\nInspect selected files, report sizes and formats, and list suggested changes.\nKeep originals unchanged. Ask before deleting or overwriting source assets.\n' },
      { label: 'Inspect project-managed extensions', language: 'bash', body: `${PRODUCT_CLI_NAME} extensions list --project "$PROJECT_ID" --json` },
      { label: 'List available skills', language: 'bash', body: `${PRODUCT_CLI_NAME} skills list --json` },
      { label: 'Use a skill from the workbench', language: 'text', body: '1. Open your game project.\n2. Open Extensions and import or enable a skill.\n3. Select relevant files in Assets and add them to chat.\n4. Ask Codex to run the task, then inspect its output and resulting files.' },
    ],
    footer: 'OpenPixo reuses the upstream skill format and od metadata for compatibility. Source documentation: docs/skills-protocol.md and docs/agent-adapters.md. Provider capability and real-game acceptance are tracked separately.',
  },
];
