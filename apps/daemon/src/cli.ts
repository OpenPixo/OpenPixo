#!/usr/bin/env node
// @ts-nocheck
import { runGameTemplateProjectCli } from './game/templates-cli.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { runDaemonCliStartup, startDaemonRuntime } from './daemon-startup.js';
import { runApprovalsMcpServer } from './runtimes/approvals-mcp-server.js';
import { runArtifactsCli } from './artifacts-cli.js';

import { runProjectExtensionsCli } from './services/project-extensions-cli.js';
import { runStoreCli } from './store/cli.js';
import { runPublishCli } from './publish/cli.js';
import { runRoomsCli } from './rooms/cli.js';
import { runOnlineCli } from './online/cli.js';
import { runStyleCli } from './styles/cli.js';
import { runAgentCapabilitiesCli } from './runtimes/capabilities-cli.js';
import { printProjectEngine } from './game/engine-cli.js';
import { runGameCli } from './game/install-deps-cli.js';
import { runGameTuningDispatch } from './game/tuning-cli.js';
import { runRecipeCli } from './recipes/recipe-cli.js';
import { runAccountCli } from './account/account-cli.js';
import { runCreditsCli } from './account/credits-cli.js';
import { CODEX_IMAGE_CLI_STRING_FLAGS, CODEX_IMAGE_CLI_HELP, codexImageCliModel, codexImageCliRequestOptions } from './media/codex-image-cli.js';
import { IMAGE_SHEET_CLI_BOOLEAN_FLAGS, IMAGE_SHEET_CLI_HELP, IMAGE_SHEET_CLI_STRING_FLAGS, IMAGE_SIZE_CLI_BOOLEAN_FLAGS, IMAGE_SIZE_CLI_HELP, IMAGE_SIZE_CLI_STRING_FLAGS, imageSheetCliRequestOptions, imageSizeCliRequestOptions } from './media/image-size-cli.js';
import { resolveSheetRequest } from './media/sheet-request.js';
import { confirmOpenPixoHosted, describeQuote, isOpenPixoHostedModel, OPENPIXO_CLI_HELP, OPENPIXO_CLI_STRING_FLAGS, requestOpenPixoQuote } from './media/openpixo-hosted-cli.js';
import { runCharacterCli } from './recipes/character-cli.js';
import { runAssetCli } from './assets/asset-cli.js';
import { runDoctorCli } from './cli-doctor.js';
import { runProjectNextStepsCli } from './projects/next-steps-cli.js';
import { GAME_SETUP_CLI_FLAGS, runProjectGameSetupCli } from './game/setup-cli.js';
import { runProjectCheckpointCli } from './projects/checkpoints-cli.js';
import { runDeliverableSyntaxToolCli } from './tools-deliverable-syntax-cli.js';
import { splitResearchSubcommand } from './research/cli-args.js';
import { resolveDaemonUrl } from './daemon-url.js';
import { byokProviderFromCliOptions } from './runtimes/byok-cli.js';

import { redactSecrets } from './connectionTest.js';
import { SidecarFactory } from '@openpixo/sidecar';
import { APP_KEYS, SIDECAR_MESSAGES } from '@openpixo/sidecar-proto';
import { AGENT_IMAGE_MODEL_AUTOMATIC, PRODUCT_CLI_NAME, EXPORT_FORMATS, EXPORT_IMAGE_FORMATS, mediaFailureNextStep, filterProjectAssets, PROJECT_ASSET_KINDS, nativeCodexProviderForConfig } from '@openpixo/contracts';
import type { AgentImageModelsResponse, ArtifactLintFinding, GetMediaCapabilitiesResponse, LintArtifactCliResultEnvelope, LintArtifactResponse, LintFailOn } from '@openpixo/contracts';
import { buildExportCliRequestBody, buildExportCliResultEnvelope, resolveExportCliDeckMode } from './export-cli-request.js';
import { exportRoutePath } from './export-cli-routing.js';
import {
  AGENT_SLUGS,
  isAgentSlug,
  planAgentInstall,
  applyJsonInstall,
  removeJsonInstall,
} from './mcp-agent-install.js';

const argv = process.argv.slice(2);

const RESUME_CONTINUE_PROMPT =
  'The previous turn was interrupted by a transient failure. ' +
  'If your last response was cut off, continue it from where you left off ' +
  'and keep any work already completed; otherwise complete the original ' +
  'request. Inspect the current project files as needed before making ' +
  'further changes.';

function splitCommaSeparatedIds(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function readPromptFromFlags(flags) {
  if (typeof flags.prompt === 'string' && flags.prompt.length > 0) {
    return flags.prompt;
  }
  if (typeof flags['prompt-file'] === 'string' && flags['prompt-file'].length > 0) {
    const path = flags['prompt-file'];
    if (path === '-') {
      return await new Promise((resolve, reject) => {
        let buf = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { buf += chunk; });
        process.stdin.on('end', () => resolve(buf));
        process.stdin.on('error', reject);
      });
    }
    const { readFile } = await import('node:fs/promises');
    return await readFile(path, 'utf8');
  }
  return null;
}

// ---- Subcommand router ----------------------------------------------------
//
// `pixo` is two CLIs glued together:
//   - default mode: starts the daemon + opens the web UI.
//   - `pixo media …`: a thin client that POSTs to the running daemon. This
//     is what the code agent invokes from inside a chat to actually
//     produce image / video / audio bytes (the unifying contract).
//
// We dispatch on the first positional argument so flags like --port keep
// working unchanged. Subcommand routing is keyword-based; flags are
// parsed inside each handler.

// Flags accepted by `pixo media generate`. Whitelisted so a hallucinated
// `--length 5` from the LLM fails fast instead of silently no-op'ing
// while we route a bogus body to the daemon.
//
// Hoisted to the top of the module *before* the subcommand dispatch
// below: top-level `await SUBCOMMAND_MAP[first](rest)` runs runMedia
// synchronously during module evaluation, and runMedia references these
// `const` Sets — leaving them at the bottom of the file would hit the
// TDZ ("Cannot access 'MEDIA_GENERATE_STRING_FLAGS' before
// initialization") and crash every `pixo media …` invocation.
const MEDIA_GENERATE_STRING_FLAGS = new Set([
  'project',


  'surface',
  'model',
  'style',
  ...CODEX_IMAGE_CLI_STRING_FLAGS,
  ...IMAGE_SIZE_CLI_STRING_FLAGS,
  ...IMAGE_SHEET_CLI_STRING_FLAGS,
  ...OPENPIXO_CLI_STRING_FLAGS,
  'prompt',
  'prompt-file',
  'output',
  'aspect',
  'quality',
  'resolution',
  'length',
  'duration',
  'prompt-influence',
  'voice',
  'audio-kind',
  'composition-dir',
  'image',
  'daemon-url',
  'language',
]);
const MEDIA_GENERATE_BOOLEAN_FLAGS = new Set([
  'help',
  'h',
  'json',
  'loop',
  'no-reference',
  ...IMAGE_SIZE_CLI_BOOLEAN_FLAGS,
  ...IMAGE_SHEET_CLI_BOOLEAN_FLAGS,
]);
const MEDIA_SCAFFOLD_STRING_FLAGS = new Set([
  'project',


  'composition-dir',
  'daemon-url',
]);
const MEDIA_SCAFFOLD_BOOLEAN_FLAGS = new Set(['help', 'h', 'json']);

const MCP_STRING_FLAGS = new Set([
  'daemon-url',
]);
const MCP_BOOLEAN_FLAGS = new Set([
  'help',
  'h',
]);

// Hoisted next to MCP_*_FLAGS for the same TDZ reason as the MEDIA flags
// above: `pixo mcp install <agent>` dispatches through SUBCOMMAND_MAP during
// top-level module evaluation, and runMcpInstall references these `const`
// Sets — defining them next to runMcpInstall lower in the file would hit
// the TDZ.
const MCP_INSTALL_STRING_FLAGS = new Set([
  'daemon-url',
  'name',
]);
const MCP_INSTALL_CLI_PROBE_FLAG = 'openpixo-cli-probe';
const MCP_INSTALL_CLI_PROBE_TOKEN = 'pixo-cli:mcp-install:v1';
const MCP_INSTALL_BOOLEAN_FLAGS = new Set([
  'help',
  'h',
  MCP_INSTALL_CLI_PROBE_FLAG,
  'json',
  'print',
  'dry-run',
  'uninstall',
  'remove',
]);

const RESEARCH_SEARCH_STRING_FLAGS = new Set([
  'query',
  'max-sources',
  'daemon-url',
]);
const RESEARCH_SEARCH_BOOLEAN_FLAGS = new Set([
  'help',
  'h',
]);

const PLUGIN_STRING_FLAGS = new Set([
  'daemon-url',
  'source',
  'inputs',
  'project',
  'conversation',
  'message',
  'agent',
  'model',
  'snapshot-id',
  'capabilities',
  'grant-caps',
  'before',
  'trust',
  'tag',
  'policy',
  'version',
  'reason',
  'catalog',
  'host',
  'name',


]);
const PLUGIN_PROJECT_RESOURCE_STRING_FLAGS = new Set([
  ...PLUGIN_STRING_FLAGS,


]);
const PLUGIN_BOOLEAN_FLAGS = new Set([
  'help',
  'h',
  'json',
  'revoke',
  'follow',
  'strict',
]);

// Hoist flag set bindings consumed by handlers reachable through
// the top-of-file dispatcher. The dispatch block runs synchronously
// during module load; any const declared further down the file is
// still in TDZ when the handler executes, so `pixo status` /
// `pixo atoms list` / etc. would crash with `Cannot access X before
// initialization`.
const DAEMON_STRING_FLAGS = new Set([
  'daemon-url', 'port', 'host',
]);
const DAEMON_BOOLEAN_FLAGS = new Set([
  'help', 'h', 'json', 'headless', 'serve-web', 'no-open',
]);
const RESOURCE_STRING_FLAGS = new Set([
  'daemon-url', 'query', 'tag',
]);
const RESOURCE_BOOLEAN_FLAGS = new Set(['help', 'h', 'json']);
const DIAGNOSTICS_STRING_FLAGS = new Set(['daemon-url', 'output']);
const DIAGNOSTICS_BOOLEAN_FLAGS = new Set(['help', 'h', 'json']);
const CONFIG_STRING_FLAGS = new Set(['daemon-url', 'value', 'value-json']);
const CONFIG_BOOLEAN_FLAGS = new Set(['help', 'h', 'json']);
const PROJECT_STRING_FLAGS = new Set([
  'daemon-url', 'name', 'skill', 'plugin', 'metadata-json',
  'pending-prompt', 'project', 'conversation', 'message', 'prompt',
  'prompt-file', 'path', 'dir', 'as', 'url',
  'client-request-id',
  'agent', 'model', 'reasoning', 'service-tier', 'snapshot-id', 'inputs', 'grant-caps', 'editor',
  'title', 'label', 'against', 'seed-from', 'fork-after', 'mode',
  'source', 'out', 'kind', 'query',
  'template', ...GAME_SETUP_CLI_FLAGS,
]);
const PROJECT_RESOURCE_STRING_FLAGS = new Set([
  ...PROJECT_STRING_FLAGS,


]);
const PROJECT_BOOLEAN_FLAGS = new Set(['help', 'h', 'json', 'follow', 'thumbnail', 'create-parent', 'skip-plan']);
const RUN_START_STRING_FLAGS = new Set([
  ...PROJECT_RESOURCE_STRING_FLAGS,
  'byok-protocol', 'byok-base-url', 'byok-api-version', 'byok-key-env',
]);
const RUN_START_BOOLEAN_FLAGS = new Set([...PROJECT_BOOLEAN_FLAGS, 'byok-keyless']);
// `pixo templates …` mirrors NewProjectPanel / ExamplesTab. Same surface,
// same /api/templates store. The CLI form is the embeddability contract:
// external agents (external automation, ...) can snapshot, list, or
// remove user-saved project templates without going through the web UI.
const TEMPLATES_STRING_FLAGS = new Set([
  'daemon-url', 'name', 'description',
]);
const TEMPLATES_BOOLEAN_FLAGS = new Set(['help', 'h', 'json']);
const SHARE_STRING_FLAGS = new Set([
  'daemon-url', 'url', 'title', 'text', 'copy-text', 'locale', 'platform',
]);
const SHARE_BOOLEAN_FLAGS = new Set([
  'help', 'h', 'json',
]);
const COMMENT_STRING_FLAGS = new Set([
  'daemon-url',   'prompt', 'prompt-file', 'target', 'status', 'read-at', 'file',
]);
const COMMENT_BOOLEAN_FLAGS = new Set(['help', 'h', 'json']);
const RECOVERABLE_EXIT_CODES = {
  'daemon-not-running':       64,
  'plugin-not-found':         65,
  'snapshot-not-found':       65,
  'capabilities-required':    66,
  'missing-input':            67,
  'project-not-found':        68,
  'run-not-found':            69,
  'provider-not-configured':  70,
  'plugin-requires-daemon':   71,
  'snapshot-stale':           72,
  'desktop-auth-pending':     74,
  'desktop-import-token-rejected': 75,
};
const PLUGIN_LIST_FILTER_FLAGS = new Set([
  ...PLUGIN_STRING_FLAGS,
  'task-kind', 'mode', 'tag', 'trust',
]);
const PLUGIN_LIST_BOOLEAN_FLAGS = new Set([
  ...PLUGIN_BOOLEAN_FLAGS,
  'bundled', 'no-bundled',
]);

const SUBCOMMAND_MAP = {
  account: runAccountCli,
  credits: runCreditsCli,
  store: runStoreCli,
  publish: runPublishCli,
  rooms: runRoomsCli,
  online: runOnlineCli,
  style: runStyleCli,
  recipe: runRecipeCli,
  character: runCharacterCli,
  asset: runAssetCli,
  game: (args) => runGameTuningDispatch(args, runGameCli),
  extensions: runProjectExtensionsCli,
  agent: (args) => {
    if (args[0] === 'capabilities') return runAgentCapabilitiesCli(args.slice(1));
    if (!['help', '--help', '-h'].includes(args[0])) process.exitCode = 2;
    return runAgentCapabilitiesCli(['--help']);
  },
  artifacts: runArtifacts,
  media: runMedia,
  mcp: runMcp,
  research: runResearch,
  plugin: runPlugin,
  marketplace: runMarketplace,
  share: runShare,
  project: runProject,
  run: runRun,
  files: runFiles,
  templates: runTemplates,
  conversation: runConversation,
  chat: runChat,
  daemon: runDaemon,
  skill: runSkills,
  skills: runSkills,
  diagnostics: runDiagnostics,
  export: runExport,
  lint: runLint,
  status: runStatus,
  version: runVersion,
  'whats-new': runWhatsNew,
  doctor: runDoctorCli,
  config: runConfig,
};

function printCommentHelp() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} comment list <projectId> <conversationId> [--json]
  ${PRODUCT_CLI_NAME} comment pull <projectId> <conversationId> [--json]
  ${PRODUCT_CLI_NAME} comment create <projectId> <conversationId> --target <json> (--prompt <text> | --prompt-file <path|->) [--json]
  ${PRODUCT_CLI_NAME} comment update <projectId> <conversationId> <commentId> --target <json> (--prompt <text> | --prompt-file <path|->) [--json]
  ${PRODUCT_CLI_NAME} comment status <projectId> <conversationId> <commentId> --status <open|attached|applying|needs_review|resolved|failed> [--json]
  ${PRODUCT_CLI_NAME} comment delete <projectId> <conversationId> <commentId> [--json]
  ${PRODUCT_CLI_NAME} comment read <projectId> [--read-at <epoch-ms>] [--json]
  ${PRODUCT_CLI_NAME} comment align <projectId> [--json]
  ${PRODUCT_CLI_NAME} comment sync-state <projectId> [--file <path>] [--json]
  ${PRODUCT_CLI_NAME} comment retry-backfill <projectId> --file <path> [--json]

Manage comments through the same daemon HTTP API as the workspace UI.

Options:
  --file <path>               Exact locally published file for backfill status/retry.
  --target <json>             PreviewCommentTarget JSON for create/update.
  --prompt <text>             Comment body.
  --prompt-file <path|->      Read the comment body from a file or stdin; mutually exclusive with --prompt.
  --read-at <epoch-ms>        Mark comments read at this time (defaults to now; server clamps).
  --daemon-url <url>          Override daemon URL.
  --json                      Emit the daemon response as JSON.`);
}

const EXPORT_STRING_FLAGS = new Set([
  'daemon-url', 'project', 'format', 'out', 'output', 'image-format', 'title', 'file',
  // Backwards-compatible no-ops. Older scripts may still pass these, but
  // export authority is derived from the project id by the daemon.

]);
const EXPORT_BOOLEAN_FLAGS = new Set(['help', 'h', 'json', 'deck', 'page', 'no-deck']);
// EXPORT_FORMATS / EXPORT_IMAGE_FORMATS are the shared contract DTO (single
// source of truth for the web/daemon/CLI export surface), imported above.

function printExportHelp() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} export <file> --project <id> --format <fmt> [options]

Programmatic export of an HTML artifact to standalone HTML, PDF, or image.
Runs without model/agent calls. Standalone HTML works in a headless
daemon; visual formats require the desktop runtime's bundled Chromium.

Formats:  ${EXPORT_FORMATS.join(', ')}

Options:
  --project <id>           Project id (required)
  --format <fmt>           One of: ${EXPORT_FORMATS.join(' | ')} (required)
  --out <path>             Write the file here (defaults to the suggested name)
  --image-format <fmt>     png | jpeg (for --format image)
  --deck                   Treat the artifact as a multi-slide deck
  --page, --no-deck        Treat the artifact as a normal scrollable page
  --title <title>          Title used for metadata / default filename
  --json                   Print a machine-readable result envelope
  --daemon-url <url>       Override daemon URL

Examples:
  ${PRODUCT_CLI_NAME} export index.html --project p1 --format pdf --out page.pdf
  ${PRODUCT_CLI_NAME} export index.html --project p1 --format html --out standalone.html
  ${PRODUCT_CLI_NAME} export slide.html --project p1 --format image --image-format png --out slide.png
  ${PRODUCT_CLI_NAME} export index.html --project p1 --format pdf --out preview.pdf`);
}

async function runExport(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    printExportHelp();
    process.exit(args.length === 0 ? 2 : 0);
  }
  let flags;
  try {
    flags = parseFlags(args, { string: EXPORT_STRING_FLAGS, boolean: EXPORT_BOOLEAN_FLAGS });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const pos = positionalArgs(args, EXPORT_STRING_FLAGS);
  const file = flags.file || pos[0];
  const projectId = flags.project || process.env.PIXO_PROJECT_ID;
  const format = flags.format;
  if (!file || !projectId || !format) {
    printExportHelp();
    process.exit(2);
  }
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
    console.error(`invalid --format: ${format} (expected ${EXPORT_FORMATS.join(' | ')})`);
    process.exit(2);
  }
  if (flags['image-format'] && !(EXPORT_IMAGE_FORMATS as readonly string[]).includes(flags['image-format'])) {
    console.error(`invalid --image-format: ${flags['image-format']} (expected ${EXPORT_IMAGE_FORMATS.join(' | ')})`);
    process.exit(2);
  }
  if (flags['image-format'] && format !== 'image') {
    console.error('--image-format is only valid with --format image');
    process.exit(2);
  }
  const base = await cliDaemonBaseUrl(flags);
  const token = process.env.PIXO_TOOL_TOKEN;
  const requestHeaders = token
    ? { authorization: `Bearer ${token}` }
    : {};
  // Visual formats rasterize through the desktop screenshot renderer so the
  // CLI matches the UI exactly. In particular `pdf` uses `/export/pdf-image`
  // (one raster page per deck slide / per viewport for a page) — NOT the generic
  // `/export` vector `printToPDF` path, which drops CJK glyphs in the packaged
  // runtime and is the bug this feature exists to avoid.
  const exportPath = exportRoutePath(format);
  let deckMode;
  try {
    deckMode = resolveExportCliDeckMode({
      format,
      deck: flags.deck === true,
      page: flags.page === true,
      noDeck: flags['no-deck'] === true,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const requestBody = buildExportCliRequestBody({
    fileName: file,
    format,
    deck: deckMode,
    ...(format === 'image' && flags['image-format'] ? { imageFormat: flags['image-format'] } : {}),
    ...(flags.title ? { title: flags.title } : {}),
  });
  let resp;
  try {
    resp = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/${exportPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...requestHeaders },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    surfaceFetchError(err, base);
    process.exit(3);
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const buffer = Buffer.from(await resp.arrayBuffer());
  let out = flags.out || flags.output;
  if (!out) {
    const cd = resp.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="([^"]+)"/i.exec(cd);
    if (star && star[1]) {
      try { out = decodeURIComponent(star[1]); } catch { out = plain && plain[1] ? plain[1] : null; }
    } else if (plain && plain[1]) {
      out = plain[1];
    }
    if (!out) {
      const ext = format === 'image'
        ? (flags['image-format'] === 'jpeg' ? 'jpg' : 'png')
        : format === 'html' ? 'html' : 'pdf';
      out = `artifact.${ext}`;
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(out, buffer);
  if (flags.json) {
    return process.stdout.write(
      JSON.stringify(buildExportCliResultEnvelope({ path: out, bytes: buffer.length, format }), null, 2) + '\n',
    );
  }
  console.log(`wrote ${out} (${buffer.length} bytes)`);
}

const LINT_STRING_FLAGS = new Set(['daemon-url', 'file', 'html-file', 'fail-on']);
const LINT_BOOLEAN_FLAGS = new Set(['help', 'h', 'json', 'agent-message']);
const LINT_FAIL_ON_VALUES = ['p0', 'p1', 'p2', 'none'];

function printLintHelp() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} lint <file.html|-> [options]

Inspect an HTML file with the same checks applied when saving artifacts.
Read stdin when the file is \`-\`.
Runs without model/agent calls; works against a headless daemon.

Exit codes: 0 clean at threshold · 1 findings at/above --fail-on ·
2 usage · 3 daemon unreachable.

Options:
  --file, --html-file <p>  Input path (alternative to the positional; \`-\` = stdin)
  --fail-on <sev>          p0 | p1 | p2 | none — exit 1 threshold (default p0)
  --agent-message          Also print the <artifact-lint> block for agent splicing
  --json                   Print a machine-readable result envelope
  --daemon-url <url>       Override daemon URL

Examples:
  ${PRODUCT_CLI_NAME} lint artifact.html
  ${PRODUCT_CLI_NAME} lint - < artifact.html --json
  ${PRODUCT_CLI_NAME} lint report.html --fail-on p1 --agent-message`);
}

// CLI half of POST /api/artifacts/lint. The endpoint has been live since the
// linter landed, but without a subcommand it was unreachable from external
// agents — the exact gap the dual-track rule in AGENTS.md exists to prevent.
async function runLint(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    printLintHelp();
    process.exit(args.length === 0 ? 2 : 0);
  }
  let flags;
  try {
    flags = parseFlags(args, { string: LINT_STRING_FLAGS, boolean: LINT_BOOLEAN_FLAGS });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const pos = positionalArgs(args, LINT_STRING_FLAGS);
  const file = flags.file || flags['html-file'] || pos[0];
  if (!file) {
    printLintHelp();
    process.exit(2);
  }
  const failOn = (flags['fail-on'] || 'p0') as LintFailOn;
  if (!LINT_FAIL_ON_VALUES.includes(failOn)) {
    console.error(`invalid --fail-on: ${failOn} (expected ${LINT_FAIL_ON_VALUES.join(' | ')})`);
    process.exit(2);
  }
  let html;
  try {
    if (file === '-') {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      html = Buffer.concat(chunks).toString('utf8');
    } else {
      const { readFile } = await import('node:fs/promises');
      html = await readFile(file, 'utf8');
    }
  } catch (err) {
    console.error(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  if (html.length === 0) {
    console.error(`empty input: ${file}`);
    process.exit(2);
  }
  const base = await cliDaemonBaseUrl(flags);
  let resp;
  try {
    resp = await fetch(`${base}/api/artifacts/lint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html }),
    });
  } catch (err) {
    surfaceFetchError(err, base);
    process.exit(3);
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const { findings, agentMessage } = (await resp.json()) as LintArtifactResponse;
  const counts = { p0: 0, p1: 0, p2: 0 };
  for (const f of findings) {
    if (f.severity === 'P0') counts.p0 += 1;
    else if (f.severity === 'P1') counts.p1 += 1;
    else counts.p2 += 1;
  }
  const failed =
    failOn === 'p0' ? counts.p0 > 0
    : failOn === 'p1' ? counts.p0 + counts.p1 > 0
    : failOn === 'p2' ? findings.length > 0
    : false;
  if (flags.json) {
    const envelope: LintArtifactCliResultEnvelope = {
      ok: !failed, file, failOn, counts, findings, agentMessage,
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  } else {
    for (const f of findings as ArtifactLintFinding[]) {
      console.log(`[${f.severity}] ${f.id} — ${f.message}`);
      if (f.snippet) console.log(`      ${f.snippet}`);
      console.log(`      fix: ${f.fix}`);
    }
    const summary = `${findings.length} finding${findings.length === 1 ? '' : 's'} (P0 ${counts.p0} · P1 ${counts.p1} · P2 ${counts.p2})`;
    console.log(findings.length ? summary : `clean — ${summary}`);
    if (flags['agent-message'] && agentMessage) console.log(`\n${agentMessage}`);
  }
  if (failed) process.exitCode = 1;
}

if (argv[0] === 'mcp' && argv[1] === 'approvals') {
  try {
    const { exitCode } = await runApprovalsMcpServer();
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: { message } })}\n`);
    process.exit(1);
  }
}

const first = argv.find((a) => !a.startsWith('-'));
if (first && SUBCOMMAND_MAP[first]) {
  const idx = argv.indexOf(first);
  const rest = [...argv.slice(0, idx), ...argv.slice(idx + 1)];
  await SUBCOMMAND_MAP[first](rest);
  // Respect a non-zero exit code a handler set via process.exitCode (e.g. a
  // failed `pixo resource get`); default to 0 when it left it unset.
  process.exit(process.exitCode ?? 0);
}

if (argv[0] === 'tools' && (argv.includes('--help') || argv.includes('-h')) && argv.length === 2) {
  printRootHelp();
  process.exit(0);
} else if (argv[0] === 'tools' && argv[1] === 'deliverable-syntax') {
  runDeliverableSyntaxToolCli(argv.slice(2))
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error: { message } })}\n`);
      process.exitCode = 1;
    });
} else {
  await runDaemonCliStartup(argv, { printHelp: printRootHelp });
}

function printRootHelp() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} [--port <n>] [--host <addr>] [--no-open]
      Start the local daemon and open the web UI.

  ${PRODUCT_CLI_NAME} tools deliverable-syntax check [--json]
      Check the current deliverable syntax through the daemon wrapper.

  ${PRODUCT_CLI_NAME} artifacts create --name <path> --input <file> [--project <id-or-name>]
      Create a normal project artifact through the local daemon.

  ${PRODUCT_CLI_NAME} research search --query <text> [--max-sources 5] [--daemon-url <url>]
      Search the web through the configured Tavily integration.

  ${PRODUCT_CLI_NAME} plugin <list|info|install|uninstall|apply|doctor|replay|trust> [args]
      Discover, install, and apply plugins through the local daemon.
  ${PRODUCT_CLI_NAME} plugin publish-repo <folder>
      Create/update the author's GitHub repo for a local plugin folder.

  ${PRODUCT_CLI_NAME} share url [options]
      Build localized social-share targets for a deployed project URL. Use --json for scripted integrations.

  ${PRODUCT_CLI_NAME} chat new --project <id> [--seed-from <cid>] [--fork-after <mid>] [--title "<t>"] [--json]
      Create a Side Chat: a new conversation that inherits another
      conversation's context by copying its messages (--seed-from), optionally
      stopping at one message (--fork-after). Mirrors the web chat fork action.

  ${PRODUCT_CLI_NAME} doctor [--json]
      Check local agents, game engines, media tools, and generation settings.

  ${PRODUCT_CLI_NAME} diagnostics export [<path>] [--json]
      Bundle daemon/web/desktop logs, machine info, and recent crash reports
      into a zip for support tickets. Same output as Settings → About →
      Export diagnostics.

  ${PRODUCT_CLI_NAME} export <file> --project <id> --format <html|pdf|image> [--out <path>]
      Export HTML artifacts to HTML, PDF, or image through the Download API
      (no model/agent calls). Visual formats use
      the desktop runtime's bundled Chromium.

  ${PRODUCT_CLI_NAME} lint <file.html|-> [--fail-on <p0|p1|p2|none>] [--json]
      Inspect an HTML file or stdin with the artifact-save validation checks
      (no model/agent calls; headless-safe). Exits 1 when findings meet the
      --fail-on threshold, so it can gate cron/CI render pipelines.

  "$PIXO_NODE_BIN" "$PIXO_BIN" tools ...
      Recommended agent-runtime form; avoids relying on user PATH for ${PRODUCT_CLI_NAME} or node.

  ${PRODUCT_CLI_NAME} style list|info|set|get [opts]
      Browse art styles and set the default for a project.

  ${PRODUCT_CLI_NAME} recipe list|show|run|status|adopt|cancel [opts]
      Discover recipes, stage candidates, inspect results, and explicitly adopt chosen files.

  ${PRODUCT_CLI_NAME} account status|login|logout [--json]
      Sign in with an email code or Google. Local features work without an account.

  ${PRODUCT_CLI_NAME} credits balance|history|catalog|buy|portal|plan|change-plan|undo-plan-change|agent-models|agent-usage [--json]
      Check platform credits, buy a credit pack or plan, change plan, manage billing, and see agent prices and per-run usage.

  ${PRODUCT_CLI_NAME} character list|show|create|update|delete [opts]
      Manage project character cards and their reference images.

  ${PRODUCT_CLI_NAME} publish [status|remove] [--project <id>] [--title <text>] [--accept-terms] [--no-build] [--json]
      Put a web game on a public link anyone can play, update it, or take it down. Only when the creator asks.

  ${PRODUCT_CLI_NAME} rooms add|test|status|limit [--project <id>] [--url <local game url>] [--json]
      Add live rooms to a web game, test two players locally for free, and see usage and the spending limit.

  ${PRODUCT_CLI_NAME} online add|status|test|seed|data|reset [--project <id>] [--url <local game url>] [--hosted] [--json]
      Add leaderboards, saves, async battles and racing ghosts to a web game, test them locally with fake players, and see use.

  ${PRODUCT_CLI_NAME} media generate --surface <image|video|audio|model3d> --model <id> [opts]
      Generate a media artifact and write it into the active project.
      Designed to be invoked by a code agent - picks up PIXO_DAEMON_URL
      and PIXO_PROJECT_ID from the env that the daemon injected on spawn.

  ${PRODUCT_CLI_NAME} media scaffold --composition-dir .hyperframes-cache/<id>
      Create a deterministic HyperFrames composition without npx or global
      skill installation, before dispatching it through media generate.

  ${PRODUCT_CLI_NAME} media capabilities [--json]
      Show which media capabilities have a configured provider.

  ${PRODUCT_CLI_NAME} mcp [--daemon-url <url>]
      Run a stdio MCP server that proxies project tool calls to a
      running OpenPixo daemon. Wire it into a coding agent
      (Claude Code, Cursor, VS Code, Zed, Windsurf) in another repo
      to pull files from a local OpenPixo project and create
      project-scoped artifacts without exporting a zip.

Options:
  --port <n>       Port to listen on (default: 7456, env: PIXO_PORT).
  --host <addr>    Interface address to bind to (default: 127.0.0.1, env: PIXO_BIND_HOST).
                   Set to a specific IP (e.g. a Tailscale address) to restrict access
                   to that interface only.
  --no-open        Do not open the browser after start.

What the daemon does:
  * scans PATH for installed code-agent CLIs (claude, codex, opencode)
  * serves the chat UI at http://<host>:<port>
  * proxies messages (text + images) to the selected agent via child-process spawn
  * exposes project-scoped media scaffold/generate APIs — the unified path
     that the agent calls via \`${PRODUCT_CLI_NAME} media scaffold\` and \`${PRODUCT_CLI_NAME} media generate\`.`);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subcommand: pixo research …
// ---------------------------------------------------------------------------

async function runResearch(args) {
  const { sub, subArgs } = splitResearchSubcommand(args);
  if (!sub || sub === 'help' || args.includes('--help') || args.includes('-h')) {
    printResearchHelp();
    process.exit(sub === 'help' || args.includes('--help') || args.includes('-h') ? 0 : 2);
  }
  if (sub !== 'search') {
    console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} research ${sub}`);
    printResearchHelp();
    process.exit(2);
  }
  return runResearchSearch(subArgs);
}

async function runResearchSearch(rawArgs) {
  let flags;
  try {
    flags = parseFlags(rawArgs, {
      string: RESEARCH_SEARCH_STRING_FLAGS,
      boolean: RESEARCH_SEARCH_BOOLEAN_FLAGS,
    });
  } catch (err) {
    console.error(err.message);
    printResearchHelp();
    process.exit(2);
  }
  const query = typeof flags.query === 'string' ? flags.query.trim() : '';
  if (!query) {
    console.error('--query required');
    process.exit(2);
  }
  const daemonUrl = await cliDaemonUrl(flags);
  const maxSources =
    flags['max-sources'] == null ? undefined : Number(flags['max-sources']);
  const url = `${daemonUrl.replace(/\/$/, '')}/api/research/search`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(Number.isFinite(maxSources) ? { maxSources } : {}),
      }),
    });
  } catch (err) {
    surfaceFetchError(err, daemonUrl);
    process.exit(3);
  }
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`daemon ${resp.status}: ${text}`);
    process.exit(4);
  }
  process.stdout.write(`${await resp.text()}\n`);
}

async function runArtifacts(args) {
  const { exitCode } = await runArtifactsCli(args);
  process.exit(exitCode);
}

function printResearchHelp() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} research search --query <text> [--max-sources 5] [--daemon-url <url>]

Runs Tavily-backed shallow research through the local OpenPixo daemon.
Output is JSON only on stdout:
  { "query": "...", "summary": "...", "sources": [...], "provider": "tavily", "depth": "shallow", "fetchedAt": 0 }

Flags:
  --query        Required search query.
  --max-sources  Optional source cap. Defaults to 5, clamped to Tavily's max.
  --daemon-url   Local daemon URL. Defaults to PIXO_DAEMON_URL, inherited sidecar discovery, or http://127.0.0.1:7456.`);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo media …
// ---------------------------------------------------------------------------

async function runMedia(args) {
  const sub = args.find((a) => !a.startsWith('-')) || '';
  if (sub === 'help' || sub === '-h' || sub === '--help' || sub === '') {
    printMediaHelp();
    return;
  }
  if (sub !== 'generate' && sub !== 'wait' && sub !== 'scaffold' && sub !== 'models' && sub !== 'image-models' && sub !== 'capabilities' && sub !== 'quote') {
    console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} media ${sub}`);
    printMediaHelp();
    process.exit(1);
  }

  const idx = args.indexOf(sub);
  const subArgs = [...args.slice(0, idx), ...args.slice(idx + 1)];
  if (sub === 'capabilities') {
    const flags = parseFlags(subArgs, { string: ['daemon-url'], boolean: ['json', 'help', 'h'] });
    if (flags.help || flags.h) { printMediaHelp(); return; }
    const daemonUrl = await cliDaemonUrl(flags);
    const token = process.env.PIXO_TOOL_TOKEN;
    const response = await fetch(`${daemonUrl.replace(/\/$/, '')}/api/media/capabilities`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`Media capabilities request failed (${response.status})`);
    const data: GetMediaCapabilitiesResponse = await response.json();
    if (flags.json) console.log(JSON.stringify(data));
    else for (const [capability, status] of Object.entries(data.capabilities)) {
      console.log(`${capability}: ${status.configured ? `configured (${status.providers.join(', ')})` : 'not configured'}`);
    }
    return;
  }
  if (sub === 'models') {
    const flags = parseFlags(subArgs, { string: ['daemon-url', 'project',  ], boolean: ['json', 'cloud', 'help', 'h'] });
    if (flags.help || flags.h) { printMediaHelp(); return; }
    const daemonUrl = await cliDaemonUrl(flags);
    const token = process.env.PIXO_TOOL_TOKEN;
    const query = new URLSearchParams();
    if (flags.cloud) { query.set('cloud', 'true'); query.set('projectId', flags.project || process.env.PIXO_PROJECT_ID || ''); }
    const response = await fetch(`${daemonUrl.replace(/\/$/, '')}/api/media/models?${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`Media catalog request failed (${response.status})`);
    console.log(JSON.stringify(await response.json()));
    return;
  }
  if (sub === 'image-models') {
    // The same list the Settings select and the composer chip show; pick with
    // `config set agentImageModel <id>` (or `auto`).
    const flags = parseFlags(subArgs, { string: ['daemon-url'], boolean: ['json', 'help', 'h'] });
    if (flags.help || flags.h) { printMediaHelp(); return; }
    const response = await fetch(`${await cliDaemonBaseUrl(flags)}/api/media/agent-image-models`);
    if (!response.ok) throw new Error(`Image model list request failed (${response.status})`);
    const data: AgentImageModelsResponse = await response.json();
    if (flags.json) { console.log(JSON.stringify(data)); return; }
    const automatic = data.automatic ? `automatic (now ${data.automatic})` : 'automatic (nothing can make images yet)';
    console.log(`selected: ${data.selected ?? AGENT_IMAGE_MODEL_AUTOMATIC}${data.selectedUnavailable ? ` (cannot run now: ${data.selectedUnavailable}; runs use ${automatic})` : data.selected ? '' : ` -> ${automatic}`}`);
    for (const model of data.options) {
      console.log(`${model.id === data.selected ? '*' : ' '} ${model.id}  ${model.label} · ${model.providerLabel}${model.hosted ? ' · art budget' : ''}${model.available ? '' : ' · unavailable'}`);
    }
    console.log(`Set with: ${PRODUCT_CLI_NAME} config set agentImageModel <id|${AGENT_IMAGE_MODEL_AUTOMATIC}>`);
    return;
  }
  if (sub === 'quote') {
    const flags = parseFlags(subArgs, {
      string: new Set(['daemon-url', 'project', 'model', 'prompt', 'prompt-file', 'aspect', 'cloud-style', 'surface', 'image', 'duration', 'voice']),
      boolean: new Set(['json', 'help', 'h']),
    });
    if (flags.help || flags.h) { printMediaHelp(); return; }
    if (!isOpenPixoHostedModel(flags.model)) {
      await exitWithMediaError({ code: 'BAD_REQUEST', message: '--model must be an OpenPixo hosted model (openpixo-…)' }, 2);
    }
    try {
      const quote = await requestOpenPixoQuote(await cliDaemonUrl(flags), {
        model: flags.model, prompt: await readPromptFromFlags(flags), aspect: flags.aspect, 'cloud-style': flags['cloud-style'],
        duration: flags.duration, voice: flags.voice,
        project: flags.project || process.env.PIXO_PROJECT_ID, images: repeatableFlagValues(subArgs, 'image'),
      });
      console.log(flags.json ? JSON.stringify(quote) : `${describeQuote(quote)}\nConfirm with: ${PRODUCT_CLI_NAME} media generate … --quote ${quote.quoteId}`);
    } catch (error) {
      await exitWithMediaError({ code: error?.code ?? 'CLOUD_UNAVAILABLE', message: error?.message ?? 'Quote failed' }, 4);
    }
    return;
  }
  if (sub === 'wait') return runMediaWait(subArgs);
  if (sub === 'scaffold') return runMediaScaffold(subArgs);
  return runMediaGenerate(subArgs);
}

async function runMediaScaffold(rawArgs) {
  let flags;
  try {
    flags = parseFlags(rawArgs, {
      string: MEDIA_SCAFFOLD_STRING_FLAGS,
      boolean: MEDIA_SCAFFOLD_BOOLEAN_FLAGS,
    });
  } catch (err) {
    console.error(err.message);
    printMediaHelp();
    process.exit(2);
  }
  if (flags.help || flags.h) {
    printMediaHelp();
    return;
  }

  const daemonUrl = await cliDaemonUrl(flags);
  const projectId = flags.project || process.env.PIXO_PROJECT_ID;
  const token = process.env.PIXO_TOOL_TOKEN;
  if (!projectId && !token) {
    console.error('project id required. Pass --project <id> or set PIXO_PROJECT_ID.');
    process.exit(2);
  }
  const compositionDir = flags['composition-dir'];
  if (!compositionDir) {
    console.error('--composition-dir required (expected .hyperframes-cache/<id> or motion-source/<id>)');
    process.exit(2);
  }

  const url = token
    ? `${daemonUrl.replace(/\/$/, '')}/api/tools/media/hyperframes/scaffold`
    : `${daemonUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/media/hyperframes/scaffold`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(token ? {} : {}),
      },
      body: JSON.stringify({ compositionDir }),
    });
  } catch (err) {
    surfaceFetchError(err, daemonUrl);
    process.exit(3);
  }
  if (!resp.ok) {
    const responseText = await resp.text();
    console.error(`daemon ${resp.status}: ${responseText}`);
    process.exit(4);
  }
  process.stdout.write(`${JSON.stringify(await resp.json())}\n`);
}

async function runMediaGenerate(rawArgs) {
  let flags;
  try {
    flags = parseFlags(rawArgs, {
      string: MEDIA_GENERATE_STRING_FLAGS,
      boolean: MEDIA_GENERATE_BOOLEAN_FLAGS,
    });
  } catch (err) {
    console.error(err.message);
    printMediaHelp();
    process.exit(2);
  }
  if (flags.help || flags.h) {
    printMediaHelp();
    return;
  }

  const daemonUrl = await cliDaemonUrl(flags);
  const projectId = flags.project || process.env.PIXO_PROJECT_ID;
  const token = process.env.PIXO_TOOL_TOKEN;
  const requestHeaders = token
    ? {}
    : {};
  if (!projectId && !token) {
    console.error(
      'project id required. Pass --project <id> or set PIXO_PROJECT_ID. The daemon injects this when it spawns the code agent.',
    );
    process.exit(2);
  }

  const surface = flags.surface;
  if (!surface || !['image', 'video', 'audio', 'model3d'].includes(surface)) {
    console.error('--surface must be one of: image | video | audio | model3d');
    process.exit(2);
  }
  const model = codexImageCliModel(flags);
  if (!model) {
    console.error('--model required (see http://<daemon>/api/media/models)');
    process.exit(2);
  }
  const images = repeatableFlagValues(rawArgs, 'image');
  if (surface === 'model3d' && images.length === 0) {
    console.error('A 3D model is made from one image: pass --image <project-relative path>');
    process.exit(2);
  }

  // Long-form media prompts (detailed image/video descriptions, program-
  // generated prompts) arrive via --prompt-file <path|-> (stdin) per the CLI
  // contract; readPromptFromFlags prefers an inline --prompt and otherwise reads
  // the file/stdin, matching pixo run.
  const prompt = await readPromptFromFlags(flags);

  let imageSizeOptions;
  let imageSheetOptions;
  try {
    imageSizeOptions = imageSizeCliRequestOptions(flags);
    imageSheetOptions = imageSheetCliRequestOptions(flags);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (imageSheetOptions.sheet && surface !== 'image') {
    console.error('--sheet applies to --surface image only');
    process.exit(2);
  }
  if (surface !== 'image' && (imageSizeOptions.width !== undefined || imageSizeOptions.height !== undefined || flags.transparent)) {
    console.error('--size/--width/--height/--transparent apply to --surface image only');
    process.exit(2);
  }

  const body = {
    surface,
    model,
    prompt,
    ...codexImageCliRequestOptions(flags),
    ...imageSizeOptions,
    ...imageSheetOptions,
    output: flags.output,
    aspect: flags.aspect,
    quality: flags.quality,
    resolution: flags.resolution,
    voice: flags.voice,
    audioKind: flags['audio-kind'],
    compositionDir: flags['composition-dir'],
    image: images[0],
    images,
    language: flags.language,
    ...(flags.style !== undefined ? { styleId: flags.style === 'none' ? null : flags.style } : {}),
  };
  if (flags.length != null) body.length = Number(flags.length);
  if (flags.duration != null) body.duration = Number(flags.duration);
  if (flags['prompt-influence'] != null) body.promptInfluence = Number(flags['prompt-influence']);
  if (flags.loop === true) body.loop = true;
  if (flags['no-reference'] === true) body.noReference = true;
  if (isOpenPixoHostedModel(model)) {
    // A sheet's render is priced as the daemon will send it: its layout prompt and shape.
    let quoted = { prompt, aspect: flags.aspect };
    if (body.sheet) {
      const resolved = resolveSheetRequest(body, 'openpixo');
      if (!resolved.ok) {
        console.error(resolved.message);
        process.exit(2);
      }
      quoted = { prompt: resolved.body.prompt, aspect: resolved.body.aspect };
    }
    try {
      Object.assign(body, await confirmOpenPixoHosted(daemonUrl, { ...flags, model, ...quoted, project: projectId, images }));
    } catch (error) {
      await exitWithMediaError({ code: error?.code ?? 'GENERATION_CONFIRMATION_REQUIRED', message: error?.message ?? 'Not confirmed' }, 4);
    }
  }

  const url = token
    ? `${daemonUrl.replace(/\/$/, '')}/api/tools/media/generate`
    : `${daemonUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/media/generate`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...requestHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch {
    await exitWithMediaError({
      code: 'MEDIA_DISPATCHER_UNREACHABLE',
      message: 'local media dispatcher could not be reached',
    }, 3);
  }
  if (!resp.ok) {
    await exitWithMediaHttpFailure(resp);
  }
  const accepted = await resp.json();
  const { taskId } = accepted;
  if (!taskId) {
    console.error('daemon did not return a taskId');
    process.exit(4);
  }
  console.error(`task ${taskId} queued (${accepted.status || 'queued'})`);
  await pollUntilDoneOrBudget(daemonUrl, taskId, 0, {
    stillRunningExitCode: 0,
    requestHeaders: token
      ? { authorization: `Bearer ${token}` }
      : requestHeaders,
  });
}

// A dispatch that never produced a media task still has to answer "so what
// now?" -- the caller reads the same `nextStep` here as it does off a failed
// task snapshot, so one branch in the agent covers both shapes.
async function exitWithMediaError(error, exitCode) {
  const safeError = {
    code: error.code,
    message: error.message,
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
    nextStep: mediaFailureNextStep({
      code: error.code,
      message: error.message,
      retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
    }),
  };
  process.stderr.write(JSON.stringify({ error: safeError }) + '\n');
  await flushStreamsAndExit(exitCode);
}

async function exitWithMediaHttpFailure(resp) {
  let parsed = null;
  try {
    parsed = await resp.json();
  } catch {
    // Non-JSON daemon responses are operational diagnostics, not public copy.
  }
  const error = parsed?.error;
  if (
    error
    && typeof error === 'object'
    && typeof error.code === 'string'
    && error.code.trim()
    && typeof error.message === 'string'
    && error.message.trim()
  ) {
    await exitWithMediaError(error, 4);
  }
  await exitWithMediaError({
    code: 'MEDIA_DISPATCH_FAILED',
    message: 'media dispatcher failed before generation started',
  }, 4);
}

async function runMediaWait(rawArgs) {
  const stringFlags = new Set([
    'since',
    'daemon-url',

  ]);
  let flags;
  try {
    flags = parseFlags(rawArgs, {
      string: stringFlags,
      boolean: new Set(['help', 'h']),
    });
  } catch (err) {
    console.error(err.message);
    printMediaHelp();
    process.exit(2);
  }
  const taskId = positionalArgs(rawArgs, stringFlags)[0];
  if (!taskId) {
    console.error(
      `usage: ${PRODUCT_CLI_NAME} media wait <taskId> [--since <n>] [--daemon-url <url>]`,
    );
    process.exit(2);
  }
  const daemonUrl = await cliDaemonUrl(flags);
  const since = Number.isFinite(Number(flags.since))
    ? Number(flags.since)
    : 0;
  const token = process.env.PIXO_TOOL_TOKEN;
  await pollUntilDoneOrBudget(daemonUrl, taskId, since, {
    totalBudgetMs: 120_000,
    requestHeaders: token
      ? { authorization: `Bearer ${token}` }
      : {},
  });
}

// Flush stdout and stderr before exiting. process.exit() terminates the
// process without waiting for pending async writes; when stdout is a pipe
// (Windows named pipes, or large/backpressured output on any platform) the
// final JSON line can be dropped, leaving the caller with exit 0 and empty
// output. Writing an empty chunk with a callback resolves only after every
// previously queued write has been flushed. The resolve callback
// deliberately ignores the error argument (EPIPE and similar still exit
// with the requested code).
async function flushStreamsAndExit(code) {
  await Promise.all([
    new Promise((resolve) => process.stdout.write('', resolve)),
    new Promise((resolve) => process.stderr.write('', resolve)),
  ]);
  process.exit(code);
}

async function pollUntilDoneOrBudget(daemonUrl, taskId, sinceStart, options = {}) {
  const totalBudgetMs = typeof options.totalBudgetMs === 'number' ? options.totalBudgetMs : 25_000;
  const perCallTimeoutMs = 4_000;
  const stillRunningExitCode =
    typeof options.stillRunningExitCode === 'number'
      ? options.stillRunningExitCode
      : 2;
  const requestHeaders =
    options.requestHeaders && typeof options.requestHeaders === 'object'
      ? options.requestHeaders
      : {};
  const startedAt = Date.now();
  const url = `${daemonUrl.replace(/\/$/, '')}/api/media/tasks/${encodeURIComponent(taskId)}/wait`;

  let since = Number.isFinite(sinceStart) ? sinceStart : 0;
  let lastSnapshot = null;

  while (Date.now() - startedAt < totalBudgetMs) {
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    const callTimeout = Math.max(500, Math.min(perCallTimeoutMs, remaining));
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body: JSON.stringify({ since, timeoutMs: callTimeout }),
      });
    } catch (err) {
      surfaceFetchError(err, daemonUrl);
      await flushStreamsAndExit(3);
    }
    if (resp.status === 404) {
      console.error(`task ${taskId} not found (expired or never queued)`);
      await flushStreamsAndExit(4);
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`daemon ${resp.status}: ${text}`);
      await flushStreamsAndExit(4);
    }
    let snap;
    try {
      snap = await resp.json();
    } catch {
      console.error('daemon returned non-JSON for /wait');
      await flushStreamsAndExit(4);
    }
    lastSnapshot = snap;
    if (Array.isArray(snap.progress)) {
      for (const line of snap.progress) {
        process.stderr.write(line + '\n');
        process.stdout.write(`# ${line}\n`);
      }
    }
    if (typeof snap.nextSince === 'number') since = snap.nextSince;

    if (snap.status === 'done') {
      const file = snap.file || {};
      const warnings = Array.isArray(file.warnings) ? file.warnings : [];
      for (const w of warnings) {
        if (typeof w === 'string' && w) console.error(`WARN: ${w}`);
      }
      if (file.providerError) {
        const provider = file.providerId || 'provider';
        console.error(
          `WARN: ${provider} call failed — wrote stub fallback (${file.size} bytes) to ${file.name}`,
        );
        console.error(`WARN: reason: ${file.providerError}`);
        console.error(
          'WARN: surface this verbatim to the user. Do NOT claim the stub is the final result.',
        );
      }
      process.stdout.write(JSON.stringify({ file }) + '\n');
      await flushStreamsAndExit(file.providerError ? 5 : 0);
    }
    if (snap.status === 'failed') {
      const msg = snap.error?.message || 'task failed';
      console.error(`task failed: ${msg}`);
      process.stdout.write(
        JSON.stringify({ taskId, status: 'failed', error: snap.error || {} }) + '\n',
      );
      await flushStreamsAndExit(snap.error?.status || 5);
    }
    if (snap.status === 'interrupted') {
      const msg = snap.error?.message || 'task interrupted';
      console.error(`task interrupted: ${msg}`);
      process.stdout.write(
        JSON.stringify({ taskId, status: 'interrupted', error: snap.error || {} }) + '\n',
      );
      await flushStreamsAndExit(snap.error?.status || 5);
    }
  }

  const handoff = {
    taskId,
    status: lastSnapshot?.status || 'running',
    nextSince: since,
    elapsed: Math.round((Date.now() - startedAt) / 1000),
  };
  process.stdout.write(JSON.stringify(handoff) + '\n');
  const stillRunningHint =
    stillRunningExitCode === 0
      ? 'This is a successful queued/running handoff, not a failure.'
      : `exit code ${stillRunningExitCode} = still running.`;
  process.stderr.write(
    `task ${taskId} still running after ${handoff.elapsed}s. ` +
      `Run \`"$PIXO_NODE_BIN" "$PIXO_BIN" media wait ${taskId} --since ${since}\` to continue in an agent runtime ` +
      `(${stillRunningHint}).\n`,
  );
  await flushStreamsAndExit(stillRunningExitCode);
}

function surfaceFetchError(err, daemonUrl) {
  const cause = err && typeof err === 'object' ? err.cause : null;
  const code =
    cause && typeof cause === 'object' && typeof cause.code === 'string'
      ? cause.code
      : null;
  const causeMsg =
    cause && typeof cause === 'object' && typeof cause.message === 'string'
      ? cause.message
      : '';
  let detail = err && err.message ? err.message : String(err);
  if (code) detail = `${code}${causeMsg ? ` — ${causeMsg}` : ''}`;
  else if (causeMsg) detail = causeMsg;
  console.error(`failed to reach daemon at ${daemonUrl}: ${detail}`);
  if (code === 'EPERM' || code === 'ENETUNREACH') {
    console.error(
      'hint: outbound connect was denied by a sandbox. If you launched ' +
        'this command from a code agent, check the agent\'s sandbox / ' +
        'network policy. The OpenPixo daemon itself is unaffected - it can be ' +
        'reached from a regular shell.',
    );
  }
}

function parseFlags(argv, opts = {}) {
  const stringFlags = opts.string instanceof Set ? opts.string : new Set();
  const booleanFlags = opts.boolean instanceof Set ? opts.boolean : new Set();
  const knownFlags = new Set([...stringFlags, ...booleanFlags]);
  // Positionals collected silently; callers that take `<id>` style
  // positional args (e.g. `pixo plugin info <id>`) re-scan `argv`
  // themselves to pick them up. Strict positional rejection here
  // would break those commands, so we only enforce strict-flag
  // semantics for things that *are* prefixed with `--`.
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith('--')) {
      // Positional — let the caller decide what to do with it.
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (knownFlags.size > 0 && !knownFlags.has(key)) {
      throw new Error(
        `unknown flag: --${key}. Run with --help for the list of accepted flags.`,
      );
    }
    if (eq >= 0) {
      out[key] = a.slice(eq + 1);
      continue;
    }
    if (booleanFlags.has(key)) {
      out[key] = true;
      continue;
    }
    if (stringFlags.has(key)) {
      const next = argv[i + 1];
      if (next == null) {
        throw new Error(`flag --${key} requires a value`);
      }
      out[key] = next;
      i++;
      continue;
    }
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function positionalArgs(argv, stringFlags = new Set()) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith('--')) {
      out.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (eq < 0 && stringFlags.has(key)) i++;
  }
  return out;
}

function repeatableFlagValues(argv, name) {
  const values = [];
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (typeof item !== 'string') continue;
    if (item.startsWith(prefix)) {
      const value = item.slice(prefix.length).trim();
      if (value) values.push(value);
      continue;
    }
    if (item === `--${name}`) {
      const value = typeof argv[i + 1] === 'string' ? argv[i + 1].trim() : '';
      if (value && !value.startsWith('--')) values.push(value);
      i++;
    }
  }
  return values;
}

async function cliDaemonUrl(flags) {
  return resolveDaemonUrl({ flagUrl: flags?.['daemon-url'] });
}

async function cliDaemonBaseUrl(flags) {
  return (await cliDaemonUrl(flags)).replace(/\/$/, '');
}

function printMediaHelp() {
  console.log(`Usage: ${PRODUCT_CLI_NAME} media models [--cloud --project <id>] --json
       ${PRODUCT_CLI_NAME} media image-models [--json]   Image models the agent can make art with here;
                                                 pick one with: config set agentImageModel <id|${AGENT_IMAGE_MODEL_AUTOMATIC}>
       ${PRODUCT_CLI_NAME} media capabilities [--json]
       ${PRODUCT_CLI_NAME} media scaffold --composition-dir .hyperframes-cache/<id> [opts]
       ${PRODUCT_CLI_NAME} media generate --surface <image|video|audio|model3d> --model <id> [opts]
       "$PIXO_NODE_BIN" "$PIXO_BIN" media generate --surface <image|video|audio|model3d> --model <id> [opts]

Scaffold:
  Creates hyperframes.json, meta.json, and index.html without running
  HyperFrames init or installing global skills. The target must be new and
  live directly under .hyperframes-cache or motion-source (visible editable source).
  --json is accepted for consistency; scaffold output is always one JSON line.

Generate required:
  --surface  image | video | audio | model3d (model3d needs one --image and writes a .glb)
  --model    Model id from /api/media/models (e.g. gpt-image-2, doubao-seedance-2-0-260128, suno-v5).
             Saved retired model ids resolve to a newer sibling on the same provider.
  --project  Project id. Auto-resolved from PIXO_PROJECT_ID when invoked by the daemon.

  --style <id|none>         Override the project's art style for images; none disables it.
  --json                    Emit machine-readable JSON (also the default).

Common options:
${CODEX_IMAGE_CLI_HELP}
${IMAGE_SIZE_CLI_HELP}
${IMAGE_SHEET_CLI_HELP}
${OPENPIXO_CLI_HELP}
  --prompt "<text>"         Generation prompt. ElevenLabs SFX prompts must stay under 450 characters.
  --prompt-file <path|->     Read the prompt from a file, or - for stdin (for long-form prompts).
  --output <path>           Project-relative file, e.g. assets/icons/sword.png.
                            Creates parent directories. Auto-named if omitted.
  --aspect 1:1|16:9|9:16|4:3|3:4
  --quality <tier>          OpenPixo Cloud images only: published quality tier
                            (gpt-image-2 accepts low|medium|high). Omit to let the
                            model's own default tier decide — tiers are priced
                            differently, so this is a billing choice.
  --resolution <res>        OpenPixo Cloud images only: published output resolution
                            (e.g. 1K, 2K). Must name a resolution the model publishes
                            for --aspect. Omit to use the model's default profile.
  --length <seconds>        Video length.
  --duration <seconds>      Audio duration.
  --prompt-influence <0-1>  ElevenLabs SFX prompt adherence. Higher values follow the prompt more closely.
  --loop                    ElevenLabs SFX only: request a seamless loop.
  --voice <voice-id>        Speech / TTS voice.
  --language <lang>         Language boost for TTS (e.g. Chinese,Yue for Cantonese).
  --audio-kind music|speech|sfx
  --composition-dir <path>  hyperframes-html only — project-relative path
                            to the dir containing hyperframes.json /
                            meta.json / index.html. Use \`media scaffold\` to
                            create it; the daemon renders it with its pinned
                            HyperFrames runtime.
  --image <path>            Project-relative reference image; repeat up to 5
                            times for image editing or video references.
                            The first video image is the first frame; the rest
                            are references. Existing providers still receive
                            the first image through the legacy single-image field.
  --no-reference            Images: make art meant to look different from the game's style
                            reference without passing it. In a game with a style reference
                            (pixo style get), an agent's image needs --image or this flag.
  --daemon-url <url>

Output: a single line of JSON: {"file": { name, size, kind, mime, width, height, transparent, note, warnings, ... }}
  Images carry their final pixel width/height; transparent is true for a --transparent cutout.
  note says what the service rendered, what it became and, for credits, what it cost.
  A --sheet also carries pieces: [{ cell, name, width, height, empty?, touchesEdge? }].
  Slow models return {"taskId": "...", "nextSince": n} with exit 0 instead —
  a successful queued handoff, not a failure. Poll with \`media wait\`:
  exit 0 = done ({"file": ...} on stdout), exit 2 = still running (re-run
  the wait command stderr prints, carrying forward nextSince), 5 = failed.
  Standalone wait calls accept the same Workspace pair. Tool-token calls retain
  their injected authorization proof automatically through every poll.

Worked generate→wait loop (POSIX bash — do NOT translate to PowerShell;
parse JSON with python3, not jq):

  out=\$("\$PIXO_NODE_BIN" "\$PIXO_BIN" media generate --project "\$PIXO_PROJECT_ID" \\
    --surface image --model flux-pro-ultra --prompt "..." --aspect 16:9)
  last=\$(printf '%s\\n' "\$out" | tail -1)
  task_id=\$(printf '%s\\n' "\$last" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskId',''))" 2>/dev/null)
  since=\$(printf '%s\\n' "\$last" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nextSince',0))" 2>/dev/null)
  while [ -n "\$task_id" ]; do
    out=\$("\$PIXO_NODE_BIN" "\$PIXO_BIN" media wait "\$task_id" --since "\${since:-0}")
    ec=\$?
    last=\$(printf '%s\\n' "\$out" | tail -1)
    since=\$(printf '%s\\n' "\$last" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nextSince',0))" 2>/dev/null)
    if [ "\$ec" -eq 0 ]; then task_id=""; elif [ "\$ec" -ne 2 ]; then echo "\$out" >&2; exit "\$ec"; fi
  done
  printf '%s\\n' "\$last"

Skills should call this and then reference the returned filename in their
artifact / message body. The daemon writes the bytes into the project's
files folder so the FileViewer can preview them immediately.
`);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo mcp
// ---------------------------------------------------------------------------

async function runMcp(args) {
  if (args[0] === 'templates' || args[0] === 'add') {
    const { runMcpTemplateCli } = await import('./mcp/templates-cli.js');
    return runMcpTemplateCli(args);
  }
  if (args[0] === 'install') {
    return runMcpInstall(args.slice(1));
  }
  let flags;
  try {
    flags = parseFlags(args, {
      string: MCP_STRING_FLAGS,
      boolean: MCP_BOOLEAN_FLAGS,
    });
  } catch (err) {
    console.error(err.message);
    printMcpHelp();
    process.exit(2);
  }
  if (flags.help || flags.h) {
    printMcpHelp();
    return;
  }

  const { ensureMcpDaemonUrl } = await import('./mcp-bootstrap.js');
  const daemonUrl = await ensureMcpDaemonUrl({
    flagUrl: flags['daemon-url'],
  });

  const { runMcpStdio } = await import('./mcp.js');
  await runMcpStdio({
    daemonUrl,
    ...(flags['daemon-url']
      ? {}
      : {
          resolveDaemonUrl: async () => await ensureMcpDaemonUrl({}),
        }),
  });
}

function printMcpHelp() {
  console.log(`Usage: ${PRODUCT_CLI_NAME} mcp [--daemon-url <url>]

  ${PRODUCT_CLI_NAME} mcp templates [--category <category>] [--json]
  ${PRODUCT_CLI_NAME} mcp add --template <id> [--env KEY=VALUE] [--json]
    List or configure external MCP presets. See each command's --help.
  ${PRODUCT_CLI_NAME} mcp approvals
    Run-scoped Claude permission prompt using PIXO_DAEMON_URL and PIXO_TOOL_TOKEN.

Run a stdio MCP (Model Context Protocol) server that proxies project
tool calls to a running OpenPixo daemon. Wire it into a coding agent
in another repo so the agent can pull files from a local OpenPixo
project and create project-scoped artifacts without exporting a zip
every iteration.

Options:
  --daemon-url <url>   OpenPixo daemon HTTP base URL. Resolution
                       order: this flag, PIXO_DAEMON_URL, inherited sidecar status,
                       then http://127.0.0.1:7456. Each new MCP spawn
                       discovers the live daemon URL at startup, so
                       MCP client configs stay valid across daemon
                       restarts even when the port is ephemeral. A
                       packaged install also starts the signed
                       OpenPixo app in --headless mode when its daemon
                       is stopped; no Electron window is opened. The
                       MCP server re-discovers the registered runtime
                       before calls and safely retries reads when the
                       daemon changes ports, so an existing task can
                       survive an OpenPixo restart.

Environment:
  PIXO_MCP_STDIO_IDLE_EXIT_MS
                       Milliseconds without MCP activity before this
                       stdio process exits. Defaults to 1800000 (30
                       minutes), is capped at 86400000 (24 hours), and
                       can be set to 0 to keep the process alive until
                       the MCP client disconnects.

Tools exposed:
  list_projects                  list every OpenPixo project
  get_active_context             what project/file the user has open right now
  get_artifact([project, entry]) bundle: entry file + every referenced sibling
  get_project([project])         single project metadata
  get_file([project, path])      file contents (textual mimes only for now)
  search_files(query[, project]) literal substring search across textual files
  list_files([project])          project files + artifactManifest sidecars
  create_artifact(name, content) create one normal artifact entry file

When project is omitted, get_artifact / get_project / get_file /
search_files / list_files / create_artifact default to the project the
user has open in OpenPixo; get_artifact and get_file additionally
default to the active file. The response stamps usedActiveContext so
callers can see which project/file got resolved.

For the copy-paste, per-client snippet (with absolute paths resolved
for your machine, plus a one-click deeplink for Cursor), open Settings
→ MCP server in the OpenPixo app. The daemon must be running locally
for tool calls to succeed.

To register this server into a coding agent's own config automatically:
  ${PRODUCT_CLI_NAME} mcp install <agent> [--uninstall] [--print] [--json] [--daemon-url <url>]
  Agents: ${AGENT_SLUGS.join(' ')}`);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo mcp install <agent>
//
// Wires this daemon's stdio MCP server into a coding agent's own config.
// The pure planner (mcp-agent-install.ts) maps a resolved launch spec onto
// one of three strategies — drive the agent's own `mcp add/remove` CLI,
// deep-merge a JSON config file, or (for unverified formats) print a
// ready-to-paste snippet. This executor performs the IO the planner avoids.
// ---------------------------------------------------------------------------

// Resolve the canonical launch spec from the running daemon's
// /api/mcp/install-info (the same payload the Settings → MCP panel and the
// Codex one-click install use), so every install path configures byte-for-
// byte the same command. Falls back to a minimal `pixo mcp --daemon-url`
// spec when the daemon is unreachable.
async function resolveMcpLaunchSpec(flags) {
  const base = await cliDaemonBaseUrl(flags);
  try {
    const resp = await fetch(`${base}/api/mcp/install-info`);
    if (resp.ok) {
      const info = await resp.json();
      if (info && typeof info.command === 'string' && Array.isArray(info.args)) {
        return {
          command: info.command,
          args: info.args,
          env: info.env && typeof info.env === 'object' ? info.env : {},
        };
      }
    }
  } catch {
    // daemon not running / unreachable — fall through to the minimal spec
  }
  return {
    command: PRODUCT_CLI_NAME,
    args: ['mcp', '--daemon-url', base],
    env: {},
  };
}

function emitInstallResult(useJson, result) {
  if (useJson) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.ok) {
    console.log(`✓ ${result.message}`);
  } else {
    console.error(`✗ ${result.message}`);
  }
}

async function runMcpInstall(args) {
  let flags;
  try {
    flags = parseFlags(args, {
      string: MCP_INSTALL_STRING_FLAGS,
      boolean: MCP_INSTALL_BOOLEAN_FLAGS,
    });
  } catch (err) {
    console.error(err.message);
    printMcpInstallHelp();
    process.exit(2);
  }
  if (flags[MCP_INSTALL_CLI_PROBE_FLAG]) {
    console.log(MCP_INSTALL_CLI_PROBE_TOKEN);
    return;
  }
  if (flags.help || flags.h) {
    printMcpInstallHelp();
    return;
  }

  const slug = positionalArgs(args, MCP_INSTALL_STRING_FLAGS)[0];
  const useJson = Boolean(flags.json);
  if (!slug) {
    console.error('missing agent slug');
    printMcpInstallHelp();
    process.exit(2);
  }
  if (!isAgentSlug(slug)) {
    const msg = `unknown agent: ${slug} (expected one of: ${AGENT_SLUGS.join(' ')})`;
    emitInstallResult(useJson, { ok: false, agent: slug, message: msg });
    process.exit(2);
  }

  const uninstall = Boolean(flags.uninstall || flags.remove);
  const dryRun = Boolean(flags.print || flags['dry-run']);
  const serverName = flags.name || 'openpixo';

  const os = await import('node:os');
  const spec = await resolveMcpLaunchSpec(flags);
  const plan = planAgentInstall(slug, spec, {
    home: os.homedir(),
    platform: process.platform,
    serverName,
  });

  if (plan.kind === 'manual') {
    const result = {
      ok: false,
      agent: slug,
      kind: 'manual',
      ...(dryRun ? { launchSpec: spec } : {}),
      configPath: plan.configPath,
      format: plan.format,
      snippet: plan.snippet,
      message: `${slug}: manual setup required. ${plan.reason}`,
    };
    if (useJson) {
      console.log(JSON.stringify(result));
    } else {
      console.error(`› ${result.message}`);
      if (plan.configPath) console.error(`  Config: ${plan.configPath}`);
      console.error(`  Add this ${plan.format} block:\n`);
      console.log(plan.snippet);
    }
    return;
  }

  if (plan.kind === 'cli') {
    const argv = uninstall ? plan.removeArgv : plan.addArgv;
    if (dryRun) {
      emitInstallResult(useJson, {
        ok: true,
        agent: slug,
        kind: 'cli',
        launchSpec: spec,
        command: `${plan.bin} ${argv.join(' ')}`,
        message: `would run: ${plan.bin} ${argv.join(' ')}`,
      });
      return;
    }
    const { spawn } = await import('node:child_process');
    const code = await new Promise((resolve) => {
      const child = spawn(plan.bin, argv, { stdio: 'inherit' });
      child.on('error', (err) => {
        console.error(`✗ failed to run ${plan.bin}: ${err.message}`);
        resolve(127);
      });
      child.on('exit', (c) => resolve(c ?? 0));
    });
    if (code !== 0) {
      emitInstallResult(useJson, {
        ok: false,
        agent: slug,
        kind: 'cli',
        message: `${plan.bin} exited with code ${code}`,
      });
      process.exit(code || 1);
    }
    emitInstallResult(useJson, {
      ok: true,
      agent: slug,
      kind: 'cli',
      message: uninstall
        ? `removed ${serverName} from ${slug}`
        : `installed ${serverName} into ${slug}`,
    });
    return;
  }

  // plan.kind === 'json'
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  let existing = null;
  try {
    existing = await fs.readFile(plan.configPath, 'utf8');
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  if (uninstall) {
    const next = removeJsonInstall(existing, plan);
    if (next == null) {
      emitInstallResult(useJson, {
        ok: true,
        agent: slug,
        kind: 'json',
        configPath: plan.configPath,
        message: `${serverName} not present in ${plan.configPath} — nothing to remove`,
      });
      return;
    }
    if (dryRun) {
      emitInstallResult(useJson, {
        ok: true,
        agent: slug,
        kind: 'json',
        configPath: plan.configPath,
        preview: next,
        message: `would update ${plan.configPath}`,
      });
      return;
    }
    await fs.writeFile(plan.configPath, next, 'utf8');
    emitInstallResult(useJson, {
      ok: true,
      agent: slug,
      kind: 'json',
      configPath: plan.configPath,
      message: `removed ${serverName} from ${plan.configPath}`,
    });
    return;
  }

  const next = applyJsonInstall(existing, plan);
  if (dryRun) {
    emitInstallResult(useJson, {
      ok: true,
      agent: slug,
      kind: 'json',
      launchSpec: spec,
      configPath: plan.configPath,
      preview: next,
      message: `would write ${plan.configPath}`,
    });
    return;
  }
  await fs.mkdir(path.dirname(plan.configPath), { recursive: true });
  await fs.writeFile(plan.configPath, next, 'utf8');
  emitInstallResult(useJson, {
    ok: true,
    agent: slug,
    kind: 'json',
    configPath: plan.configPath,
    message: `installed ${serverName} into ${plan.configPath}`,
  });
}

function printMcpInstallHelp() {
  console.log(`Usage: ${PRODUCT_CLI_NAME} mcp install <agent> [options]

Register OpenPixo's stdio MCP server into a coding agent's own config.

Agents:
  ${AGENT_SLUGS.join(' ')}

Options:
  --uninstall, --remove   Remove the OpenPixo MCP server instead.
  --print, --dry-run      Show what would change; write nothing.
  --json                  Machine-readable result (dry runs include launchSpec).
  --name <name>           MCP server name in the agent config (default: openpixo).
  --daemon-url <url>      Daemon URL used to resolve the launch command.

The launch command is resolved from the running daemon's
/api/mcp/install-info, so the installed entry matches the Settings → MCP
panel snippet byte-for-byte. Start the daemon first for an exact match;
otherwise a minimal \`${PRODUCT_CLI_NAME} mcp --daemon-url <url>\` command is used.`);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo plugin …
// ---------------------------------------------------------------------------

// Plan §3.B1 / spec §12.4: CLI structured error helper. Maps a daemon
// HTTP error envelope (or a synthetic local error) to a stable exit
// code + a JSON envelope on stderr. Code agents read these to decide
// whether the failure is recoverable (re-grant capabilities, prompt
// the user, retry with --grant-caps, etc.).
function exitWithStructuredError({ code, message, data }, byokApiKey) {
  const exit = RECOVERABLE_EXIT_CODES[code] ?? 1;
  const envelope = { error: { code, message, data: data ?? {} } };
  process.stderr.write(serializeRunCliJson(envelope, byokApiKey) + '\n');
  process.exit(exit);
}

// Map a daemon HTTP response into the exit-code envelope. Returns the
// parsed body (so the caller can keep going if it doesn't want to exit).
//
// Daemon error envelopes come in two shapes in practice:
//   { error: { code, message, ... } }  — newer routes using sendApiError
//   { error: '<code>', message, ... }   — workspace authority routes
//   { error: '<message>' }             — older flat-string routes
//                                         (e.g. POST /api/templates at
//                                         routes/project/index.ts)
// Normalize so a flat-string body still surfaces its message to the
// structured envelope instead of collapsing to `HTTP <status>: `, which
// would drop the only diagnostic the daemon actually returned to a
// headless caller.
async function structuredHttpFailure(resp, fallbackCode = 'daemon-not-running') {
  let raw = '';
  let parsed;
  try {
    raw = await resp.text();
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const errorObj =
    typeof parsed?.error === 'string'
      ? typeof parsed.message === 'string'
        ? { ...parsed, code: parsed.error }
        : { message: parsed.error }
      : parsed?.error;
  const errCode = normalizeRecoverableErrorCode(errorObj?.code, errorObj?.message);
  if (errCode) {
    exitWithStructuredError({
      code:    errCode,
      message: errorObj?.message ?? `HTTP ${resp.status}`,
      data:    structuredErrorData(errorObj),
    });
  }
  exitWithStructuredError({
    code:    fallbackCode,
    message: errorObj?.message ?? `HTTP ${resp.status}${raw ? `: ${raw}` : ''}`,
    data:    structuredErrorData(errorObj),
  });
}

function normalizeRecoverableErrorCode(code, message) {
  if (code === 'DESKTOP_AUTH_PENDING') return 'desktop-auth-pending';
  if (code === 'FORBIDDEN' && /desktop import token rejected/i.test(String(message ?? ''))) {
    return 'desktop-import-token-rejected';
  }
  return code;
}

function structuredErrorData(error) {
  if (!error || typeof error !== 'object') return undefined;
  const data = {};
  if ('data' in error && error.data !== undefined) Object.assign(data, error.data);
  if ('details' in error && error.details !== undefined) data.details = error.details;
  if (typeof error.retryable === 'boolean') data.retryable = error.retryable;
  return Object.keys(data).length > 0 ? data : undefined;
}

async function runPlugin(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    printPluginHelp();
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'list':      return runPluginList(rest);
    case 'search':    return runPluginSearch(rest);
    case 'stats':     return runPluginStats(rest);
    case 'sources':   return runPluginSources(rest);
    case 'info':      return runPluginInfo(rest);
    case 'manifest':  return runPluginManifest(rest);
    case 'install':   return runPluginInstall(rest);
    case 'upgrade':   return runPluginUpgrade(rest);
    case 'uninstall': return runPluginUninstall(rest);
    case 'apply':     return runPluginApply(rest);
    case 'duplicate': return runPluginDuplicate(rest);
    case 'canon':     return runPluginCanon(rest);
    case 'diff':      return runPluginDiff(rest);
    case 'doctor':    return runPluginDoctor(rest);
    case 'replay':    return runPluginReplay(rest);
    case 'trust':     return runPluginTrust(rest);
    case 'snapshots': return runPluginSnapshots(rest);
    case 'simulate':  return runPluginSimulate(rest);
    case 'verify':    return runPluginVerify(rest);
    case 'events':    return runPluginEvents(rest);
    case 'run':       return runPluginRun(rest);
    case 'scaffold': return runPluginScaffold(rest);
    case 'validate': return runPluginValidate(rest);
    case 'pack':     return runPluginPack(rest);
    case 'candidates': return runPluginCandidates(rest);
    case 'login':    return runPluginLogin(rest);
    case 'whoami':   return runPluginWhoami(rest);
    case 'export':   return runPluginExport(rest);
    case 'publish':  return runPluginPublish(rest);
    case 'publish-repo': return runPluginPublishRepo(rest);
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} plugin ${sub}`);
      printPluginHelp();
      process.exit(2);
  }
}

// Phase 4 / spec §14.1 — `pixo plugin scaffold` interactive starter.
//
// Side-effect: writes a SKILL.md + pixo.json starter under
// `<targetDir>/<id>/`. Default targetDir is process.cwd() so a code
// agent can drop the scaffold into the current repo root.
async function runPluginScaffold(rest) {
  const flags = parseFlags(rest, {
    string: new Set([
      'id', 'title', 'description', 'task-kind', 'mode', 'scenario', 'out',
    ]),
    boolean: new Set(['help', 'h', 'json', 'with-claude-plugin']),
  });
  if (rest.length === 0 || flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin scaffold --id <id> [--title "<title>"] [--description "<text>"]
                     [--task-kind new-generation|code-migration|figma-migration|tune-collab]
                     [--mode <mode>] [--scenario <scenario>]
                     [--out <dir>] [--with-claude-plugin]

Writes <out|cwd>/<id>/{SKILL.md,pixo.json,README.md}.`);
    process.exit(rest.length === 0 ? 2 : 0);
  }
  const id = typeof flags.id === 'string' && flags.id.length > 0
    ? flags.id
    : rest.find((a) => !a.startsWith('-'));
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin scaffold --id <id>`);
    process.exit(2);
  }
  const targetDir = typeof flags.out === 'string' && flags.out.length > 0
    ? flags.out
    : process.cwd();
  const { scaffoldPlugin, ScaffoldError } = await import('./plugins/scaffold.js');
  try {
    const input = {
      targetDir,
      id,
      ...(flags.title       ? { title: flags.title }             : {}),
      ...(flags.description ? { description: flags.description } : {}),
      ...(flags['task-kind']
        ? { taskKind: flags['task-kind'] }
        : {}),
      ...(flags.mode        ? { mode: flags.mode }               : {}),
      ...(flags.scenario    ? { scenario: flags.scenario }       : {}),
      withClaudePlugin: Boolean(flags['with-claude-plugin']),
    };
    const result = await scaffoldPlugin(input);
    if (flags.json) return process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    console.log(`[scaffold] ${result.folder}`);
    for (const file of result.files) console.log(`  ${file}`);
    console.log(`\nNext: ${PRODUCT_CLI_NAME} plugin install ${result.folder}`);
  } catch (err) {
    if (err instanceof ScaffoldError) {
      console.error(`[scaffold] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

// Phase 4 / spec §11.5 / plan §3.W1 — `pixo plugin validate <folder>`.
//
// Pre-install lint pass against an author's working dir. Optionally
// fetches the daemon's registry view so skill / DS / atom refs in
// the manifest can be checked too; falls back to an empty registry
// when --no-daemon is set or the daemon is unreachable.
async function runPluginValidate(rest) {
  const flags = parseFlags(rest, {
    string:  new Set(['daemon-url']),
    boolean: new Set(['help', 'h', 'json', 'no-daemon']),
  });
  if (flags.help || flags.h || rest.length === 0 || rest[0]?.startsWith('-')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin validate <folder> [--json] [--no-daemon] [--daemon-url <url>]

Runs the plugin doctor against an unfinished plugin folder before
install. Validates manifest shape, atom ids, until expressions, and
context refs against the live daemon registry (skip with --no-daemon).

Exit codes:
  0  doctor.ok = true
  4  doctor.ok = false (errors present)
  2  CLI usage error / folder unreadable`);
    process.exit(rest.length === 0 ? 2 : 0);
  }
  const folder = rest[0];

  // Try to load the daemon's registry view; the validator works
  // offline too — emits warnings instead of errors for refs we
  // can't resolve.
  let registry;
  if (!flags['no-daemon']) {
    const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
    try {
      const [skillsResp, atomsResp] = await Promise.all([
        fetch(`${base}/api/skills`).catch(() => null),
        fetch(`${base}/api/atoms`).catch(() => null),
      ]);
      const skills = (skillsResp?.ok ? (await skillsResp.json())?.skills : []) ?? [];
      const atoms = (atomsResp?.ok ? (await atomsResp.json())?.atoms : []) ?? [];
      registry = {
        skills:        skills.map((s) => ({ id: s.id, title: s.name ?? s.title, description: s.description })),
        atoms:         atoms.map((atom) => ({ id: atom.id, label: atom.label })),
      };
    } catch {
      registry = undefined;
    }
  }

  let result;
  try {
    const { validatePluginFolder, flattenValidationDiagnostics } = await import('./plugins/validate.js');
    result = await validatePluginFolder({ folder, ...(registry ? { registry } : {}) });
    if (flags.json) {
      const flat = flattenValidationDiagnostics(result);
      process.stdout.write(JSON.stringify({
        ok:      result.ok,
        folder:  result.folder,
        ...(result.doctor ? { freshDigest: result.doctor.freshDigest, pluginId: result.doctor.pluginId } : {}),
        diagnostics: flat,
      }, null, 2) + '\n');
    } else {
      console.log(`[validate] folder: ${result.folder}`);
      if (result.doctor) {
        console.log(`[validate] pluginId: ${result.doctor.pluginId}`);
        console.log(`[validate] freshDigest: ${result.doctor.freshDigest.slice(0, 12)}\u2026`);
      }
      const diagnostics = (await import('./plugins/validate.js')).flattenValidationDiagnostics(result);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      const warnings = diagnostics.filter((d) => d.severity === 'warning');
      const infos = diagnostics.filter((d) => d.severity === 'info');
      for (const d of errors)   console.error(`  [error]   ${d.code}: ${d.message}`);
      for (const d of warnings) console.warn (`  [warning] ${d.code}: ${d.message}`);
      for (const d of infos)    console.log  (`  [info]    ${d.code}: ${d.message}`);
      if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
        console.log('[validate] no issues');
      }
      console.log(`[validate] ok=${result.ok}`);
    }
  } catch (err) {
    console.error(`[validate] failed: ${err?.message ?? err}`);
    process.exit(2);
  }
  process.exit(result.ok ? 0 : 4);
}

// Phase 4 / spec §14 / plan §3.X1 — `pixo plugin pack <folder>`.
//
// Produces a gzip-compressed tar archive ready to install via the
// installer's HTTPS-tarball path. The output path is folder-base +
// version when the manifest exposes a version, otherwise folder-base.
async function runPluginPack(rest) {
  const flags = parseFlags(rest, {
    string:  new Set(['out']),
    boolean: new Set(['help', 'h', 'json']),
  });
  if (flags.help || flags.h || rest.length === 0 || rest[0]?.startsWith('-')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin pack <folder> [--out <path>] [--json]

Builds a gzip-compressed tar archive of <folder> at --out (default
'<folder>/../<basename>-<manifest.version>.tgz'). The archive is the
exact shape \`${PRODUCT_CLI_NAME} plugin install --source <https://...>\` consumes.

Skipped when packing:
  node_modules / .git / .next / dist / build / out / coverage /
  .turbo / .cache / .pnpm-store / .parcel-cache / .svelte-kit /
  .nuxt / .astro / .vercel / .vscode / .DS_Store / Thumbs.db
  (matches the installer's tarball-extract skiplist).
Symlinks are rejected at pack time (consistent with extract-time
rejection at install).

Exit codes:
  0  archive written
  2  CLI usage error
  4  pack-time error (missing pixo.json, invalid JSON, etc)`);
    process.exit(rest.length === 0 ? 2 : 0);
  }
  const folder = rest[0];
  try {
    const { packPlugin, PackPluginError } = await import('./plugins/pack.js');
    let result;
    try {
      result = await packPlugin({
        folder,
        ...(typeof flags.out === 'string' ? { out: flags.out } : {}),
      });
    } catch (err) {
      if (err instanceof PackPluginError) {
        if (flags.json) {
          process.stdout.write(JSON.stringify({ ok: false, error: err.message }, null, 2) + '\n');
        } else {
          console.error(`[pack] ${err.message}`);
        }
        process.exit(4);
      }
      throw err;
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify({
        ok:            true,
        outPath:       result.outPath,
        bytes:         result.bytes,
        fileCount:     result.files.length,
        pluginId:      result.pluginId,
        pluginVersion: result.pluginVersion,
      }, null, 2) + '\n');
    } else {
      const idStr = result.pluginVersion
        ? `${result.pluginId ?? 'plugin'}@${result.pluginVersion}`
        : result.pluginId ?? 'plugin';
      console.log(`[pack] packed ${idStr}`);
      console.log(`[pack] out:    ${result.outPath}`);
      console.log(`[pack] files:  ${result.files.length}`);
      console.log(`[pack] bytes:  ${result.bytes}`);
      console.log(`\nNext: ${PRODUCT_CLI_NAME} plugin install --source ${result.outPath}`);
    }
  } catch (err) {
    console.error(`[pack] failed: ${err?.message ?? err}`);
    process.exit(2);
  }
}

async function runPluginLogin(rest) {
  const flags = parseFlags(rest, {
    string: new Set(['host']),
    boolean: new Set(['help', 'h']),
  });
  if (flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin login [--host github.com]

Wraps GitHub CLI auth for OpenPixo registry publishing. The token stays in gh.`);
    return;
  }
  const host = typeof flags.host === 'string' ? flags.host : 'github.com';
  const version = await execGhBuffered(['--version'], { timeout: 10_000 });
  if (!version.ok) {
    console.error('[plugin login] GitHub CLI is required. Install gh from https://cli.github.com/ and retry.');
    process.exit(1);
  }
  const result = await spawnGhPassthrough(['auth', 'login', '--hostname', host, '--web']);
  process.exit(result.code ?? 0);
}

async function runPluginWhoami(rest) {
  const flags = parseFlags(rest, {
    string: new Set(['host']),
    boolean: new Set(['help', 'h', 'json']),
  });
  if (flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin whoami [--host github.com] [--json]

Shows the GitHub account gh will use for OpenPixo registry publishing.`);
    return;
  }
  const host = typeof flags.host === 'string' ? flags.host : 'github.com';
  const auth = await execGhBuffered(['auth', 'status', '--hostname', host], { timeout: 10_000 });
  if (!auth.ok) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({
        ok: false,
        host,
        message: 'GitHub CLI is not authenticated for this host.',
        log: auth.stderr || auth.stdout,
      }, null, 2) + '\n');
      return;
    }
    console.error(`[plugin whoami] gh is not authenticated for ${host}. Run: ${PRODUCT_CLI_NAME} plugin login --host ${host}`);
    if (auth.stderr || auth.stdout) console.error(auth.stderr || auth.stdout);
    process.exit(1);
  }
  const user = await execGhBuffered(['api', 'user', '--hostname', host], { timeout: 10_000 });
  let login = '';
  let name = '';
  try {
    const parsed = JSON.parse(user.stdout || '{}');
    login = typeof parsed.login === 'string' ? parsed.login : '';
    name = typeof parsed.name === 'string' ? parsed.name : '';
  } catch {
    // Keep the auth status useful even if gh api output is unavailable.
  }
  const payload = {
    ok: true,
    host,
    login,
    name,
    auth: auth.stderr || auth.stdout,
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    console.log(`[plugin whoami] ${login || 'authenticated'}${name ? ` (${name})` : ''} @ ${host}`);
  }
}

async function execFileBuffered(command, args, opts = {}) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile(command, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      ...opts,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code,
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? '').trim(),
        error,
      });
    });
  });
}

function quotePosixShellArg(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildGhShellCommand(args) {
  return ['gh', ...args].map(quotePosixShellArg).join(' ');
}

function buildLoginShellCommand(innerCommand) {
  return `export PATH=${quotePosixShellArg(process.env.PATH ?? '')}; ${innerCommand}`;
}

async function execGhBuffered(args, opts = {}) {
  if (process.platform === 'win32') return execFileBuffered('gh', args, opts);
  const shell = process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL.trim() : '/bin/zsh';
  return execFileBuffered(shell, ['-c', buildLoginShellCommand(buildGhShellCommand(args))], {
    env: process.env,
    ...opts,
  });
}

async function spawnPassthrough(command, args, opts = {}) {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...opts });
    child.on('error', (error) => resolve({ code: 1, error }));
    child.on('close', (code) => resolve({ code }));
  });
}

async function spawnGhPassthrough(args) {
  if (process.platform === 'win32') return spawnPassthrough('gh', args);
  const shell = process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL.trim() : '/bin/zsh';
  return spawnPassthrough(shell, ['-c', buildLoginShellCommand(buildGhShellCommand(args))], {
    env: process.env,
  });
}

function inferGithubHost(target) {
  if (!target || target === 'github.com') return 'github.com';
  try {
    const parsed = new URL(target);
    return parsed.hostname || 'github.com';
  } catch {
    // Marketplace ids are not URLs; v1 GitHub-backed auth defaults to github.com.
    return 'github.com';
  }
}

// Phase 4 / spec §14 — `pixo plugin export <projectId> --as <target>`.
//
// Produces a publish-ready folder from the AppliedPluginSnapshot
// behind a given project (or directly from a snapshot id). Three
// targets: 'pixo', 'claude-plugin', 'agent-skill'.
async function runPluginExport(rest) {
  const flags = parseFlags(rest, {
    string: new Set([
      'daemon-url',
      'as',
      'out',
      'snapshot-id',
      'project',


    ]),
    boolean: new Set(['help', 'h', 'json']),
  });
  if (rest.length === 0 || flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin export <projectId> --as pixo|claude-plugin|agent-skill --out <dir>
  ${PRODUCT_CLI_NAME} plugin export --snapshot-id <id> --as pixo|claude-plugin|agent-skill --out <dir>

The export resolves through the daemon HTTP \`POST /api/applied-plugins/export\`
endpoint so the running daemon's installed_plugins / applied_plugin_snapshots
view is the single source of truth.`);
    process.exit(rest.length === 0 ? 2 : 0);
  }
  const positional = rest.find((a) => !a.startsWith('-'));
  const projectId = flags.project ?? positional ?? null;
  const snapshotId = typeof flags['snapshot-id'] === 'string' ? flags['snapshot-id'] : null;
  if (!projectId && !snapshotId) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin export <projectId> --as <target> --out <dir>`);
    process.exit(2);
  }
  const target = String(flags.as ?? 'pixo');
  if (target !== 'pixo' && target !== 'claude-plugin' && target !== 'agent-skill') {
    console.error(`--as must be one of: pixo, claude-plugin, agent-skill (got "${target}")`);
    process.exit(2);
  }
  const out = typeof flags.out === 'string' && flags.out.length > 0
    ? flags.out
    : process.cwd();
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const resp = await pluginFetch(flags, `${base}/api/applied-plugins/export`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({
      ...(snapshotId ? { snapshotId } : { projectId }),
      target,
      outDir: out,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error(`POST /api/applied-plugins/export failed: ${resp.status} ${JSON.stringify(data)}`);
    process.exit(1);
  }
  if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  console.log(`[export] ${data.folder} (snapshot ${data.snapshotId})`);
  for (const f of data.files ?? []) console.log(`  ${f}`);
}

// Plan §3.B4 / spec §6: `pixo marketplace …` minimum verbs. Add / list /
// refresh / remove / trust. The Phase 3 follow-up wires
// `pixo plugin install <name>` resolution through these catalogs.
async function runMarketplace(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} marketplace add     <url> [--trust trusted|restricted]   Register a federated catalog.
  ${PRODUCT_CLI_NAME} marketplace list                                         List registered marketplaces.
  ${PRODUCT_CLI_NAME} marketplace info    <id>                                 Inspect one marketplace + cached manifest.
  ${PRODUCT_CLI_NAME} marketplace plugins <id> [--json]                        List cached plugin entries for one marketplace.
  ${PRODUCT_CLI_NAME} marketplace search  <query> [--json]                     Search cached marketplace entries.
  ${PRODUCT_CLI_NAME} marketplace doctor  [id] [--strict] [--json]             Validate cached marketplace entries.
  ${PRODUCT_CLI_NAME} marketplace login   <id|url> [--host github.com]         Authenticate gh for private GitHub catalogs.
  ${PRODUCT_CLI_NAME} marketplace refresh <id>                                 Re-fetch the manifest.
  ${PRODUCT_CLI_NAME} marketplace remove  <id>                                 Forget a marketplace.
  ${PRODUCT_CLI_NAME} marketplace trust   <id> [--trust trusted|restricted|official]
                                                              Update the marketplace trust tier.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base (default PIXO_DAEMON_URL, inherited sidecar discovery, or http://127.0.0.1:7456).
  --json               Emit raw JSON (suitable for scripts).`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  switch (sub) {
    case 'list': {
      const resp = await fetch(`${base}/api/marketplaces`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return structuredHttpFailure(resp);
      if (flags.json) {
        process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        return;
      }
      const rows = data?.marketplaces ?? [];
      if (rows.length === 0) {
        console.log(`No marketplaces registered. Run \`${PRODUCT_CLI_NAME} marketplace add <url>\`.`);
        return;
      }
      for (const m of rows) {
        console.log(`${m.id}  version=${m.version ?? 'unknown'}  spec=${m.specVersion ?? 'unknown'}  trust=${m.trust}  url=${m.url}`);
      }
      return;
    }
    case 'search': {
      // Plan §3.H4 / spec §12 — marketplace catalog query. Walks
      // every configured marketplace's plugins[] entry and matches
      // by substring on name + description + tags.
      const query = (rest.find((a) => !a.startsWith('-')) ?? '').toLowerCase();
      if (!query) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} marketplace search "<query>" [--tag <tag>]`);
        process.exit(2);
      }
      const tag = typeof flags.tag === 'string' ? flags.tag.toLowerCase() : null;
      const resp = await fetch(`${base}/api/marketplaces`);
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      const matches = [];
      for (const mp of data?.marketplaces ?? []) {
        const plugins = mp.manifest?.plugins ?? [];
        for (const p of plugins) {
          const haystack = [
            p.name ?? '',
            p.description ?? '',
            ...(Array.isArray(p.tags) ? p.tags : []),
          ].join(' ').toLowerCase();
          if (!haystack.includes(query)) continue;
          if (tag && !(Array.isArray(p.tags) && p.tags.map((t) => t.toLowerCase()).includes(tag))) continue;
          matches.push({
            marketplaceId:  mp.id,
            marketplaceUrl: mp.url,
            marketplaceVersion: mp.version,
            name:           p.name,
            version:        p.version,
            source:         p.source,
            description:    p.description ?? '',
            tags:           p.tags ?? [],
          });
        }
      }
      if (flags.json) {
        process.stdout.write(JSON.stringify({ matches }, null, 2) + '\n');
        return;
      }
      if (matches.length === 0) {
        console.log(`No matches for "${query}"`);
        return;
      }
      for (const m of matches) {
        console.log(`${m.name}@${m.version}\t${m.source}\t${m.marketplaceId}@${m.marketplaceVersion}\t${m.description}`);
      }
      return;
    }
    case 'plugins': {
      const id = rest.find((a) => !a.startsWith('-'));
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} marketplace plugins <id> [--json]`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/marketplaces/${encodeURIComponent(id)}/plugins`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`plugins failed: ${resp.status} ${JSON.stringify(data)}`);
        process.exit(1);
      }
      const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
      if (flags.json) {
        process.stdout.write(JSON.stringify({ marketplaceId: id, plugins }, null, 2) + '\n');
        return;
      }
      if (plugins.length === 0) {
        console.log(`No plugins in marketplace ${id}.`);
        return;
      }
      for (const p of plugins) {
        console.log(`${p.name}@${p.version}\t${p.source}\t${p.description ?? ''}`);
      }
      return;
    }
    case 'doctor': {
      const strict = flags.strict === true;
      const id = rest.find((a) => !a.startsWith('-'));
      const resp = id
        ? await fetch(`${base}/api/marketplaces/${encodeURIComponent(id)}`)
        : await fetch(`${base}/api/marketplaces`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`doctor failed: ${resp.status} ${JSON.stringify(data)}`);
        process.exit(1);
      }
      const rows = id ? [data] : (data?.marketplaces ?? []);
      const { doctorMarketplace } = await import('./plugins/marketplace-doctor.js');
      const reports = [];
      for (const row of rows) {
        reports.push(await doctorMarketplace({
          id: row.id,
          trust: row.trust,
          manifest: row.manifest,
          strict,
        }));
      }
      const ok = reports.every((report) => report.ok);
      if (flags.json) {
        process.stdout.write(JSON.stringify({ ok, reports }, null, 2) + '\n');
      } else {
        for (const report of reports) {
          console.log(`[marketplace doctor] ${report.backendId}: ${report.ok ? 'ok' : 'issues'} (${report.entriesChecked} entries)`);
          for (const issue of report.issues) {
            console.log(`  [${issue.severity}] ${issue.code}${issue.pluginName ? ` ${issue.pluginName}` : ''}: ${issue.message}`);
          }
        }
      }
      process.exit(ok ? 0 : 1);
    }
    case 'login': {
      const target = rest.find((a) => !a.startsWith('-'));
      const host = typeof flags.host === 'string'
        ? flags.host
        : inferGithubHost(target ?? 'github.com');
      const version = await execFileBuffered('gh', ['--version'], { timeout: 10_000 });
      if (!version.ok) {
        console.error('[marketplace login] GitHub CLI is required. Install gh from https://cli.github.com/ and retry.');
        process.exit(1);
      }
      console.log(`[marketplace login] authenticating gh for ${host}. Tokens stay in gh, not OpenPixo.`);
      const result = await spawnPassthrough('gh', ['auth', 'login', '--hostname', host, '--web']);
      process.exit(result.code ?? 0);
    }
    case 'add': {
      const url = rest.find((a) => !a.startsWith('-'));
      if (!url) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} marketplace add <url> [--trust trusted|restricted]`);
        process.exit(2);
      }
      const trust = flags.trust ?? 'restricted';
      const resp = await fetch(`${base}/api/marketplaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, trust }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`add failed: ${resp.status} ${JSON.stringify(data)}`);
        process.exit(1);
      }
      console.log(`[marketplace] added ${data.id} (${data.url}) trust=${data.trust}`);
      return;
    }
    case 'info':
    case 'refresh':
    case 'remove':
    case 'trust': {
      const id = rest.find((a) => !a.startsWith('-')
        && a !== flags.trust);
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} marketplace ${sub} <id>`);
        process.exit(2);
      }
      let url;
      let method = 'GET';
      let body;
      if (sub === 'info')         url = `${base}/api/marketplaces/${encodeURIComponent(id)}`;
      else if (sub === 'refresh') { url = `${base}/api/marketplaces/${encodeURIComponent(id)}/refresh`; method = 'POST'; }
      else if (sub === 'remove')  { url = `${base}/api/marketplaces/${encodeURIComponent(id)}`; method = 'DELETE'; }
      else if (sub === 'trust') {
        const trust = flags.trust ?? 'trusted';
        url = `${base}/api/marketplaces/${encodeURIComponent(id)}/trust`;
        method = 'POST';
        body = JSON.stringify({ trust });
      }
      const resp = await fetch(url, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body } : {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`${sub} failed: ${resp.status} ${JSON.stringify(data)}`);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} marketplace ${sub}`);
      process.exit(2);
  }
}

// Plan §3.A5 / spec §16 Phase 5: operator escape hatch for snapshot GC.
// Two subcommands:
//   - `pixo plugin snapshots list [--project <id>]` — list snapshots
//   - `pixo plugin snapshots prune [--before <ts>]` — force-delete expired
//     (and optionally older-than-cutoff unreferenced) rows.
async function runPluginSnapshots(args) {
  const sub = args[0];
  if (!sub || sub === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin snapshots list  [--project <id>]
                                                               List applied plugin snapshots.
  ${PRODUCT_CLI_NAME} plugin snapshots show  <snapshotId> [--json]          Print one snapshot's full contents.
  ${PRODUCT_CLI_NAME} plugin snapshots diff  <id-a> <id-b> [--json]         Compare two snapshots field-by-field.
  ${PRODUCT_CLI_NAME} plugin snapshots prune [--before <unix-ms>]           Delete expired (or older-than-cutoff) snapshots.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const snapshotStringFlags =
    sub === 'list' ? PLUGIN_PROJECT_RESOURCE_STRING_FLAGS : PLUGIN_STRING_FLAGS;
  const flags = parseFlags(args.slice(1), {
    string: snapshotStringFlags,
    boolean: PLUGIN_BOOLEAN_FLAGS,
  });
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  if (sub === 'show') {
    const positional = args.slice(1).filter((a) => !a.startsWith('-'));
    const id = positional[0];
    if (!id) {
      console.error(`Usage: ${PRODUCT_CLI_NAME} plugin snapshots show <snapshotId>`);
      process.exit(2);
    }
    const url = `${base}/api/applied-plugins/${encodeURIComponent(id)}`;
    const resp = await pluginFetch(flags, url);
    if (resp.status === 404) {
      console.error(`snapshot ${id} not found`);
      process.exit(72);
    }
    if (!resp.ok) {
      console.error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  if (sub === 'diff') {
    const positional = args.slice(1).filter((a) => !a.startsWith('-'));
    if (positional.length < 2) {
      console.error(`Usage: ${PRODUCT_CLI_NAME} plugin snapshots diff <id-a> <id-b>`);
      process.exit(2);
    }
    const [idA, idB] = positional;
    const [respA, respB] = await Promise.all([
      pluginFetch(flags, `${base}/api/applied-plugins/${encodeURIComponent(idA)}`),
      pluginFetch(flags, `${base}/api/applied-plugins/${encodeURIComponent(idB)}`),
    ]);
    if (respA.status === 404) { console.error(`snapshot ${idA} not found`); process.exit(72); }
    if (respB.status === 404) { console.error(`snapshot ${idB} not found`); process.exit(72); }
    if (!respA.ok || !respB.ok) {
      console.error(`fetch failed: ${respA.status} / ${respB.status}`);
      process.exit(1);
    }
    const a = await respA.json();
    const b = await respB.json();
    const { diffSnapshots } = await import('./plugins/snapshot-diff.js');
    const report = diffSnapshots({ a, b });
    if (flags.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return;
    }
    const digestNote = report.digestEqual
      ? '\u2713 manifestSourceDigest equal (e2e-2 invariant holds)'
      : '\u2717 manifestSourceDigest DIFFERS (replay would diverge)';
    console.log(`[snapshots diff] ${idA} \u2194 ${idB}`);
    console.log(`  ${digestNote}`);
    console.log(`  ${report.added} added, ${report.removed} removed, ${report.changed} changed`);
    if (report.entries.length === 0) {
      console.log('  (no field-level differences)');
      return;
    }
    for (const e of report.entries) {
      const tag = e.kind === 'added' ? '+' : e.kind === 'removed' ? '-' : '~';
      if (e.summary) {
        console.log(`  ${tag} ${e.field}  (${e.summary})`);
      } else if (e.kind === 'changed') {
        console.log(`  ${tag} ${e.field}: ${e.before ?? ''} \u2192 ${e.after ?? ''}`);
      } else if (e.kind === 'added') {
        console.log(`  ${tag} ${e.field}: ${e.after ?? ''}`);
      } else {
        console.log(`  ${tag} ${e.field}: ${e.before ?? ''}`);
      }
    }
    return;
  }
  if (sub === 'list') {
    const url = flags.project
      ? `${base}/api/projects/${encodeURIComponent(flags.project)}/applied-plugins`
      : `${base}/api/applied-plugins`;
    const resp = await fetch(url, { headers: requestHeaders });
    if (!resp.ok) {
      console.error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  if (sub === 'prune') {
    const url = `${base}/api/applied-plugins/prune`;
    const before = flags.before ? Number(flags.before) : undefined;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(before ? { before } : {}),
    });
    if (!resp.ok) {
      console.error(`POST ${url} failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    console.log(`[snapshots] pruned ${data.removed ?? 0} snapshot(s)`);
    return;
  }
  console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} plugin snapshots ${sub}`);
  process.exit(2);
}

// Plan §3.B3: `pixo plugin run <id>` shorthand. Today this is a thin
// wrapper around `pixo plugin apply` + `POST /api/runs` so a code agent
// can drive the apply→start→follow loop without two hops.
async function runPluginRun(rest) {
  const flags = parseFlags(rest, {
    string: PLUGIN_PROJECT_RESOURCE_STRING_FLAGS,
    boolean: PLUGIN_BOOLEAN_FLAGS,
  });
  const id = positionalArgs(rest, PLUGIN_PROJECT_RESOURCE_STRING_FLAGS)[0];
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin run <id> --project <projectId> [--inputs <json>] [--agent <id>] [--message "<text>"] [--grant-caps a,b] [--follow]`);
    process.exit(2);
  }
  if (!flags.project) {
    console.error('--project <projectId> is required (Phase 1.5 will add the auto-create wrapper)');
    process.exit(2);
  }
  const inputs = flags.inputs ? safeParseJson(flags.inputs) ?? {} : {};
  const grantCaps = typeof flags['grant-caps'] === 'string' && flags['grant-caps'].length > 0
    ? flags['grant-caps'].split(',').map((c) => c.trim()).filter(Boolean)
    : [];
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  // 1. Apply (returns ApplyResult + manifestSourceDigest).
  const applyResp = await fetch(`${base}/api/plugins/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...requestHeaders },
    body: JSON.stringify({ inputs, grantCaps, projectId: flags.project }),
  });
  const applyData = await applyResp.json().catch(() => ({}));
  if (!applyResp.ok) {
    console.error(`apply failed: ${applyResp.status} ${JSON.stringify(applyData)}`);
    process.exit(applyResp.status === 422 ? 67 : 1);
  }
  // 2. Start the run with pluginId so the daemon resolver pins the
  //    snapshot to the run object.
  const runResp = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...requestHeaders },
    body: JSON.stringify({
      projectId:        flags.project,
      pluginId:         id,
      pluginInputs:     inputs,
      grantCaps,
      ...(flags.conversation ? { conversationId: flags.conversation } : {}),
      ...(flags.message ? { message: flags.message } : {}),
      ...(flags.agent ? { agentId: flags.agent } : {}),
      ...(flags.model ? { model: flags.model } : {}),
      ...(flags['snapshot-id'] ? { appliedPluginSnapshotId: flags['snapshot-id'] } : {}),
    }),
  });
  const runData = await runResp.json().catch(() => ({}));
  if (!runResp.ok) {
    if (runResp.status === 409 && runData?.error?.code === 'capabilities-required') {
      const missing = (runData.error.data?.missing ?? []).join(',');
      console.error(`[run] capabilities required: ${missing}`);
      console.error(`[run] retry with --grant-caps ${missing} or run \`${PRODUCT_CLI_NAME} plugin trust ${id} --capabilities ${missing}\``);
      process.exit(66);
    }
    console.error(`run failed: ${runResp.status} ${JSON.stringify(runData)}`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ apply: applyData, run: runData }, null, 2) + '\n');
    if (flags.follow) await streamRunEvents(base, runData.runId, requestHeaders);
    return;
  }
  console.log(`[run] started run ${runData.runId} (snapshot ${runData.appliedPluginSnapshotId ?? applyData?.appliedPlugin?.snapshotId ?? 'n/a'})`);
  if (flags.follow) {
    await streamRunEvents(base, runData.runId, requestHeaders);
  }
}

async function pluginDaemonUrl(flags) {
  return cliDaemonUrl(flags);
}

function pluginFetch(flags, input, init = {}) {
  const scoped = {};
  const headers = {
    ...scoped,
    ...(init.headers ?? {}),
  };
  return fetch(input, { ...init, headers });
}

// Plan §3.Y1 — filter knobs on `pixo plugin list` (and feeds
// `pixo plugin search` below). Recognising these as string flags
// keeps the parseFlags() argv consumer happy.
async function runPluginList(rest) {
  const flags = parseFlags(rest, {
    string:  PLUGIN_LIST_FILTER_FLAGS,
    boolean: PLUGIN_LIST_BOOLEAN_FLAGS,
  });
  if (flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin list [--task-kind <kind>] [--mode <mode>] [--tag <tag>] \\
                 [--trust <tier>] [--bundled | --no-bundled] [--json]

Lists installed plugins. Filters AND together: --task-kind=code-migration
+ --tag=phase-7 returns only code-migration plugins tagged 'phase-7'.

  --task-kind   Match pixo.taskKind (new-generation / figma-migration /
                code-migration / tune-collab).
  --mode        Match pixo.mode.
  --tag         Match an entry in tags[].
  --trust       Match trust tier (trusted / restricted / bundled).
  --bundled     Restrict to bundled plugins (sourceKind='bundled' OR
                trust='bundled').
  --no-bundled  Exclude bundled plugins.`);
    process.exit(0);
  }
  const data = await fetchPluginList(flags);
  const filtered = await applyPluginFilters(data?.plugins ?? [], flags);
  emitPluginList({ entries: filtered, json: !!flags.json, emptyMessage: 'No plugins matched the filter.' });
}

// Plan §3.Y1 — `pixo plugin search <query>`.
async function runPluginSearch(rest) {
  const flags = parseFlags(rest, {
    string:  PLUGIN_LIST_FILTER_FLAGS,
    boolean: PLUGIN_LIST_BOOLEAN_FLAGS,
  });
  const positional = rest.filter((a) => !a.startsWith('-'));
  const query = positional[0];
  if (flags.help || flags.h || !query) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin search <query> [--task-kind <kind>] [--mode <mode>] \\
                           [--tag <tag>] [--trust <tier>] \\
                           [--bundled | --no-bundled] [--json]

Free-text search across installed plugins. Matches case-insensitively
on id / title / description / tags. Combines with the same filter
flags as '${PRODUCT_CLI_NAME} plugin list'.`);
    process.exit(query ? 0 : 2);
  }
  const data = await fetchPluginList(flags);
  const filtered = await applyPluginFilters(data?.plugins ?? [], flags, query);
  emitPluginList({
    entries: filtered,
    json:    !!flags.json,
    emptyMessage: `No installed plugins matched "${query}".`,
    showRank: true,
  });
}

// Plan §3.DD1 — `pixo plugin stats`. Pretty-prints the
// pluginInventoryStats + snapshotInventoryStats aggregation. The
// daemon-side route owns the SQLite reads; the CLI is a thin
// formatter.
async function runPluginStats(rest) {
  const flags = parseFlags(rest, {
    string:  PLUGIN_STRING_FLAGS,
    boolean: PLUGIN_BOOLEAN_FLAGS,
  });
  if (flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin stats [--json]

Prints an at-a-glance plugin + snapshot inventory:
  - Plugin counts by sourceKind, trust, taskKind.
  - Bundled vs. third-party split.
  - Plugins with elevated capabilities (fs:write, subprocess,
    bash, network).
  - Snapshot total, status breakdown, project / run linkage.
  - Oldest / newest applied snapshot timestamps.`);
    process.exit(0);
  }
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const url = `${base}/api/plugins/stats`;
  const resp = await pluginFetch(flags, url);
  if (!resp.ok) {
    console.error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  const p = data?.plugins ?? {};
  const s = data?.snapshots ?? {};
  const lastInstalled = formatTimestamp(p.lastInstalledAt);
  const lastUpdated   = formatTimestamp(p.lastUpdatedAt);
  const oldestApplied = formatTimestamp(s.oldestAppliedAt);
  const newestApplied = formatTimestamp(s.newestAppliedAt);
  console.log('# Plugins');
  console.log(`  total:            ${p.total ?? 0}`);
  console.log(`  bundled:          ${p.bundled ?? 0}`);
  console.log(`  third-party:      ${p.thirdParty ?? 0}`);
  console.log(`  with elevated:    ${p.withElevatedCapabilities ?? 0}`);
  console.log(`  by sourceKind:    ${formatCounts(p.bySourceKind)}`);
  console.log(`  by trust:         ${formatCounts(p.byTrust)}`);
  console.log(`  by taskKind:      ${formatCounts(p.byTaskKind)}`);
  console.log(`  last installed:   ${lastInstalled}`);
  console.log(`  last updated:     ${lastUpdated}`);
  console.log('');
  console.log('# Snapshots');
  console.log(`  total:            ${s.total ?? 0}`);
  console.log(`  by status:        ${formatCounts(s.byStatus)}`);
  console.log(`  with project:     ${s.withProject ?? 0}`);
  console.log(`  with run:         ${s.withRun ?? 0}`);
  console.log(`  oldest applied:   ${oldestApplied}`);
  console.log(`  newest applied:   ${newestApplied}`);
}

function formatCounts(counts) {
  if (!counts || typeof counts !== 'object') return '(none)';
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '(none)';
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}

function formatTimestamp(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '(none)';
  try { return new Date(ts).toISOString(); } catch { return String(ts); }
}

async function fetchPluginList(flags) {
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins`;
  const resp = await pluginFetch(flags, url);
  if (!resp.ok) {
    console.error(`GET /api/plugins failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  return data;
}

async function applyPluginFilters(plugins, flags, query) {
  if (!Array.isArray(plugins) || plugins.length === 0) return [];
  const { searchInstalledPlugins } = await import('./plugins/search.js');
  const trustFlag = typeof flags.trust === 'string' ? flags.trust : undefined;
  const taskKind  = typeof flags['task-kind'] === 'string' ? flags['task-kind'] : undefined;
  const mode      = typeof flags.mode === 'string' ? flags.mode : undefined;
  const tag       = typeof flags.tag === 'string'  ? flags.tag  : undefined;
  let bundled;
  if (flags.bundled === true)         bundled = true;
  if (flags['no-bundled'] === true)   bundled = false;
  const result = searchInstalledPlugins({
    plugins,
    ...(typeof query === 'string' && query.trim() ? { query } : {}),
    ...(taskKind ? { taskKind } : {}),
    ...(mode     ? { mode } : {}),
    ...(tag      ? { tag } : {}),
    ...(trustFlag === 'trusted' || trustFlag === 'restricted' || trustFlag === 'bundled' ? { trust: trustFlag } : {}),
    ...(typeof bundled === 'boolean' ? { bundled } : {}),
  });
  return result.entries;
}

function emitPluginList({ entries, json, emptyMessage, showRank }) {
  if (json) {
    process.stdout.write(JSON.stringify({
      total: entries.length,
      plugins: entries.map((e) => ({
        ...e.plugin,
        ...(showRank ? { matched: e.matched, rank: e.rank } : {}),
      })),
    }, null, 2) + '\n');
    return;
  }
  if (entries.length === 0) {
    console.log(emptyMessage ?? 'No plugins matched.');
    return;
  }
  for (const entry of entries) {
    const p = entry.plugin;
    const tail = showRank && entry.matched.length > 0
      ? `  matched=[${entry.matched.join(',')}]`
      : '';
    console.log(`${p.id}@${p.version}  trust=${p.trust}  source=${p.sourceKind}  title="${p.title}"${tail}`);
  }
}

async function runPluginInfo(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('--')
    && a !== flags['daemon-url']
    && a !== flags.source
    && a !== flags.version);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin info <id-or-marketplace-name> [--version <version|tag|range>] [--json]`);
    process.exit(2);
  }
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const url = `${base}/api/plugins/${encodeURIComponent(id)}`;
  const resp = await pluginFetch(flags, url);
  if (resp.ok && !flags.version) {
    const data = await resp.json();
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  const mpResp = await pluginFetch(flags, `${base}/api/marketplaces`);
  if (mpResp.ok) {
    const mpData = await mpResp.json().catch(() => ({}));
    const resolved = resolveMarketplacePluginFromList(
      mpData?.marketplaces ?? [],
      flags.version ? `${id}@${flags.version}` : id,
    );
    if (resolved) {
      process.stdout.write(JSON.stringify({ marketplace: resolved }, null, 2) + '\n');
      return;
    }
  }
  if (!resp.ok) {
    console.error(`GET /api/plugins/${id} failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function resolveMarketplacePluginFromList(marketplaces, specifier) {
  const parsed = parseCliPluginSpecifier(specifier);
  const target = parsed.name.toLowerCase();
  for (const marketplace of marketplaces) {
    for (const entry of marketplace?.manifest?.plugins ?? []) {
      if (String(entry.name ?? '').toLowerCase() !== target) continue;
      const version = resolveCliEntryVersion(entry, parsed.range);
      if (!version) return null;
      return {
        marketplaceId: marketplace.id,
        marketplaceTrust: marketplace.trust,
        name: entry.name,
        version: version.version,
        source: version.source,
        ref: version.ref,
        integrity: version.integrity,
        manifestDigest: version.manifestDigest,
        entry,
      };
    }
  }
  return null;
}

function parseCliPluginSpecifier(input) {
  const trimmed = String(input ?? '').trim();
  const slash = trimmed.indexOf('/');
  const at = trimmed.lastIndexOf('@');
  if (slash > 0 && at > slash + 1) {
    return { name: trimmed.slice(0, at), range: trimmed.slice(at + 1) };
  }
  return { name: trimmed, range: undefined };
}

function resolveCliEntryVersion(entry, range) {
  if (entry?.yanked) return null;
  const versions = Array.isArray(entry?.versions) ? entry.versions : [];
  const target = range && range !== 'latest'
    ? (entry?.distTags?.[range] ?? range)
    : (entry?.distTags?.latest ?? entry?.version);
  const version = versions.find((item) => item.version === target) ?? null;
  if (version?.yanked) return null;
  return {
    version: target,
    source: version?.source ?? entry?.source,
    ref: version?.ref ?? entry?.ref,
    integrity: version?.integrity ?? version?.dist?.integrity ?? entry?.integrity ?? entry?.dist?.integrity,
    manifestDigest: version?.manifestDigest ?? version?.dist?.manifestDigest ?? entry?.manifestDigest ?? entry?.dist?.manifestDigest,
  };
}

// Plan §3.MM1 — `pixo plugin manifest <id>`. Prints just the parsed
// manifest JSON, no wrapper. Useful for plugin authors who want to
// compare the daemon's view to their on-disk pixo.json
// without scrolling past the registry record fields (sourceKind /
// fsPath / installedAt etc).
async function runPluginManifest(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('--') && a !== flags['daemon-url'] && a !== flags.source);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin manifest <id>`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}`;
  const resp = await pluginFetch(flags, url);
  if (resp.status === 404) {
    console.error(`plugin ${id} not found`);
    process.exit(65);
  }
  if (!resp.ok) {
    console.error(`GET /api/plugins/${id} failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  if (!data?.manifest) {
    console.error(`plugin ${id} has no recorded manifest (registry row is incomplete)`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(data.manifest, null, 2) + '\n');
}

// Plan §3.MM2 — `pixo plugin sources`. Lists every distinct install
// source string + count of plugins installed from it, ordered by
// count descending then source ascending. Useful for ops audits
// ('which github repos do my plugins come from') + for plugin
// authors comparing their fork to its upstream installs.
async function runPluginSources(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins`;
  const resp = await pluginFetch(flags, url);
  if (!resp.ok) {
    console.error(`GET /api/plugins failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
  const buckets = new Map();
  for (const p of plugins) {
    const key = `${p.sourceKind ?? 'unknown'}\t${p.source ?? '(none)'}`;
    const entry = buckets.get(key) ?? { sourceKind: p.sourceKind ?? 'unknown', source: p.source ?? '(none)', count: 0, plugins: [] };
    entry.count += 1;
    entry.plugins.push({ id: p.id, version: p.version });
    buckets.set(key, entry);
  }
  const rows = [...buckets.values()].sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.sourceKind !== b.sourceKind) return a.sourceKind.localeCompare(b.sourceKind);
    return a.source.localeCompare(b.source);
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify({ total: plugins.length, sources: rows }, null, 2) + '\n');
    return;
  }
  if (rows.length === 0) {
    console.log('No plugins installed.');
    return;
  }
  console.log(`# Plugin install sources (total: ${plugins.length})`);
  for (const row of rows) {
    console.log(`  ${row.sourceKind.padEnd(11)}  ${String(row.count).padStart(3)}  ${row.source}`);
    for (const plug of row.plugins) {
      console.log(`               \u2514\u2500 ${plug.id}@${plug.version}`);
    }
  }
}

async function runPluginInstall(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const source = typeof flags.source === 'string' ? flags.source : rest.find((a) => !a.startsWith('-'));
  if (!source) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin install <source-or-name>\n` +
      `       ${PRODUCT_CLI_NAME} plugin install ./local-folder\n` +
      `       ${PRODUCT_CLI_NAME} plugin install github:owner/repo[@ref][/subpath]\n` +
      `       ${PRODUCT_CLI_NAME} plugin install https://example.com/plugin.tar.gz\n` +
      `       ${PRODUCT_CLI_NAME} plugin install <name>[@version|tag|range]  # resolves through configured marketplaces`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/install`;
  const resp = await pluginFetch(flags, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ source }),
  });
  if (!resp.ok || !resp.body) {
    console.error(`POST /api/plugins/install failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exitCode = 0;
  const events = [];
  let finalEvent = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine  = lines.find((l) => l.startsWith('data: '));
      const event = eventLine ? eventLine.slice('event: '.length) : 'message';
      const data = dataLine ? safeParseJson(dataLine.slice('data: '.length)) : null;
      events.push({ event, data });
      if (event === 'progress') {
        if (!flags.json) console.log(`[install] ${data?.phase ?? '...'}: ${data?.message ?? ''}`);
      } else if (event === 'success') {
        finalEvent = data;
        if (!flags.json) console.log(`[install] ok — ${data?.plugin?.id}@${data?.plugin?.version} (trust=${data?.plugin?.trust})`);
        if (!flags.json && Array.isArray(data?.warnings) && data.warnings.length > 0) {
          for (const w of data.warnings) console.log(`[install] warn: ${w}`);
        }
      } else if (event === 'error') {
        finalEvent = data;
        if (!flags.json) console.error(`[install] error: ${data?.message ?? 'unknown'}`);
        exitCode = 1;
      }
    }
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({
      ok: exitCode === 0,
      result: finalEvent,
      events,
    }, null, 2) + '\n');
  }
  process.exit(exitCode);
}

// Plan §3.Z2 — `pixo plugin upgrade <id>`. Re-installs the plugin
// from its recorded source. Streams the same SSE event shape as
// install, so 'progress' / 'success' / 'error' arrive verbatim.
// Plan §3.II1 — `pixo plugin events tail`. Tails the daemon's
// in-memory plugin event ring buffer via SSE. -f keeps the
// connection open and prints live events; otherwise prints the
// backlog and exits when the daemon closes the stream.
async function runPluginEvents(rest) {
  const sub = rest[0];
  if (!sub || sub === 'help' || rest.includes('--help') || rest.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin events tail     [-f] [--since <id>] [--kind <k>] [--plugin-id <id>] [--json]
  ${PRODUCT_CLI_NAME} plugin events snapshot [--since <id>] [--kind <k>] [--plugin-id <id>] [--json]
  ${PRODUCT_CLI_NAME} plugin events stats    [--json]
  ${PRODUCT_CLI_NAME} plugin events purge    [--confirm] [--json]    (loopback-only)

Tail / snapshot / stats / purge over the daemon's in-memory
plugin event ring buffer (capped at 1000 entries; resets on
daemon restart).
Lifecycle vocabulary:
  plugin.installed | plugin.upgraded | plugin.uninstalled
  plugin.trust-changed | plugin.snapshot-pruned
  plugin.marketplace-refreshed | plugin.applied

  --since <id>       Trim backlog to events strictly after id.
  --kind <k>         Filter to a single kind.
  --plugin-id <id>   Filter to events touching one plugin id.
  -f / --follow      tail-only: keep the SSE stream open.
  --json             Emit raw JSON (one event per line on tail,
                     full report on snapshot/stats).`);
    process.exit(sub ? 0 : 2);
  }
  const flags = parseFlags(rest.slice(1), {
    string:  new Set([...PLUGIN_STRING_FLAGS, 'since', 'kind', 'plugin-id']),
    boolean: new Set([...PLUGIN_BOOLEAN_FLAGS, 'f', 'follow']),
  });
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const since = typeof flags.since === 'string' ? Number(flags.since) : 0;
  const kindFilter = typeof flags.kind === 'string' && flags.kind.length > 0 ? flags.kind : null;
  const pluginIdFilter = typeof flags['plugin-id'] === 'string' && flags['plugin-id'].length > 0
    ? flags['plugin-id']
    : null;
  const matches = (ev) => {
    if (!ev) return false;
    if (kindFilter && ev.kind !== kindFilter) return false;
    if (pluginIdFilter && ev.pluginId !== pluginIdFilter) return false;
    return true;
  };

  if (sub === 'snapshot') {
    const url = `${base}/api/plugins/events/snapshot${Number.isFinite(since) && since > 0 ? `?since=${since}` : ''}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    const events = (Array.isArray(data?.events) ? data.events : []).filter(matches);
    if (flags.json) {
      process.stdout.write(JSON.stringify({ events, count: events.length, generatedAt: data?.generatedAt }, null, 2) + '\n');
      return;
    }
    if (events.length === 0) {
      console.log('[events snapshot] no events match filter');
      return;
    }
    for (const ev of events) {
      const ts = ev.at ? new Date(ev.at).toISOString() : '?';
      const detailKeys = ev.details ? Object.keys(ev.details).slice(0, 3).join(',') : '';
      console.log(`#${ev.id}  ${ts}  ${ev.kind}  pluginId=${ev.pluginId || '-'}` +
        (detailKeys ? `  details=${detailKeys}` : ''));
    }
    return;
  }

  if (sub === 'purge') {
    // Refuse to run without an explicit --confirm so 'pixo plugin
    // events purge' alone never drops audit data accidentally.
    const purgeFlags = parseFlags(rest.slice(1), {
      string:  new Set(['daemon-url']),
      boolean: new Set(['help', 'h', 'json', 'confirm']),
    });
    if (!purgeFlags.confirm) {
      console.error('[events purge] refusing without --confirm. This drops every event in the in-memory buffer.');
      process.exit(2);
    }
    const resp = await fetch(`${base}/api/plugins/events/purge`, { method: 'POST' });
    if (!resp.ok) {
      console.error(`POST /api/plugins/events/purge failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    if (purgeFlags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else {
      console.log(`[events purge] dropped ${data.purged ?? 0} event${(data.purged ?? 0) === 1 ? '' : 's'} (id range: ${data.firstId ?? '(none)'} \u2192 ${data.lastId ?? '(none)'}; preNextId=${data.preNextId})`);
    }
    return;
  }

  if (sub === 'stats') {
    const resp = await fetch(`${base}/api/plugins/events/stats`);
    if (!resp.ok) {
      console.error(`GET /api/plugins/events/stats failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    const s = data?.stats ?? {};
    console.log('# Plugin events');
    console.log(`  total:           ${s.total ?? 0}`);
    console.log(`  by kind:         ${formatCounts(s.byKind)}`);
    console.log(`  by pluginId:     ${formatCounts(s.byPluginId)}`);
    console.log(`  oldest at:       ${formatTimestamp(s.oldestAt)}`);
    console.log(`  newest at:       ${formatTimestamp(s.newestAt)}`);
    console.log(`  id range:        ${s.firstId ?? '(none)'} \u2192 ${s.lastId ?? '(none)'}`);
    return;
  }

  if (sub !== 'tail') {
    console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} plugin events ${sub}`);
    process.exit(2);
  }
  const follow = flags.f === true || flags.follow === true;
  const url = `${base}/api/plugins/events${Number.isFinite(since) && since > 0 ? `?since=${since}` : ''}`;
  const resp = await fetch(url, { headers: { accept: 'text/event-stream' } });
  if (!resp.ok || !resp.body) {
    console.error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const renderEvent = (channel, data) => {
    if (!matches(data)) return;
    if (flags.json) {
      process.stdout.write(JSON.stringify({ channel, ...data }) + '\n');
      return;
    }
    const ts = data?.at ? new Date(data.at).toISOString() : '?';
    const id = data?.id ?? '?';
    const tag = channel === 'backlog' ? '[bk]' : '[ev]';
    const detailKeys = data?.details ? Object.keys(data.details).slice(0, 3).join(',') : '';
    console.log(`${tag} #${id}  ${ts}  ${data?.kind ?? '?'}  pluginId=${data?.pluginId ?? '-'}` +
      (detailKeys ? `  details=${detailKeys}` : ''));
  };
  // Read until the daemon closes the stream OR --follow keeps it open
  // forever. Without --follow we still let the daemon drain the
  // backlog naturally; the route emits all backlog entries first,
  // and our reader exits when the connection closes (which the
  // daemon never does on its own, so we add a small idle timer).
  if (!follow) {
    // Non-follow: drain backlog, then exit after a short idle period
    // (the route never naturally closes; the SSE backlog is a one-shot
    // stream of event entries).
    let lastChunkAt = Date.now();
    const idleMs = 200;
    const idleTimer = setInterval(() => {
      if (Date.now() - lastChunkAt > idleMs) {
        clearInterval(idleTimer);
        try { reader.cancel(); } catch { /* ignore */ }
      }
    }, 100);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lastChunkAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const lines = block.split('\n');
          const ev = lines.find((l) => l.startsWith('event: '))?.slice('event: '.length) ?? 'message';
          const dat = lines.find((l) => l.startsWith('data: '))?.slice('data: '.length);
          if (!dat) continue;
          try { renderEvent(ev, JSON.parse(dat)); } catch { /* ignore */ }
        }
      }
    } finally {
      clearInterval(idleTimer);
    }
    return;
  }
  // Follow mode: read forever.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      const ev = lines.find((l) => l.startsWith('event: '))?.slice('event: '.length) ?? 'message';
      const dat = lines.find((l) => l.startsWith('data: '))?.slice('data: '.length);
      if (!dat) continue;
      try { renderEvent(ev, JSON.parse(dat)); } catch { /* ignore */ }
    }
  }
}

// Plan §3.FF1 — `pixo plugin verify <pluginId>` CI meta-command.
//
// Reads an optional .pixo-verify.json config from the plugin folder
// or --config <path> and runs the enabled subset of:
//
//   doctor   — calls /api/plugins/<id>/doctor
//   simulate — calls /api/plugins/<id> + simulatePipeline()
//   canon    — fetches /api/applied-plugins/<snapshotId>/canon and
//              compares against the on-disk fixture
//
// Aggregates into a unified pass/fail report. Exit 4 on any failed
// check; useful as a one-liner CI check for a plugin's repo.
async function runPluginVerify(rest) {
  const flags = parseFlags(rest, {
    string:  new Set([...PLUGIN_STRING_FLAGS, 'config']),
    boolean: PLUGIN_BOOLEAN_FLAGS,
  });
  const positional = rest.filter((a) => !a.startsWith('-'));
  const id = positional[0];
  if (flags.help || flags.h || !id) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin verify <pluginId> [--config <path>] [--json]

CI meta-command. Reads an optional config from
'<plugin-folder>/.pixo-verify.json' (or --config <path>) and runs:

  doctor    — manifest + atom + ref lint
  simulate  — convergence dry-run for every until expression,
              with per-stage signals from config.simulate.signals
  canon     — byte-equality check against
              config.canon.fixturePath using the snapshot at
              config.canon.snapshotId

Sample .pixo-verify.json:

  {
    "enabled": ["doctor", "simulate"],
    "simulate": {
      "signals": { "critique.score": 5, "build.passing": true },
      "iterationCap": 5
    },
    "canon": {
      "snapshotId": "snap-abc",
      "fixturePath": "tests/expected-block.md"
    }
  }

Exit codes:
  0  every enabled check passed
  4  one or more enabled checks failed
  2  CLI usage error / plugin not found / config malformed`);
    process.exit(id ? 0 : 2);
  }
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');

  // 1. Resolve the plugin record (fsPath + manifest).
  const pluginResp = await pluginFetch(flags, `${base}/api/plugins/${encodeURIComponent(id)}`);
  if (pluginResp.status === 404) {
    console.error(`plugin ${id} not found`);
    process.exit(65);
  }
  if (!pluginResp.ok) {
    console.error(`GET /api/plugins/${id} failed: ${pluginResp.status} ${await pluginResp.text()}`);
    process.exit(1);
  }
  const plugin = await pluginResp.json();

  // 2. Load .pixo-verify.json from --config or <fsPath>/.pixo-verify.json.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const configPath = typeof flags.config === 'string'
    ? path.resolve(flags.config)
    : (typeof plugin?.fsPath === 'string' ? path.join(plugin.fsPath, '.pixo-verify.json') : null);
  let config = { enabled: ['doctor', 'simulate', 'canon'] };
  if (configPath) {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(raw);
    } catch (err) {
      const e = err;
      if (e?.code !== 'ENOENT') {
        console.error(`[verify] cannot read config ${configPath}: ${e?.message ?? e}`);
        process.exit(2);
      }
      // ENOENT → run with defaults. canon will skip cleanly because no
      // config.canon entry was supplied.
    }
  }

  // 3. doctor (when enabled)
  const enabledSet = new Set((config.enabled ?? ['doctor', 'simulate', 'canon']).filter((c) =>
    c === 'doctor' || c === 'simulate' || c === 'canon'));
  let doctorReport = null;
  if (enabledSet.has('doctor')) {
    const doctorResp = await pluginFetch(flags, `${base}/api/plugins/${encodeURIComponent(id)}/doctor`);
    if (doctorResp.ok) {
      doctorReport = await doctorResp.json();
    }
  }

  // 4. simulate (when enabled)
  let simulateReport = null;
  if (enabledSet.has('simulate')) {
    const pipeline = plugin?.manifest?.pixo?.pipeline;
    if (pipeline && Array.isArray(pipeline.stages) && pipeline.stages.length > 0) {
      const { simulatePipeline } = await import('./plugins/simulate.js');
      simulateReport = simulatePipeline({
        pipeline,
        signals: config.simulate?.signals ?? {},
        ...(typeof config.simulate?.iterationCap === 'number' && config.simulate.iterationCap > 0
          ? { iterationCap: config.simulate.iterationCap }
          : {}),
      });
    }
  }

  // 5. canon (when enabled + fixture supplied)
  let canonActual = null;
  let canonExpected = null;
  if (enabledSet.has('canon') && config.canon?.snapshotId && config.canon?.fixturePath) {
    const fixturePath = path.resolve(
      typeof flags.config === 'string'
        ? path.dirname(path.resolve(flags.config))
        : (typeof plugin?.fsPath === 'string' ? plugin.fsPath : process.cwd()),
      config.canon.fixturePath,
    );
    try {
      canonExpected = await fs.readFile(fixturePath, 'utf8');
    } catch {
      canonExpected = null;
    }
    if (canonExpected !== null) {
      const canonResp = await pluginFetch(
        flags,
        `${base}/api/applied-plugins/${encodeURIComponent(config.canon.snapshotId)}/canon`,
        { headers: { accept: 'text/plain' } },
      );
      if (canonResp.ok) {
        canonActual = await canonResp.text();
      }
    }
  }

  // 6. Aggregate.
  const { verifyPlugin } = await import('./plugins/verify.js');
  const report = verifyPlugin({
    config: {
      enabled: [...enabledSet],
      ...(config.strict   === true     ? { strict:   true }      : {}),
      ...(config.simulate              ? { simulate: config.simulate } : {}),
      ...(config.canon                 ? { canon:    config.canon    } : {}),
    },
    ...(doctorReport   ? { doctor:        doctorReport } : {}),
    ...(simulateReport ? { simulate:      simulateReport } : {}),
    ...(canonActual    ? { canon:         canonActual } : {}),
    ...(canonExpected  ? { canonExpected: canonExpected } : {}),
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify({ pluginId: id, ...report }, null, 2) + '\n');
  } else {
    console.log(`[verify] plugin ${id} \u2014 ${report.passed ? 'PASSED' : 'FAILED'}`);
    for (const o of report.outcomes) {
      const tag = o.status === 'passed' ? '\u2713'
                : o.status === 'failed' ? '\u2717'
                : o.status === 'skipped' ? '-'
                : '!';
      console.log(`  ${tag} ${o.summary}`);
    }
  }
  process.exit(report.passed ? 0 : 4);
}

// Plan §3.EE1 — `pixo plugin simulate <pluginId> [-s key=value ...]`.
//
// Walks the plugin's pipeline against caller-supplied signals and
// reports per-stage convergence (iterations + outcome). No LLM is
// invoked — this is a pure devloop dry-run for testing 'until'
// expressions.
//
// Signals are supplied via repeatable -s key=value flags. The
// closed UntilSignals vocabulary applies (critique.score /
// iterations / user.confirmed / preview.ok / build.passing /
// tests.passing); unknown keys surface as warnings.
async function runPluginSimulate(rest) {
  const flags = parseFlags(rest, {
    string:  new Set([...PLUGIN_STRING_FLAGS, 's', 'cap']),
    boolean: PLUGIN_BOOLEAN_FLAGS,
  });
  const positional = rest.filter((a) => !a.startsWith('-'));
  const id = positional[0];
  if (flags.help || flags.h || !id) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin simulate <pluginId> [-s key=value ...] [--cap <n>] [--json]

Walks the plugin's pipeline against caller-supplied signals and
reports per-stage convergence. No LLM is invoked.

Examples:
  # critique-theater stage that exits when score >= 4
  ${PRODUCT_CLI_NAME} plugin simulate my-plugin -s critique.score=5

  # build-test devloop where both signals must hold
  ${PRODUCT_CLI_NAME} plugin simulate code-migration \\
      -s build.passing=true -s tests.passing=true

  # raise the per-stage iteration cap (default 10)
  ${PRODUCT_CLI_NAME} plugin simulate my-plugin -s critique.score=2 --cap 20

Closed signal vocabulary:
  critique.score (number)
  iterations     (number)
  user.confirmed (boolean)
  preview.ok     (boolean)
  build.passing  (boolean)
  tests.passing  (boolean)`);
    process.exit(id ? 0 : 2);
  }
  // Collect every -s value (parseFlags returns the last only).
  const sValues = [];
  for (let i = 0; i < rest.length; i++) {
    if ((rest[i] === '-s' || rest[i] === '--signal') && typeof rest[i + 1] === 'string') {
      sValues.push(rest[i + 1]);
    }
  }
  // Fetch the plugin from the daemon so we get the resolved
  // manifest (including pipeline).
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const resp = await pluginFetch(flags, `${base}/api/plugins/${encodeURIComponent(id)}`);
  if (resp.status === 404) {
    console.error(`plugin ${id} not found`);
    process.exit(65);
  }
  if (!resp.ok) {
    console.error(`GET /api/plugins/${id} failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const plugin = await resp.json();
  const pipeline = plugin?.manifest?.pixo?.pipeline;
  if (!pipeline || !Array.isArray(pipeline.stages) || pipeline.stages.length === 0) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({ outcome: 'no-pipeline', stages: [] }, null, 2) + '\n');
    } else {
      console.log(`[simulate] plugin ${id} has no pixo.pipeline (or it is empty); nothing to walk.`);
    }
    return;
  }
  const { simulatePipeline, parseSignalKv } = await import('./plugins/simulate.js');
  const parsedSignals = parseSignalKv(sValues);
  for (const w of parsedSignals.warnings) console.warn(`[simulate] warn: ${w}`);
  const cap = typeof flags.cap === 'string' ? Number(flags.cap) : undefined;
  const result = simulatePipeline({
    pipeline,
    signals: parsedSignals.signals,
    ...(Number.isFinite(cap) && cap > 0 ? { iterationCap: cap } : {}),
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  console.log(`[simulate] plugin ${id} \u2014 outcome: ${result.outcome}, totalIterations: ${result.totalIterations}`);
  for (const stage of result.stages) {
    const tag = stage.outcome === 'converged' ? '\u2713'
              : stage.outcome === 'cap'         ? '\u2717'
              : stage.outcome === 'unparsable'  ? '!'
              :                                   '\u2014';
    const reason = stage.reason ? `  (${stage.reason})` : '';
    const matched = stage.matched && stage.matched.length > 0
      ? `  matched=[${stage.matched.map((c) => `${c.signal}${c.op}${c.value}`).join(' && ')}]`
      : '';
    console.log(`  ${tag} ${stage.stageId}: ${stage.outcome} (${stage.iterations} iter)${reason}${matched}`);
  }
  // Exit non-zero on cap-hit / unparsable so CI can wire this
  // into a pipeline check easily.
  if (result.outcome === 'cap-hit' || result.outcome === 'unparsable') process.exit(4);
}

// Plan §3.CC1 / §3.DD2 — `pixo plugin canon <snapshotId>`. Prints the
// canonical `## Active plugin` block a snapshot will splice into
// the system prompt. Useful for understanding what the agent
// reads + locking byte-equality regression tests against the
// daemon's renderPluginBlock() output.
//
// --check <file> mode: compares the canon output against an
// on-disk fixture (typically committed under tests/fixtures/) and
// exits 4 on byte-mismatch. Lets a plugin author lock byte-
// equality without writing a new test harness.
async function runPluginCanon(rest) {
  const flags = parseFlags(rest, {
    string:  new Set([...PLUGIN_STRING_FLAGS, 'check']),
    boolean: PLUGIN_BOOLEAN_FLAGS,
  });
  const positional = rest.filter((a) => !a.startsWith('-'));
  const id = positional[0];
  if (flags.help || flags.h || !id) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin canon <snapshotId> [--json]
  ${PRODUCT_CLI_NAME} plugin canon <snapshotId> --check <expected-file>

Prints the canonical '## Active plugin' / '## Plugin inputs' /
'## Plugin atoms' block this snapshot would splice into the
system prompt. Default output is plain text; --json wraps the
block in { snapshotId, pluginId, block }.

--check <file> compares the canon output to the file's bytes and
exits 4 on mismatch. Useful for committing renderPluginBlock()
fixtures into a plugin's own tests/.`);
    process.exit(id ? 0 : 2);
  }
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const url = `${base}/api/applied-plugins/${encodeURIComponent(id)}/canon`;
  const checkPath = typeof flags.check === 'string' ? flags.check : null;
  // --check always wants the raw text output; force text/plain.
  const wantsText = !flags.json || checkPath !== null;
  const headers = { accept: wantsText ? 'text/plain' : 'application/json' };
  const resp = await pluginFetch(flags, url, { headers });
  if (resp.status === 404) {
    console.error(`snapshot ${id} not found`);
    process.exit(72);
  }
  if (!resp.ok) {
    console.error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  if (checkPath) {
    const fs = await import('node:fs/promises');
    let expected;
    try {
      expected = await fs.readFile(checkPath, 'utf8');
    } catch (err) {
      console.error(`[canon --check] cannot read ${checkPath}: ${err?.message ?? err}`);
      process.exit(2);
    }
    const actual = await resp.text();
    if (actual === expected) {
      console.log(`[canon] \u2713 byte-equal to ${checkPath}`);
      return;
    }
    // Surface a small unified-diff preview so the author sees what
    // drifted. Full diff is left to the user's preferred tool.
    console.error(`[canon --check] \u2717 mismatch with ${checkPath}`);
    console.error(`  expected length: ${expected.length} bytes`);
    console.error(`  actual length:   ${actual.length} bytes`);
    const expectedLines = expected.split('\n');
    const actualLines   = actual.split('\n');
    const limit = Math.min(Math.max(expectedLines.length, actualLines.length), 40);
    for (let i = 0; i < limit; i++) {
      if (expectedLines[i] !== actualLines[i]) {
        console.error(`  line ${i + 1}:`);
        if (expectedLines[i] !== undefined) console.error(`    - ${expectedLines[i]}`);
        if (actualLines[i]   !== undefined) console.error(`    + ${actualLines[i]}`);
      }
    }
    process.exit(4);
  }
  if (flags.json) {
    const data = await resp.json();
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  const body = await resp.text();
  process.stdout.write(body);
  if (!body.endsWith('\n')) process.stdout.write('\n');
}

// Plan §3.AA1 — `pixo plugin diff <a> <b>`. Compares two installed
// plugins (by id) and prints a structured report. Useful for
// debugging replay invariance + reviewing version bumps.
async function runPluginDiff(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const positional = rest.filter((a) => !a.startsWith('-'));
  if (flags.help || flags.h || positional.length < 2) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin diff <id-a> <id-b> [--json]

Compares two installed plugins (or two installs of the same id at
different versions) and prints every changed field. Output groups
into 'added' / 'removed' / 'changed' with one line per field.`);
    process.exit(positional.length < 2 ? 2 : 0);
  }
  const [idA, idB] = positional;
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const [respA, respB] = await Promise.all([
    pluginFetch(flags, `${base}/api/plugins/${encodeURIComponent(idA)}`),
    pluginFetch(flags, `${base}/api/plugins/${encodeURIComponent(idB)}`),
  ]);
  if (!respA.ok) {
    console.error(`GET /api/plugins/${idA} failed: ${respA.status}`);
    process.exit(1);
  }
  if (!respB.ok) {
    console.error(`GET /api/plugins/${idB} failed: ${respB.status}`);
    process.exit(1);
  }
  const a = await respA.json();
  const b = await respB.json();
  const { diffPlugins } = await import('./plugins/diff.js');
  const report = diffPlugins({ a, b });
  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  if (report.entries.length === 0) {
    console.log(`[diff] ${idA} and ${idB} are equivalent on every recorded field.`);
    return;
  }
  console.log(`[diff] ${idA} \u2194 ${idB} — ${report.added} added, ${report.removed} removed, ${report.changed} changed`);
  for (const e of report.entries) {
    const tag = e.kind === 'added'   ? '+'
              : e.kind === 'removed' ? '-'
              : '~';
    if (e.summary) {
      console.log(`  ${tag} ${e.field}  (${e.summary})`);
    } else if (e.kind === 'changed') {
      console.log(`  ${tag} ${e.field}: ${e.before ?? ''} \u2192 ${e.after ?? ''}`);
    } else if (e.kind === 'added') {
      console.log(`  ${tag} ${e.field}: ${e.after ?? ''}`);
    } else {
      console.log(`  ${tag} ${e.field}: ${e.before ?? ''}`);
    }
  }
}

async function runPluginUpgrade(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('-') && a !== flags['daemon-url'] && a !== flags.source);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin upgrade <id> [--policy latest|pinned] [--json]`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}/upgrade`;
  const resp = await pluginFetch(flags, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      policy: flags.policy === 'pinned' ? 'pinned' : 'latest',
    }),
  });
  if (!resp.ok || !resp.body) {
    let msg = '';
    try { msg = await resp.text(); } catch { msg = ''; }
    console.error(`POST /api/plugins/${id}/upgrade failed: ${resp.status} ${msg}`);
    process.exit(1);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exitCode = 0;
  const events = [];
  let finalEvent = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine  = lines.find((l) => l.startsWith('data: '));
      const event = eventLine ? eventLine.slice('event: '.length) : 'message';
      const data = dataLine ? safeParseJson(dataLine.slice('data: '.length)) : null;
      events.push({ event, data });
      if (event === 'progress') {
        if (!flags.json) console.log(`[upgrade] ${data?.phase ?? '...'}: ${data?.message ?? ''}`);
      } else if (event === 'success') {
        finalEvent = data;
        if (!flags.json) console.log(`[upgrade] ok — ${data?.plugin?.id}@${data?.plugin?.version} (trust=${data?.plugin?.trust})`);
        if (!flags.json && Array.isArray(data?.warnings) && data.warnings.length > 0) {
          for (const w of data.warnings) console.log(`[upgrade] warn: ${w}`);
        }
      } else if (event === 'error') {
        finalEvent = data;
        if (!flags.json) console.error(`[upgrade] error: ${data?.message ?? 'unknown'}`);
        exitCode = 1;
      }
    }
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({
      ok: exitCode === 0,
      policy: flags.policy === 'pinned' ? 'pinned' : 'latest',
      result: finalEvent,
      events,
    }, null, 2) + '\n');
  }
  process.exit(exitCode);
}

async function runPluginUninstall(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('-') && a !== flags['daemon-url'] && a !== flags.source);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin uninstall <id>`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}/uninstall`;
  const resp = await pluginFetch(flags, url, { method: 'POST' });
  if (!resp.ok) {
    console.error(`POST /api/plugins/${id}/uninstall failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  console.log(`[uninstall] ${data?.removedFolder ? 'ok' : 'no-op'}${data?.warning ? ` (warning: ${data.warning})` : ''}`);
}

async function runPluginApply(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('-')
    && a !== flags['daemon-url']
    && a !== flags.source
    && a !== flags.inputs
    && a !== flags.project
    && a !== flags['grant-caps']);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin apply <id> [--inputs <json>] [--input k=v ...] [--project <id>] [--grant-caps a,b]`);
    process.exit(2);
  }
  // Plan §3.B2: support both --inputs <json> and repeated --input k=v
  // forms so a code agent can build the inputs map without a JSON
  // shell-escape dance.
  let inputs = {};
  if (typeof flags.inputs === 'string' && flags.inputs.trim().length > 0) {
    try { inputs = JSON.parse(flags.inputs); } catch (err) {
      console.error(`--inputs must be valid JSON: ${err.message}`);
      process.exit(2);
    }
  }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--input' && typeof rest[i + 1] === 'string') {
      const kv = rest[i + 1];
      const eq = kv.indexOf('=');
      if (eq > 0) {
        const k = kv.slice(0, eq);
        const v = kv.slice(eq + 1);
        inputs[k] = coerceCliValue(v);
      }
      i += 1;
    }
  }
  const grantCaps = typeof flags['grant-caps'] === 'string' && flags['grant-caps'].length > 0
    ? flags['grant-caps'].split(',').map((c) => c.trim()).filter(Boolean)
    : [];
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}/apply`;
  let resp;
  try {
    resp = await pluginFetch(flags, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs, projectId: flags.project, grantCaps }),
    });
  } catch (err) {
    return exitWithStructuredError({
      code: 'daemon-not-running',
      message: `Cannot reach daemon at ${await pluginDaemonUrl(flags)}: ${err?.message ?? err}`,
    });
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 422 && Array.isArray(data?.fields)) {
      return exitWithStructuredError({
        code: 'missing-input',
        message: `Plugin "${id}" is missing required inputs: ${data.fields.join(', ')}`,
        data: { pluginId: id, missing: data.fields },
      });
    }
    return structuredHttpFailure(resp);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  const snap = data?.appliedPlugin;
  if (snap) {
    console.log(`[apply] ${snap.pluginId}@${snap.pluginVersion} digest=${snap.manifestSourceDigest.slice(0, 12)}…`);
    console.log(`[apply] context: ${(data.contextItems ?? []).map((c) => `${c.kind}:${c.id ?? c.name ?? c.path}`).join(', ')}`);
    if (Array.isArray(data.warnings) && data.warnings.length > 0) {
      for (const w of data.warnings) console.log(`[apply] warn: ${w}`);
    }
  } else {
    console.log(JSON.stringify(data));
  }
}

async function runPluginDuplicate(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('-')
    && a !== flags['daemon-url']
    && a !== flags.name);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin duplicate <id> [--name "<project name>"] [--json]`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}/duplicate-project`;
  const body = typeof flags.name === 'string' && flags.name.trim().length > 0
    ? { name: flags.name.trim() }
    : {};
  let resp;
  try {
    resp = await pluginFetch(flags, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return exitWithStructuredError({
      code: 'daemon-not-running',
      message: `Cannot reach daemon at ${await pluginDaemonUrl(flags)}: ${err?.message ?? err}`,
    });
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const data = await resp.json().catch(() => ({}));
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  console.log(`[duplicate] created project ${data.projectId} from ${data.sourcePluginId} -> ${data.relPath}`);
  if (Array.isArray(data.warnings) && data.warnings.length > 0) {
    for (const warning of data.warnings) console.log(`[duplicate] warn: ${warning}`);
  }
}

function coerceCliValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

async function runPluginCandidates(rest) {
  const sub = rest[0];
  const args = rest.slice(1);
  const candidateStringFlags = new Set([
    'daemon-url',
    'project',
    'action',


  ]);
  const flags = parseFlags(args, {
    string: candidateStringFlags,
    boolean: new Set(['help', 'h', 'json', 'include-dismissed']),
  });
  if (!sub || sub === 'help' || flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin candidates list --project <projectId> [--json] [--include-dismissed]
  ${PRODUCT_CLI_NAME} plugin candidates draft <candidateId> --project <projectId> [--json]
  ${PRODUCT_CLI_NAME} plugin candidates dismiss <candidateId> --project <projectId> [--json]

Lists and formalizes persisted skill-to-plugin candidates.`);
    process.exit(!sub ? 2 : 0);
  }
  const projectId = typeof flags.project === 'string' && flags.project.length > 0 ? flags.project : '';
  if (!projectId) {
    console.error('--project <projectId> is required');
    process.exit(2);
  }
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  if (sub === 'list') {
    const qs = flags['include-dismissed'] ? '?includeDismissed=true' : '';
    const resp = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/plugin-candidates${qs}`,
      { headers: requestHeaders },
    );
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error(`GET plugin candidates failed: ${resp.status} ${JSON.stringify(data)}`);
      process.exit(1);
    }
    if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    if (candidates.length === 0) {
      console.log('No plugin candidates.');
      return;
    }
    for (const candidate of candidates) {
      console.log(`${candidate.id}\t${candidate.status}\t${candidate.title}\t${candidate.draftPath ?? ''}`);
    }
    return;
  }
  const candidateId = positionalArgs(args, candidateStringFlags)[0];
  if (!candidateId) {
    console.error(`candidate id is required for ${sub}`);
    process.exit(2);
  }
  if (sub === 'draft') {
    const resp = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/plugin-candidates/${encodeURIComponent(candidateId)}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...requestHeaders },
      body: '{}',
    });
    const data = await resp.json().catch(() => null);
    if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else if (resp.ok) {
      console.log(`[candidate] draft: ${data.draftPath}`);
      console.log(`[candidate] validation ok=${data.validation?.ok}`);
    } else {
      console.error(`[candidate] draft failed: ${data?.message ?? JSON.stringify(data)}`);
    }
    process.exit(resp.ok ? 0 : resp.status === 422 ? 4 : 1);
  }
  if (sub === 'dismiss') {
    const resp = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/plugin-candidates/${encodeURIComponent(candidateId)}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...requestHeaders },
      body: '{}',
    });
    const data = await resp.json().catch(() => null);
    if (flags.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    else if (resp.ok) console.log(`[candidate] dismissed ${candidateId}`);
    else console.error(`[candidate] dismiss failed: ${data?.message ?? JSON.stringify(data)}`);
    process.exit(resp.ok ? 0 : 1);
  }
  console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} plugin candidates ${sub}`);
  process.exit(2);
}

// Phase 4 / spec §14.1 — `pixo plugin publish --to <catalog>`.
//
// Reads the installed plugin's manifest metadata (or the snapshot's
// frozen view via --snapshot-id) and prints the catalog submission URL
// + PR body. With `--open` the CLI auto-launches the system browser
// against the URL so the author lands on the catalog's submission form
// in one step. We never POST anywhere — the upstream review flow is
// always under the author's control.
async function runPluginPublish(rest) {
  const flags = parseFlags(rest, {
    string: new Set([
      'daemon-url',
      'to',
      'snapshot-id',
      'repo',
      'catalog',


    ]),
    boolean: new Set(['help', 'h', 'json', 'open']),
  });
  if (rest.length === 0 || flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin publish <pluginId> --to anthropics-skills|awesome-agent-skills|clawhub|skills-sh
                    [--repo <github-url>] [--snapshot-id <id>] [--open] [--json]
  ${PRODUCT_CLI_NAME} plugin publish <pluginId> --to marketplace-json --catalog ./openpixo-marketplace.json --repo <github-url>

The CLI prints the catalog's submission URL + a pre-filled PR body.
Pass --open to auto-launch the system browser. Use --snapshot-id to
publish from a frozen run snapshot rather than the live installed copy.`);
    process.exit(rest.length === 0 ? 2 : 0);
  }
  const id = rest.find((a) => !a.startsWith('-')
    && a !== flags.to
    && a !== flags.repo
    && a !== flags['snapshot-id']);
  const target = String(flags.to ?? '');
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin publish <pluginId> --to <catalog>`);
    process.exit(2);
  }
  if (!target) {
    console.error('--to <catalog> is required (one of: anthropics-skills, awesome-agent-skills, clawhub, skills-sh)');
    process.exit(2);
  }
  const base = (await pluginDaemonUrl(flags)).replace(/\/$/, '');
  // Pull the plugin metadata from the daemon. We do this through the
  // existing /api/plugins/:id endpoint so the CLI never needs a direct
  // SQLite handle; everything stays loopback-mediated.
  let meta = { pluginId: id, pluginVersion: '0.0.0' };
  try {
    const resp = await pluginFetch(flags, `${base}/api/plugins/${encodeURIComponent(id)}`);
    if (resp.ok) {
      const row = await resp.json();
      // The daemon's plugin row carries a stored `version` plus the full
      // manifest. For project-local plugins (`generated-plugin/`, snapshots,
      // freshly imported folders) the stored `version` is `'0.0.0'` until
      // the registry handshake runs, but the manifest's `version` is the
      // real value the author wrote. Mirror `plugins/marketplaces.ts:298,328`
      // and prefer the manifest version when the stored row reads as the
      // pre-handshake sentinel. Closes #1765.
      const storedVersion = typeof row.version === 'string' && row.version.length > 0
        ? row.version
        : null;
      const manifestVersion = typeof row.manifest?.version === 'string' && row.manifest.version.length > 0
        ? row.manifest.version
        : null;
      const resolvedVersion = (storedVersion && storedVersion !== '0.0.0')
        ? storedVersion
        : (manifestVersion ?? storedVersion ?? '0.0.0');
      meta = {
        pluginId:          row.id ?? id,
        pluginVersion:     resolvedVersion,
        ...(row.title              ? { pluginTitle: row.title }                       : {}),
        ...(row.manifest?.description ? { pluginDescription: row.manifest.description } : {}),
      };
    }
  } catch {
    // Best-effort; if the daemon isn't reachable we still try to build
    // a link from the user's flags so the author doesn't need a daemon
    // to publish.
  }
  if (typeof flags.repo === 'string' && flags.repo.length > 0) {
    meta.repoUrl = flags.repo;
  }
  if (target === 'marketplace-json') {
    if (typeof flags.catalog !== 'string' || flags.catalog.length === 0) {
      console.error('--catalog <path> is required for --to marketplace-json');
      process.exit(2);
    }
    if (!meta.repoUrl) {
      console.error('--repo <github-url> is required for --to marketplace-json so the source can be reproduced');
      process.exit(2);
    }
    const outcome = await publishToMarketplaceJson({
      catalogPath: flags.catalog,
      meta,
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify(outcome, null, 2) + '\n');
    } else {
      console.log(`[publish] updated ${outcome.catalogPath}`);
      console.log(`[publish] ${outcome.entry.name}@${outcome.entry.version} -> ${outcome.entry.source}`);
    }
    return;
  }
  const { buildPublishLink, PublishError } = await import('./plugins/publish.js');
  let link;
  try {
    link = buildPublishLink({ catalog: target, meta });
  } catch (err) {
    if (err instanceof PublishError) {
      console.error(`[publish] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(link, null, 2) + '\n');
  } else {
    console.log(`[publish] ${link.catalogLabel}`);
    console.log(link.url);
    console.log('---');
    console.log(link.prBody);
  }
  if (flags.open) {
    const opener = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    const { spawn } = await import('node:child_process');
    spawn(opener, [link.url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function runPluginPublishRepo(rest) {
  const flags = parseFlags(rest, {
    string: new Set(['host', 'owner']),
    boolean: new Set(['help', 'h', 'json', 'dry-run']),
  });
  if (rest.length === 0 || flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin publish-repo <folder> [--host github.com] [--owner github-login-or-org] [--dry-run] [--json]

Creates or updates the public GitHub repository named by the plugin manifest.
If plugin.repo is missing or uses a placeholder owner, the CLI resolves the
target from --owner, a trusted manifest owner, local gh auth status, then the
GitHub API as a last resort. It never publishes to placeholder owners.`);
    process.exit(rest.length === 0 ? 2 : 0);
  }
  const folder = rest.find((a) => !a.startsWith('-') && a !== flags.host && a !== flags.owner);
  if (!folder) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin publish-repo <folder>`);
    process.exit(2);
  }

  const [{ resolve, join }, { readFile, writeFile, stat, mkdtemp, readdir, rm, mkdir, cp }, { pathToFileURL }, os] = await Promise.all([
    import('node:path'),
    import('node:fs/promises'),
    import('node:url'),
    import('node:os'),
  ]);
  const absFolder = resolve(process.cwd(), folder);
  const manifestPath = resolve(absFolder, 'pixo.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const host = typeof flags.host === 'string' ? flags.host : 'github.com';
  const target = await resolvePluginGithubTarget({ host, owner: flags.owner, manifest, purpose: 'publish-repo' });
  const normalized = normalizeManifestRepoForOwner(manifest, target.owner);
  if (normalized.changed && !flags['dry-run']) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await pluginCliValidateFolder(absFolder);
  }

  const repo = parseGithubRepoUrl(normalized.repoUrl);
  if (!repo) {
    console.error(`[publish-repo] invalid plugin.repo after normalization: ${normalized.repoUrl}`);
    process.exit(2);
  }
  const steps = [];
  const run = async (label, command, args, opts = {}) => {
    steps.push({ label, command: [command, ...args].join(' ') });
    if (flags['dry-run']) return { ok: true, stdout: '', stderr: '' };
    const result = await (command === 'gh'
      ? execGhBuffered(args, { cwd: opts.cwd ?? absFolder, timeout: opts.timeout ?? 120_000 })
      : execFileBuffered(command, args, { cwd: opts.cwd ?? absFolder, timeout: opts.timeout ?? 120_000 }));
    steps[steps.length - 1].ok = result.ok;
    steps[steps.length - 1].stdout = result.stdout;
    steps[steps.length - 1].stderr = result.stderr;
    if (!result.ok) {
      emitPluginWorkflowResult(flags, {
        ok: false,
        action: 'publish-repo',
        folder: absFolder,
        repoUrl: normalized.repoUrl,
        login: target.login,
        owner: target.owner,
        ownerSource: target.ownerSource,
        apiRateLimited: target.apiRateLimited,
        steps,
        error: { label, stdout: result.stdout, stderr: result.stderr, code: result.code },
      });
      process.exit(1);
    }
    return result;
  };

  let exists = false;
  const view = flags['dry-run']
    ? { ok: false, stderr: 'dry-run' }
    : await execGhBuffered(['repo', 'view', repo.fullName], { cwd: absFolder, timeout: 30_000 });
  steps.push({ label: 'check repo', command: `gh repo view ${repo.fullName}`, ok: view.ok, stdout: view.stdout, stderr: view.stderr });
  if (view.ok) {
    exists = true;
  } else if (!flags['dry-run'] && !isRepoNotFound(view)) {
    emitPluginWorkflowResult(flags, {
      ok: false,
      action: 'publish-repo',
      folder: absFolder,
      repoUrl: normalized.repoUrl,
      login: target.login,
      owner: target.owner,
      ownerSource: target.ownerSource,
      apiRateLimited: target.apiRateLimited,
      steps,
      error: { label: 'check repo', stdout: view.stdout, stderr: view.stderr, code: view.code },
    });
    process.exit(1);
  }

  let workdir = absFolder;
  let cleanupDir = null;
  if (exists && !flags['dry-run']) {
    cleanupDir = await mkdtemp(join(os.tmpdir(), 'pixo-plugin-publish-sync-'));
    workdir = join(cleanupDir, repo.name);
    await run('clone repo', 'gh', ['repo', 'clone', repo.fullName, workdir], { cwd: cleanupDir, timeout: 240_000 });
    for (const entry of await readdir(workdir)) {
      if (entry === '.git') continue;
      await rm(join(workdir, entry), { recursive: true, force: true });
    }
    await mkdir(workdir, { recursive: true });
    for (const entry of await readdir(absFolder)) {
      if (entry === '.git') continue;
      await cp(join(absFolder, entry), join(workdir, entry), { recursive: true, force: true });
    }
  } else if (!flags['dry-run']) {
    let hasGit = false;
    try { await stat(resolve(absFolder, '.git')); hasGit = true; } catch {}
    if (!hasGit) await run('git init', 'git', ['init']);
  }

  await run('git add', 'git', ['add', '-A'], { cwd: workdir });
  const status = flags['dry-run']
    ? { stdout: 'dry-run' }
    : await execFileBuffered('git', ['status', '--porcelain'], { cwd: workdir });
  if (status.stdout.trim().length > 0 || !exists) {
    const commitMessage = exists
      ? `Update: ${manifest.name} v${manifest.version ?? '0.0.0'}`
      : `Initial commit: ${manifest.name} v${manifest.version ?? '0.0.0'}`;
    await run('git commit', 'git', ['commit', '-m', commitMessage], { cwd: workdir });
  }
  const tag = `v${manifest.version ?? '0.0.0'}`;
  if (!flags['dry-run']) {
    const localTag = await execFileBuffered('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: workdir });
    if (!localTag.ok) await run('git tag', 'git', ['tag', tag], { cwd: workdir });
  }

  if (exists) {
    await run('git push', 'git', ['push', 'origin', 'HEAD'], { cwd: workdir });
  } else {
    await run('gh repo create', 'gh', [
      'repo', 'create', repo.fullName, '--public', '--source', '.', '--push',
      '--description', String(manifest.description ?? ''),
    ], { cwd: workdir });
  }
  await run('git push tags', 'git', ['push', '--tags'], { cwd: workdir });
  const verify = flags['dry-run']
    ? { ok: true, stdout: JSON.stringify({ nameWithOwner: repo.fullName, url: normalized.repoUrl }) }
    : await run('verify repo', 'gh', ['repo', 'view', repo.fullName, '--json', 'url,nameWithOwner'], { cwd: workdir });
  const parsedVerify = safeJson(verify.stdout);
  if (cleanupDir && !flags['dry-run']) {
    await rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined);
  }
  emitPluginWorkflowResult(flags, {
    ok: true,
    action: 'publish-repo',
    folder: absFolder,
    login: target.login,
    owner: target.owner,
    ownerSource: target.ownerSource,
    apiRateLimited: target.apiRateLimited,
    repoUrl: parsedVerify?.url ?? normalized.repoUrl,
    manifestRewritten: normalized.changed,
    manifestPath: pathToFileURL(manifestPath).pathname,
    steps,
  });
}

async function publishToMarketplaceJson({ catalogPath, meta }) {
  const [{ dirname, resolve }, { mkdir, readFile, writeFile }, { PublishError, upsertMarketplaceJsonEntry }] = await Promise.all([
    import('node:path'),
    import('node:fs/promises'),
    import('./plugins/publish.js'),
  ]);
  const resolvedPath = resolve(process.cwd(), catalogPath);
  let existing = null;
  try {
    existing = JSON.parse(await readFile(resolvedPath, 'utf8'));
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }
  let outcome;
  try {
    outcome = upsertMarketplaceJsonEntry({ manifest: existing, meta });
  } catch (err) {
    if (err instanceof PublishError) {
      console.error(`[publish] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(outcome.manifest, null, 2)}\n`, 'utf8');
  return {
    catalogPath: resolvedPath,
    inserted: outcome.inserted,
    entry: outcome.entry,
    manifest: {
      name: outcome.manifest.name,
      version: outcome.manifest.version,
      plugins: outcome.manifest.plugins.length,
    },
  };
}

async function resolvePluginGithubTarget({ host = 'github.com', owner, manifest, purpose }) {
  const version = await execGhBuffered(['--version'], { timeout: 10_000 });
  if (!version.ok) {
    console.error('[plugin github] GitHub CLI is required. Install gh from https://cli.github.com/ and retry.');
    process.exit(1);
  }
  let status = await execGhBuffered(['auth', 'status', '--hostname', host, '--active'], { timeout: 10_000 });
  if (!status.ok && /unknown flag: --active/i.test(`${status.stdout}\n${status.stderr}`)) {
    status = await execGhBuffered(['auth', 'status', '--hostname', host], { timeout: 10_000 });
  }
  if (!status.ok) {
    console.error(`[plugin github] gh is not authenticated for ${host}.`);
    if (status.stderr || status.stdout) console.error(status.stderr || status.stdout);
    console.error('Run: gh auth login -h github.com -s repo,workflow');
    process.exit(1);
  }
  const manifestRepo = parseGithubRepoUrl(typeof manifest?.plugin?.repo === 'string' ? manifest.plugin.repo.trim() : '');
  const trustedManifestOwner = purpose === 'publish-repo' && manifestRepo && !isPlaceholderRepoOwner(manifestRepo.owner) ? manifestRepo.owner : '';
  const explicitOwner = typeof owner === 'string' ? owner.trim() : '';
  if (explicitOwner && isPlaceholderRepoOwner(explicitOwner)) {
    console.error(`[plugin github] refusing placeholder owner "${explicitOwner}". Pass a real GitHub login or org.`);
    process.exit(2);
  }
  const statusLogin = parseGhAuthStatusLogin(status.stderr || status.stdout);
  let login = statusLogin;
  let resolvedOwner = explicitOwner || trustedManifestOwner || statusLogin;
  let source = explicitOwner ? '--owner' : trustedManifestOwner ? 'plugin.repo' : statusLogin ? 'gh auth status' : '';
  let apiError = null;
  if (!resolvedOwner || !login) {
    const user = await execGhBuffered(['api', 'user', '--hostname', host, '--jq', '.login'], { timeout: 20_000 });
    if (user.ok && user.stdout.trim()) {
      login = user.stdout.trim();
      if (!resolvedOwner) {
        resolvedOwner = login;
        source = 'gh api user';
      }
    } else {
      apiError = user;
    }
  }
  if (!resolvedOwner) {
    console.error(`[plugin github] could not resolve the GitHub owner for ${purpose}.`);
    if (apiError?.stderr || apiError?.stdout) console.error(apiError.stderr || apiError.stdout);
    if (apiError && isGhApiRateLimit(apiError)) {
      const ownerHint = '<github-login-or-org>';
      console.error(`GitHub API is rate limited. Re-run with --owner ${ownerHint}, or authenticate/refresh gh and retry.`);
    } else {
      console.error('Run: gh auth refresh -h github.com -s repo,workflow');
      console.error('Or:  gh auth login -h github.com -s repo,workflow');
      console.error('If this is an org-owned plugin, pass --owner <github-org>.');
    }
    process.exit(1);
  }
  if (apiError && isGhApiRateLimit(apiError)) {
    console.warn('[plugin github] GitHub API is rate limited; continuing with the owner resolved locally.');
  }
  if (isPlaceholderRepoOwner(resolvedOwner)) {
    console.error(`[plugin github] refusing placeholder owner "${resolvedOwner}". Pass --owner <github-login-or-org>.`);
    process.exit(2);
  }
  return {
    host,
    login: login || resolvedOwner,
    owner: resolvedOwner,
    ownerSource: source,
    apiRateLimited: Boolean(apiError && isGhApiRateLimit(apiError)),
    version: version.stdout,
    status: status.stderr || status.stdout,
  };
}

function parseGhAuthStatusLogin(output) {
  const text = String(output ?? '');
  const activeAccount = /Logged in to [^\s]+ account ([^\s()]+)/i.exec(text);
  if (activeAccount?.[1]) return activeAccount[1].trim();
  const tokenAccount = /Token account:\s*([^\s()]+)/i.exec(text);
  if (tokenAccount?.[1]) return tokenAccount[1].trim();
  return '';
}

function isGhApiRateLimit(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /rate limit exceeded|authenticated requests get a higher rate limit/i.test(text);
}

function normalizeManifestRepoForOwner(manifest, owner) {
  const name = String(manifest?.name ?? '').trim();
  if (!name) {
    console.error('[plugin repo] manifest.name is required');
    process.exit(2);
  }
  const rawRepo = typeof manifest?.plugin?.repo === 'string' ? manifest.plugin.repo.trim() : '';
  const parsed = parseGithubRepoUrl(rawRepo);
  const placeholder = parsed ? isPlaceholderRepoOwner(parsed.owner) : false;
  const shouldRewrite = !parsed || placeholder || parsed.name.toLowerCase() !== name.toLowerCase() || parsed.owner.toLowerCase() !== owner.toLowerCase();
  const repoUrl = shouldRewrite ? `https://github.com/${owner}/${name}` : parsed.url;
  if (shouldRewrite) {
    if (!manifest.plugin || typeof manifest.plugin !== 'object') manifest.plugin = {};
    manifest.plugin.repo = repoUrl;
    manifest.homepage = repoUrl;
    if (!manifest.author || typeof manifest.author !== 'object') manifest.author = {};
    manifest.author.url = `https://github.com/${owner}`;
  }
  return {
    changed: shouldRewrite,
    repoUrl,
    previousRepoUrl: rawRepo || null,
  };
}

function parseGithubRepoUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\.git$/i, '');
  let owner = '';
  let name = '';
  try {
    const url = new URL(trimmed);
    if (!/^github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    owner = parts[0] ?? '';
    name = parts[1] ?? '';
  } catch {
    const match = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
    if (!match) return null;
    owner = match[1];
    name = match[2];
  }
  if (!owner || !name) return null;
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function isPlaceholderRepoOwner(owner) {
  return /^(openpixo-user|<vendor>|vendor|example-user|your-org|your-username|owner|user|username)$/i.test(String(owner ?? '').trim());
}

function isRepoNotFound(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /could not resolve to a repository|not found|repository not found/i.test(text);
}

async function pluginCliValidateFolder(folder) {
  const result = await execFileBuffered(process.execPath, [process.argv[1], 'plugin', 'validate', folder], {
    timeout: 120_000,
  });
  if (!result.ok) {
    console.error('[plugin validate] failed after manifest normalization');
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }
  return result;
}

function emitPluginWorkflowResult(flags, payload) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  if (!payload.ok) {
    console.error(`[${payload.action}] failed${payload.error?.label ? ` at ${payload.error.label}` : ''}`);
    if (payload.error?.stderr) console.error(payload.error.stderr);
    if (payload.error?.stdout) console.error(payload.error.stdout);
    return;
  }
  if (payload.action === 'publish-repo') {
    console.log(`Plugin published: ${payload.repoUrl}`);
    if (payload.ownerSource) console.log(`[publish-repo] owner resolved from ${payload.ownerSource}: ${payload.owner}`);
    if (payload.apiRateLimited) console.log('[publish-repo] GitHub API was rate limited; continued with the locally resolved owner.');
    if (payload.manifestRewritten) console.log('[publish-repo] manifest repo fields were normalized before publishing.');
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function extractFirstUrl(text) {
  const match = /https?:\/\/\S+/i.exec(String(text ?? ''));
  return match ? match[0].replace(/[)\].,]+$/, '') : null;
}

async function runPluginDoctor(rest) {
  // Plan §3.HH1 — --strict promotes warnings to errors so CI can
  // opt into 'no warnings allowed' mode without parsing the issue
  // list manually.
  const flags = parseFlags(rest, {
    string:  PLUGIN_STRING_FLAGS,
    boolean: new Set([...PLUGIN_BOOLEAN_FLAGS, 'strict']),
  });
  const id = rest.find((a) => !a.startsWith('-') && a !== flags['daemon-url'] && a !== flags.source);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin doctor <id> [--strict] [--json]`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}/doctor`;
  const resp = await pluginFetch(flags, url, { method: 'POST' });
  if (!resp.ok) {
    console.error(`POST /api/plugins/${id}/doctor failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  const issues = Array.isArray(data?.issues) ? data.issues : [];
  const warnings = issues.filter((i) => i?.severity === 'warning');
  const strict = flags.strict === true;
  // Strict mode: a clean issue list is still required, but the
  // pass/fail bit also fails on any warning.
  const passed = data.ok && (!strict || warnings.length === 0);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...data, strict, passed }, null, 2) + '\n');
  } else {
    if (passed && issues.length === 0) {
      console.log(`[doctor] ${data.pluginId} ok (digest ${data.freshDigest.slice(0, 12)}…)`);
    } else {
      const tier = !data.ok ? 'errors' : (strict && warnings.length > 0) ? 'warnings (--strict)' : 'warnings';
      console.log(`[doctor] ${data.pluginId} ${tier}:`);
      for (const issue of issues) {
        console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
      }
    }
  }
  process.exit(passed ? 0 : (data.ok ? 4 : 1));
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// `pixo plugin replay <runId> --snapshot-id <id>` — re-emit the immutable
// snapshot the original run was launched against, so the caller (or
// another agent) can re-apply the same plugin against fresh state. Phase
// 2A keeps replay headless: the CLI prints the snapshot + rerun bundle;
// the agent restarts the run via `pixo plugin apply` followed by a normal
// `pixo run start`. Future Phase 2C `pixo plugin run` will collapse this
// into a one-shot wrapper.
async function runPluginReplay(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const runId = rest.find((a) => !a.startsWith('-')
    && a !== flags['daemon-url']
    && a !== flags.source
    && a !== flags.inputs
    && a !== flags.project
    && a !== flags['snapshot-id']
    && a !== flags.capabilities);
  if (!runId) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin replay <runId> --snapshot-id <id>`);
    process.exit(2);
  }
  const snapshotId = flags['snapshot-id'];
  if (!snapshotId) {
    console.error(`--snapshot-id is required (runs are in-memory in Phase 2A; pass the snapshot id returned by ${PRODUCT_CLI_NAME} plugin apply)`);
    process.exit(2);
  }
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/runs/${encodeURIComponent(runId)}/replay`;
  const resp = await pluginFetch(flags, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshotId }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error(`POST /api/runs/${runId}/replay failed: ${resp.status} ${JSON.stringify(data)}`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  console.log(`[replay] ${data.rerun?.pluginId}@${data.rerun?.pluginVersion} digest=${(data.rerun?.manifestSourceDigest ?? '').slice(0, 12)}…`);
  console.log(`[replay] inputs: ${JSON.stringify(data.rerun?.inputs ?? {})}`);
  console.log(`[replay] re-apply via: ${PRODUCT_CLI_NAME} plugin apply ` + data.rerun?.pluginId + ' --inputs ' + JSON.stringify(JSON.stringify(data.rerun?.inputs ?? {})));
}

// `pixo plugin trust <id> --capabilities <comma-sep>` — flip a plugin's
// capabilities_granted set. Plan §3.A2 / spec §9.1: the CLI is the
// canonical write surface (invariant I4). The daemon validates the
// capability vocabulary; unknown / malformed entries surface as
// exit-2 usage failures.
async function runPluginTrust(rest) {
  const flags = parseFlags(rest, { string: PLUGIN_STRING_FLAGS, boolean: PLUGIN_BOOLEAN_FLAGS });
  const id = rest.find((a) => !a.startsWith('-')
    && a !== flags['daemon-url']
    && a !== flags.source
    && a !== flags.inputs
    && a !== flags.project
    && a !== flags['snapshot-id']
    && a !== flags.capabilities);
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} plugin trust <id> --capabilities fs:read,fs:write [--revoke]`);
    process.exit(2);
  }
  const capsCsv = typeof flags.capabilities === 'string' ? flags.capabilities : '';
  const caps = capsCsv.split(',').map((c) => c.trim()).filter(Boolean);
  if (caps.length === 0) {
    console.error('--capabilities is required (comma-separated, e.g. fs:read,fs:write)');
    process.exit(2);
  }
  const action = flags.revoke ? 'revoke' : 'grant';
  const url = `${(await pluginDaemonUrl(flags)).replace(/\/$/, '')}/api/plugins/${encodeURIComponent(id)}/trust`;
  const resp = await pluginFetch(flags, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities: caps, action }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 400 && data?.error?.code === 'invalid-capability') {
      const rej = (data.error.data?.rejected ?? [])
        .map((r) => `${r.capability} (${r.reason})`)
        .join(', ');
      console.error(`[trust] invalid capabilities: ${rej}`);
      process.exit(2);
    }
    console.error(`POST ${url} failed: ${resp.status} ${JSON.stringify(data)}`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  console.log(`[trust] ${action === 'grant' ? 'granted' : 'revoked'} on ${id}: ${caps.join(', ')}`);
  console.log(`[trust] now: ${(data.capabilitiesGranted ?? []).join(', ')}`);
}

function printPluginHelp() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} plugin list [--task-kind <kind>]     List installed plugins (filterable).
  ${PRODUCT_CLI_NAME} plugin search <query> [--tag <t>]    Search installed plugins by id/title/desc/tag.
  ${PRODUCT_CLI_NAME} plugin stats [--json]                Inventory + snapshot health report.
  ${PRODUCT_CLI_NAME} plugin info <id>                     Print a plugin's manifest + trust state as JSON.
  ${PRODUCT_CLI_NAME} plugin manifest <id>                 Print only the parsed manifest JSON (no wrapper).
  ${PRODUCT_CLI_NAME} plugin sources                       List distinct install sources + counts.
  ${PRODUCT_CLI_NAME} plugin install --source <path>       Install a plugin from a local folder (Phase 1).
  ${PRODUCT_CLI_NAME} plugin upgrade <id>                  Re-install a plugin from its recorded source.
  ${PRODUCT_CLI_NAME} plugin uninstall <id>                Remove a plugin from the registry + on-disk staging.
  ${PRODUCT_CLI_NAME} plugin apply <id> [--inputs <json>]  Compute an ApplyResult (preview) for a plugin.
  ${PRODUCT_CLI_NAME} plugin duplicate <id> [--name <n>]   Copy a plugin HTML example into a new project
                                          without starting an agent run.
  ${PRODUCT_CLI_NAME} plugin doctor <id>                   Lint a plugin's manifest, atoms and resolved refs.
  ${PRODUCT_CLI_NAME} plugin canon <snapshotId>            Print the canonical system-prompt block for a snapshot.
                                          (--check <file> for byte-equality fixtures.)
  ${PRODUCT_CLI_NAME} plugin simulate <pluginId> [-s k=v]  Walk the plugin's pipeline against caller-supplied
                                          signals; report stage convergence + iterations
                                          (no LLM in the loop).
  ${PRODUCT_CLI_NAME} plugin verify <pluginId>             CI meta-command: doctor + simulate + canon --check
                                          driven by an .pixo-verify.json config in the plugin folder.
  ${PRODUCT_CLI_NAME} plugin events tail [-f] [--kind k]   Tail the in-memory plugin event ring buffer.
  ${PRODUCT_CLI_NAME} plugin events snapshot               One-shot read (filterable, no SSE).
  ${PRODUCT_CLI_NAME} plugin events stats                  Roll-up: counts by kind / pluginId / time range.
  ${PRODUCT_CLI_NAME} plugin events purge                  Drop every event in the buffer (loopback-only).
  ${PRODUCT_CLI_NAME} plugin diff <a> <b> [--json]         Compare two installed plugins by id.
  ${PRODUCT_CLI_NAME} plugin replay <runId> --snapshot-id <id>
                                          Re-emit the immutable snapshot a run launched against.
  ${PRODUCT_CLI_NAME} plugin run <id> --project <id>
                                          Apply a plugin and start a project run.
  ${PRODUCT_CLI_NAME} plugin snapshots list --project <id>
                                          List snapshots applied to a project.
  ${PRODUCT_CLI_NAME} plugin trust <id> --capabilities a,b
                                          Stage a capability grant (full mutation lands Phase 3).
  ${PRODUCT_CLI_NAME} plugin validate <folder> [--json]    Lint a plugin folder before installing
                                          (manifest parse + atom + ref checks).
  ${PRODUCT_CLI_NAME} plugin pack <folder> [--out <path>]  Build a .tgz archive of a plugin
                                          folder for distribution.
  ${PRODUCT_CLI_NAME} plugin candidates list --project <id>
                                          List persisted skill-to-plugin candidates.
  ${PRODUCT_CLI_NAME} plugin publish-repo <folder>         Create/update the author's public
                                          GitHub repo for a plugin folder.
  ${PRODUCT_CLI_NAME} plugin publish <folder> --to anthropics-skills|awesome-agent-skills|clawhub|skills-sh
                                          Prepare a registry submission link.
  ${PRODUCT_CLI_NAME} plugin login [--host github.com]      Authenticate registry publishing via gh.
  ${PRODUCT_CLI_NAME} plugin whoami [--host github.com]     Show the gh account used for publishing.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base (default PIXO_DAEMON_URL, inherited sidecar discovery, or http://127.0.0.1:7456).
  --json               Emit raw JSON (suitable for scripts) instead of human-readable output.

Installs support local folders, github:owner/repo refs, HTTPS .tgz archives,
and bare marketplace names resolved through configured registry sources.`);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo project / pixo run / pixo files / pixo conversation
//
// Plan §6 Phase 1 follow-up + Phase 2C: thin CLI wrappers over the
// existing daemon HTTP endpoints (POST /api/projects, POST /api/runs,
// GET /api/projects/:id/files, …). The §12.5 walkthrough relies on
// these so a code agent can drive OpenPixo end-to-end without
// hitting `/api/*` directly. Spec §11.7 invariant: every UI feature is
// reachable via the CLI; we wrap rather than duplicate.
// ---------------------------------------------------------------------------

async function projectDaemonUrl(flags) {
  return cliDaemonUrl(flags);
}

function printShareUsage() {
  console.log(`Usage:
  ${PRODUCT_CLI_NAME} share url --url <https-url> [--title <title>] [--text <text>]
               [--copy-text <text>] [--locale <locale>] [--platform <id>] [--json]

Platforms:
  x, linkedin, facebook, reddit, telegram, whatsapp, weibo, line, instagram, xiaohongshu

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
  --json               Emit raw JSON.`);
}

async function runShare(args) {
  const wantsHelp = args.length === 0
    || args[0] === 'help'
    || args.includes('--help')
    || args.includes('-h');
  if (wantsHelp) {
    printShareUsage();
    process.exit(args.length === 0 ? 2 : 0);
  }

  const sub = args[0];
  const rest = sub === args[0] ? args.slice(1) : args;
  const flags = parseFlags(rest, {
    string: SHARE_STRING_FLAGS,
    boolean: SHARE_BOOLEAN_FLAGS,
  });
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  const positional = positionalArgs(rest, SHARE_STRING_FLAGS);
  const url = flags.url ?? positional[0];
  const body = {
    kind: 'project-html',
    url,
    title: flags.title,
    text: flags.text,
    copyText: flags['copy-text'],
    locale: flags.locale,
  };

  if (sub !== 'url') {
    console.error(`unknown share target: ${sub}`);
    printShareUsage();
    process.exit(2);
  }
  if (body.kind === 'project-html' && !body.url) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} share url --url <https-url>`);
    process.exit(2);
  }

  const resp = await fetch(`${base}/api/social-share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return structuredHttpFailure(resp);
  const data = await resp.json();
  if (flags.platform) {
    const target = (data.platforms ?? []).find((item) => item.platform === flags.platform);
    if (!target) {
      console.error(`unknown platform: ${flags.platform}`);
      process.exit(2);
    }
    if (flags.json) return process.stdout.write(JSON.stringify(target, null, 2) + '\n');
    if (target.shareUrl) {
      console.log(target.shareUrl);
      return;
    }
    console.log(data.copyText);
    if (target.entryUrl) console.log(target.entryUrl);
    return;
  }
  if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  console.log(data.copyText);
  for (const target of data.platforms ?? []) {
    console.log(`${target.platform}\t${target.shareUrl ?? target.entryUrl ?? '-'}`);
  }
}

// Read a flag value as file content (or stdin when the value is "-"). Returns
// null when the flag is unset. Mirrors readPromptFromFlags' file/stdin handling
// but for an arbitrary flag name (--html-file / --css-file).
async function readFileFlagOrStdin(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value === '-') {
    return await new Promise((resolve, reject) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { buf += chunk; });
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', reject);
    });
  }
  const { readFile } = await import('node:fs/promises');
  return await readFile(value, 'utf8');
}

function normalizeChatSessionModeFlag(value) {
  if (value == null) return undefined;
  const mode = String(value).trim().toLowerCase();
  if (mode === 'design' || mode === 'chat' || mode === 'plan') return mode;
  console.error('--mode must be chat or plan; omit it to use the default mode');
  process.exit(2);
}

function safeReadJsonFile(p) {
  try {
    if (p === '-') return JSON.parse(readFileSync(0, 'utf8'));
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function collectCliPositionals(argv, stringFlags = new Set()) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--') {
      out.push(...argv.slice(i + 1));
      break;
    }
    if (typeof value === 'string' && value.startsWith('--')) {
      const eq = value.indexOf('=');
      const key = eq >= 0 ? value.slice(2, eq) : value.slice(2);
      if (eq < 0 && stringFlags.has(key)) i++;
      continue;
    }
    out.push(value);
  }
  return out;
}

async function resolveFolderPathForCli(rawPath) {
  const path = await import('node:path');
  const os = await import('node:os');
  const raw = typeof rawPath === 'string' && rawPath.trim().length > 0
    ? rawPath.trim()
    : (process.env.INIT_CWD || process.cwd());
  const expanded = raw === '~'
    ? os.homedir()
    : raw.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), raw.slice(2))
      : raw;
  return path.resolve(expanded);
}

async function basenameForCli(folderPath) {
  const path = await import('node:path');
  return path.basename(folderPath) || 'Imported project';
}

async function readRunMessageFromFlags(flags, fallback = null) {
  if (typeof flags.message === 'string' && flags.message.length > 0) {
    return flags.message;
  }
  const prompt = await readPromptFromFlags(flags);
  if (typeof prompt === 'string' && prompt.length > 0) return prompt;
  return fallback;
}

async function postJsonToDaemon(base, route, body, headers = {}, byokApiKey) {
  let resp;
  try {
    resp = await fetch(`${base}${route}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body:    JSON.stringify(body),
    });
  } catch (err) {
    surfaceFetchError(err, base);
    process.exit(3);
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errCode = data?.error?.code;
    if (errCode && errCode in RECOVERABLE_EXIT_CODES) {
      return exitWithStructuredError({
        code:    errCode,
        message: data.error.message ?? `HTTP ${resp.status}`,
        data:    data.error.data,
      }, byokApiKey);
    }
    console.error(`POST ${route} failed: ${resp.status} ${serializeRunCliJson(data, byokApiKey)}`);
    process.exit(1);
  }
  return data;
}

async function postImportFolderToDaemon(base, body, baseDir, requestHeaders = {}) {
  const headers = { ...requestHeaders };
  const importToken = await mintCliImportToken(baseDir);
  if (importToken != null) {
    headers['x-pixo-desktop-import-token'] = importToken;
  }
  return postJsonToDaemon(base, '/api/import/folder', body, headers);
}


/** HTTP refusals are not transport failures; only recognized DTO fields reach stderr. */


async function runProject(args) {
  if (args[0] === 'checkpoint') return runProjectCheckpointCli(args.slice(1));
  if (args[0] === 'next-steps') return runProjectNextStepsCli(args.slice(1));
  if (args[0] === 'game-setup') return runProjectGameSetupCli(args.slice(1));

  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} project create [--name "<title>"] [--skill <id>]
                    [--plugin <id>] [--inputs <json>] [--metadata-json <path|->]
                    [--mode chat|plan] [--skip-plan]
                    [--prompt-file <path|->] [--json]
                    A new game plans in chat first; --skip-plan opts out for scripted use.
  ${PRODUCT_CLI_NAME} project duplicate <id> [--name "<title>"] [--json]
                    Duplicate a project and copy its project files.
  ${PRODUCT_CLI_NAME} project game-templates [--json]       List game starters.
  ${PRODUCT_CLI_NAME} project create-game --template <id> --dir <absolute parent> --name <name> [--create-parent]
                    [--genre <text>] [--platform <list>] [--style <id>] [--art-direction <text>]
                    [--palette <hex,...>] [--pixel-size <n>] [--resolution <WxH>] [--scaling <mode>]
                    [--controls <list>] [--notes <text>] [--setup-file <path|->] [--json]
                    Create a game from a starter with the new-project setup answers.
  ${PRODUCT_CLI_NAME} project game-setup <projectId> [setup flags] [--clear] [--json]
                    Show or finish the game's setup (genre, art direction, resolution, controls).
  ${PRODUCT_CLI_NAME} project check-game --dir <absolute parent> --name <name> [--create-parent] [--json]  Preflight a new game folder.
  ${PRODUCT_CLI_NAME} project import <baseDir> [--name "<title>"]
  ${PRODUCT_CLI_NAME} project import-folder <path> [--name "<title>"] [--skill <id>]
                    [--json]
  ${PRODUCT_CLI_NAME} project list                         List projects.
  ${PRODUCT_CLI_NAME} project info <id>                    Print one project.
  ${PRODUCT_CLI_NAME} project skill <id> [--clear] [--json]
                    Show the skill this project sends with every message, or
                    take it off with --clear (a skill picked with @ is for one message only).
  ${PRODUCT_CLI_NAME} project checkpoint <list|show|diff|file|restore|enable> ... [--json]
  ${PRODUCT_CLI_NAME} project next-steps <projectId> [--json] [--dismiss]
                                          Show or hide the game's starter checklist.
  ${PRODUCT_CLI_NAME} project engine [<id>] [--refresh] [--json]
                                          Detect engine (defaults to PIXO_PROJECT_ID).
  ${PRODUCT_CLI_NAME} project assets <id> [--kind all|image|audio|video|other] [--query <name>]
                    [--json] List the same live asset files as the workspace.
  ${PRODUCT_CLI_NAME} project restore-automatic-scenario <id> [--json]
                                          Restore the daemon-selected default
                                          scenario with a snapshot CAS guard.
  ${PRODUCT_CLI_NAME} project delete <id>                  Delete a project.
  ${PRODUCT_CLI_NAME} project share preflight <id> --path <file> [--json]
                    Inspect included and missing references before publishing.
                    Exits 1 when the plan has blockers (publish would be
                    refused); each blocker prints a fix to paste to an agent.
  ${PRODUCT_CLI_NAME} project share publish <id> --path <file> [--json]
                    Publish a project file.
  ${PRODUCT_CLI_NAME} project share resume <id> --path <file> [--json]
                    Resume sharing through the same stable-alias lifecycle as the UI.
  ${PRODUCT_CLI_NAME} project share get <id> --path <file> [--json]
                    Read the current publication.
  ${PRODUCT_CLI_NAME} project share status <id> [--path <file>] [--json]
                    Project binding history, or file lifecycle with --path.
  ${PRODUCT_CLI_NAME} project share stop <id> --path <file> --slug <slug> [--json]
                    Stop the stable public alias; its identity is retained for resume.
  ${PRODUCT_CLI_NAME} project revoke-public-link <id> --path <file> --url <public-url>
                    Revoke a public file link whose local publication record
                    was lost during an older daemon restart or upgrade.
  ${PRODUCT_CLI_NAME} project editors                      List locally-installed editors that
                                          can open a project (hand-off targets).
  ${PRODUCT_CLI_NAME} project open-in <id> --editor <slug> [--path <project-relative-file>]
                                          Open the project's working directory
                                          in the chosen editor (cursor, zed,
                                          vscode, finder, terminal, …).
                    Synthesize a resume-conversation handoff prompt.
  ${PRODUCT_CLI_NAME} project artifact-snapshot list --project <id> --conversation <id>
                    --message <id> [--json]
                    List one chat message's artifact refs — which version each
                    card shows and which one clicking it opens.
  ${PRODUCT_CLI_NAME} project artifact-snapshot inspect <snapshotId> --project <id> [--json]
                    Print one immutable snapshot's metadata (digest, size,
                    capture state, lineage).
  ${PRODUCT_CLI_NAME} project artifact-snapshot export <snapshotId> --project <id> --out <path>
                    [--thumbnail] [--json]
                    Write a snapshot's exact historical bytes to a local file.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
                       Exact caller membership for bound project requests.
  --json               Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, {
    string: PROJECT_RESOURCE_STRING_FLAGS,
    boolean: sub === 'engine' ? new Set([...PROJECT_BOOLEAN_FLAGS, 'refresh']) : sub === 'skill' ? new Set([...PROJECT_BOOLEAN_FLAGS, 'clear']) : PROJECT_BOOLEAN_FLAGS,
  });
  const base = (await projectDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  switch (sub) {
    case 'game-templates':
    case 'create-game':
    case 'check-game':
      return runGameTemplateProjectCli(sub, flags, { base, requestHeaders, mintImportToken: mintCliImportToken });
    case 'engine': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0] ?? process.env.PIXO_PROJECT_ID;
      if (!id) { console.error(`Usage: ${PRODUCT_CLI_NAME} project engine <id> [--refresh] [--json]`); process.exit(2); }
      return printProjectEngine(base, id, { refresh: flags.refresh, json: flags.json, headers: requestHeaders });
    }
    case 'assets': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      const kind = typeof flags.kind === 'string' ? flags.kind : 'all';
      if (!id || !PROJECT_ASSET_KINDS.includes(kind)) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project assets <id> [--kind all|image|audio|video|other] [--query <name>] [--json]`);
        process.exit(2);
      }
      const response = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/files`, { headers: requestHeaders });
      if (!response.ok) return structuredHttpFailure(response);
      const data = await response.json();
      const files = filterProjectAssets(data.files ?? [], typeof flags.query === 'string' ? flags.query : '', kind);
      if (flags.json) return process.stdout.write(JSON.stringify({ files }, null, 2) + '\n');
      for (const file of files) console.log(`${file.name}\t${file.kind}\t${file.size}\t${file.localPath ?? file.name}`);
      return;
    }
    case 'list': {
      const listResp = await fetch(`${base}/api/projects`);
      if (!listResp.ok) return structuredHttpFailure(listResp);
      const data = await listResp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const projects = data?.projects ?? [];
      if (projects.length === 0) {
        console.log(`No projects. Create one with \`${PRODUCT_CLI_NAME} project create --name "..."\`.`);
        return;
      }
      for (const p of projects) console.log(`${p.id}\t${p.name}\t${p.skillId ?? '-'}`);
      return;
    }
    case 'skill': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0] ?? process.env.PIXO_PROJECT_ID;
      if (!id) { console.error(`Usage: ${PRODUCT_CLI_NAME} project skill <id> [--clear] [--json]`); process.exit(2); }
      const url = `${base}/api/projects/${encodeURIComponent(id)}`;
      const resp = flags.clear
        ? await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', ...requestHeaders }, body: JSON.stringify({ skillId: null }) })
        : await fetch(url, { headers: requestHeaders });
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      const skillId = data?.project?.skillId ?? null;
      if (flags.json) return process.stdout.write(JSON.stringify({ projectId: id, skillId }) + '\n');
      console.log(skillId ? `${skillId} is sent with every message in this project. Remove it with --clear.` : 'This project sends no skill with every message.');
      return;
    }
    case 'info': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project info <id>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}`, {
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    case 'restore-automatic-scenario': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project restore-automatic-scenario <id> [--json]`);
        process.exit(2);
      }
      const infoResponse = await fetch(`${base}/api/projects/${encodeURIComponent(id)}`, {
        headers: requestHeaders,
      });
      if (!infoResponse.ok) return structuredHttpFailure(infoResponse, 'project-not-found');
      const info = await infoResponse.json();
      const data = await postJsonToDaemon(
        base,
        `/api/projects/${encodeURIComponent(id)}/scenario/restore-automatic`,
        { expectedCurrentSnapshotId: info.project?.appliedPluginSnapshotId ?? null },
        requestHeaders,
      );
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(
        `[project] automatic scenario ${data.changed ? 'restored' : 'already active'} `
        + `${data.scenarioBinding?.pluginId ?? '-'}@${data.scenarioBinding?.snapshotId ?? '-'}`,
      );
      return;
    }
    case 'revoke-public-link': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      const filePath = typeof flags.path === 'string' ? flags.path.trim() : '';
      const publicUrl = typeof flags.url === 'string' ? flags.url.trim() : '';
      let slug = '';
      try {
        const parsed = new URL(publicUrl);
        const match = parsed.pathname.match(
          /^\/api\/v1\/public\/snapshots\/([^/]+)(?:\/|$)/u,
        );
        slug = match?.[1] ? decodeURIComponent(match[1]) : '';
      } catch {
        slug = '';
      }
      if (!id || !filePath || !slug) {
        console.error(
          `Usage: ${PRODUCT_CLI_NAME} project revoke-public-link <id> --path <file> --url <public-url> [--json]`,
        );
        process.exit(2);
      }
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(filePath)}/publish-public`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', ...requestHeaders },
          body: JSON.stringify({ slug }),
        },
      );
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[project] revoked public link ${slug} for ${filePath}`);
      return;
    }
    case 'create': {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      const name = typeof flags.name === 'string' && flags.name.length > 0
        ? flags.name
        : 'Untitled project';
      const body = {
        id,
        name,
        skillId:        flags.skill ?? null,
        metadata:       { kind: 'other' },
        ...(flags['skip-plan'] ? { skipDiscoveryBrief: true } : {}),
      };
      const conversationMode = normalizeChatSessionModeFlag(flags.mode);
      if (conversationMode) body.conversationMode = conversationMode;
      if (flags['pending-prompt']) body.pendingPrompt = flags['pending-prompt'];
      if (flags['metadata-json']) {
        const mj = safeReadJsonFile(flags['metadata-json']);
        if (mj && typeof mj === 'object') body.metadata = mj;
      }
      const prompt = await readPromptFromFlags(flags);
      if (prompt) body.pendingPrompt = prompt;
      if (flags.plugin) body.pluginId = flags.plugin;
      if (flags.inputs) {
        try { body.pluginInputs = JSON.parse(flags.inputs); } catch (err) {
          console.error(`--inputs must be valid JSON: ${err.message}`);
          process.exit(2);
        }
      }
      if (flags['grant-caps']) {
        body.grantCaps = String(flags['grant-caps']).split(',').map((c) => c.trim()).filter(Boolean);
      }
      const resp = await fetch(`${base}/api/projects`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body:    JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (resp.status === 409 && data?.error?.code === 'capabilities-required') {
          return exitWithStructuredError({
            code:    'capabilities-required',
            message: data.error.message,
            data:    data.error.data,
          });
        }
        // The daemon bounds create preparation (15s by default) and answers
        // 504 PROJECT_CREATE_PREPARATION_TIMEOUT without committing anything.
        // Surface that code the same way the Web does so an embedding agent
        // can retry the identical request instead of parsing a log line.
        if (flags.json && typeof data?.error?.code === 'string') {
          return exitWithStructuredError({
            code:    data.error.code,
            message: typeof data.error.message === 'string'
              ? data.error.message
              : `POST /api/projects failed: ${resp.status}`,
            data:    {
              status:    resp.status,
              retryable: data.error.retryable === true,
              ...(data.error.details !== undefined ? { details: data.error.details } : {}),
            },
          });
        }
        console.error(`POST /api/projects failed: ${resp.status} ${JSON.stringify(data)}`);
        process.exit(1);
      }
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[project] created ${data.project?.id ?? id} (conversation ${data.conversationId})`);
      return;
    }
    case 'duplicate': {
      const sourceProjectId = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!sourceProjectId) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project duplicate <id> [--name "<title>"] [--json]`);
        process.exit(2);
      }
      const body = {};
      if (typeof flags.name === 'string' && flags.name.length > 0) body.name = flags.name;
      const data = await postJsonToDaemon(
        base,
        `/api/projects/${encodeURIComponent(sourceProjectId)}/duplicate`,
        body,
        requestHeaders,
      );
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(
        `[project] duplicated ${sourceProjectId} as ${data.project?.id ?? '-'} `
        + `(conversation ${data.conversationId ?? '-'})`,
      );
      return;
    }
    case 'import': {
      const [baseDir] = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const importBaseDir = typeof baseDir === 'string' ? baseDir.trim() : '';
      if (!importBaseDir) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project import <baseDir> [--name "<title>"]`);
        process.exit(2);
      }
      const body = { baseDir: importBaseDir };
      if (typeof flags.name === 'string' && flags.name.length > 0) body.name = flags.name;
      if (typeof flags.skill === 'string' && flags.skill.length > 0) body.skillId = flags.skill;
      const headers = { 'content-type': 'application/json', ...requestHeaders };
      const importToken = await mintCliImportToken(importBaseDir);
      if (importToken != null) {
        headers['x-pixo-desktop-import-token'] = importToken;
      }
      const resp = await fetch(`${base}/api/import/folder`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(body),
      });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[project] imported ${data.project?.id ?? '-'} (conversation ${data.conversationId ?? '-'})`);
      return;
    }
    case 'import-folder': {
      const parts = collectCliPositionals(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const folderArg = flags.path ?? flags.dir ?? parts[0];
      if (!folderArg) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project import-folder <path> [--skill <id>]`);
        process.exit(2);
      }
      const folderPath = await resolveFolderPathForCli(folderArg);
      const body = {
        baseDir:        folderPath,
        name:           typeof flags.name === 'string' && flags.name.length > 0
          ? flags.name
          : await basenameForCli(folderPath),
        skillId:        flags.skill ?? null,
      };
      const data = await postImportFolderToDaemon(
        base,
        body,
        folderPath,
        requestHeaders,
      );
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[project] imported ${data.project?.id ?? '-'} from ${folderPath} (conversation ${data.conversationId ?? '-'})`);
      return;
    }
    case 'delete': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project delete <id>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data: import('@openpixo/contracts').ProjectDeleteResponse = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[project] deleted ${id}`);
      if (data.shareResiduals?.length) {
        const lines = data.shareResiduals.map(item =>
          `  ${JSON.stringify(item.filePath)} (${JSON.stringify(item.slug)}): ${item.retrying
            ? 'stop queued for retry' : 'action required; no automatic retry'}`);
        console.warn('[project] warning: public links may still be live:\n' + lines.join('\n'));
      }
      return;
    }
    case 'editors': {
      const resp = await fetch(`${base}/api/editors`);
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const editors = data?.editors ?? [];
      for (const ed of editors) {
        const status = ed.available ? 'available' : 'missing';
        console.log(`${ed.id}\t${ed.label}\t${status}`);
      }
      return;
    }
    case 'open-in': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} project open-in <id> --editor <slug>`);
        process.exit(2);
      }
      const editor = typeof flags.editor === 'string' ? flags.editor : '';
      if (!editor) {
        console.error(`--editor <slug> is required. Run \`${PRODUCT_CLI_NAME} project editors\` to list options.`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/open-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body: JSON.stringify({ editorId: editor, ...(typeof flags.path === 'string' ? { fileName: flags.path } : {}) }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (flags.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        else console.error(`POST /api/projects/${id}/open-in failed: ${resp.status} ${JSON.stringify(data)}`);
        process.exit(1);
      }
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[project] opened ${id} in ${editor} (${data.path ?? ''})`);
      return;
    }
    // Chat artifact snapshots. The UI reads these through the same endpoints;
    // this is the embeddability half of the dual-track rule, so an external
    // agent can inspect and export a turn's exact bytes without the web app.
    case 'artifact-snapshot': {
      const action = rest[0];
      const projectId = String(flags.project ?? '').trim();
      if (!projectId) {
        console.error(`${PRODUCT_CLI_NAME} project artifact-snapshot requires --project <id>`);
        process.exit(2);
      }
      const scope = `/api/projects/${encodeURIComponent(projectId)}`;
      if (action === 'list') {
        const conversationId = String(flags.conversation ?? '').trim();
        const messageId = String(flags.message ?? '').trim();
        if (!conversationId || !messageId) {
          console.error(`${PRODUCT_CLI_NAME} project artifact-snapshot list requires --conversation <id> --message <id>`);
          process.exit(2);
        }
        const resp = await fetch(
          `${base}${scope}/conversations/${encodeURIComponent(conversationId)}`
            + `/messages/${encodeURIComponent(messageId)}/artifacts`,
          { headers: requestHeaders },
        );
        if (!resp.ok) return structuredHttpFailure(resp);
        const data = await resp.json();
        if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        const artifacts = data?.artifacts ?? [];
        if (artifacts.length === 0) {
          console.log('No artifact refs on this message.');
          return;
        }
        for (const ref of artifacts) {
          console.log(
            // No `opens:` column: every card opens the workspace's latest
            // file, so printing it per row would only imply it varies.
            `${ref.label}\t${ref.kind}\tshows:${ref.displayPolicy}`
              + `\t${ref.snapshotState}\t${ref.snapshotId ?? '-'}`,
          );
        }
        return;
      }
      if (action === 'inspect') {
        const snapshotId = String(rest[1] ?? '').trim();
        if (!snapshotId) {
          console.error(`${PRODUCT_CLI_NAME} project artifact-snapshot inspect requires <snapshotId>`);
          process.exit(2);
        }
        const resp = await fetch(
          `${base}${scope}/chat-artifact-snapshots/${encodeURIComponent(snapshotId)}`,
          { headers: requestHeaders },
        );
        if (!resp.ok) return structuredHttpFailure(resp);
        const data = await resp.json();
        if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        const snapshot = data?.snapshot ?? {};
        console.log(`${snapshot.id}\t${snapshot.kind}\t${snapshot.state}`);
        console.log(`  captured from: ${snapshot.sourcePathAtCapture}`);
        console.log(`  digest:        ${snapshot.contentDigest ?? '-'}`);
        console.log(`  bytes:         ${snapshot.byteSize ?? '-'}`);
        if (snapshot.failureCode) console.log(`  failure:       ${snapshot.failureCode}`);
        return;
      }
      if (action === 'export') {
        const snapshotId = String(rest[1] ?? '').trim();
        const out = String(flags.out ?? '').trim();
        if (!snapshotId || !out) {
          console.error(`${PRODUCT_CLI_NAME} project artifact-snapshot export requires <snapshotId> --out <path>`);
          process.exit(2);
        }
        const which = flags.thumbnail ? 'thumbnail' : 'content';
        const resp = await fetch(
          `${base}${scope}/chat-artifact-snapshots/${encodeURIComponent(snapshotId)}/${which}`,
          { headers: requestHeaders },
        );
        if (!resp.ok) return structuredHttpFailure(resp);
        const buffer = Buffer.from(await resp.arrayBuffer());
        writeFileSync(out, buffer);
        if (flags.json) {
          return process.stdout.write(
            JSON.stringify({ snapshotId, out, byteSize: buffer.byteLength }, null, 2) + '\n',
          );
        }
        console.log(`[project] wrote ${buffer.byteLength} bytes to ${out}`);
        return;
      }
      console.error(`usage: ${PRODUCT_CLI_NAME} project artifact-snapshot <list|inspect|export> …`);
      process.exit(2);
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} project ${sub}`);
      process.exit(2);
  }
}


async function runRun(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} run start --project <projectId> [--conversation <id>] [--message "<text>"]
               [--prompt-file <path|->]
               [--client-request-id <id>]
               [--skill <id>[,<id>]] [--plugin <id>] [--inputs <json>] [--grant-caps a,b]
               [--agent <id>] [--model <id>] [--reasoning <effort>] [--service-tier <id>]
               [--byok-protocol <protocol>] [--byok-base-url <url>]
               [--byok-api-version <version>] [--byok-key-env <env>] [--byok-keyless]
               [--follow] [--json]
  ${PRODUCT_CLI_NAME} run watch  <runId>                     ND-JSON event stream on stdout.
  ${PRODUCT_CLI_NAME} run cancel <runId>                     Request cancellation.
  ${PRODUCT_CLI_NAME} run approvals <runId> [--json]        List pending Codex permission requests.
  ${PRODUCT_CLI_NAME} run approve <runId> <requestId> <accept|decline|cancel> [--json]
                                            Respond to one pending request.
  ${PRODUCT_CLI_NAME} run steer  <runId> [--message "<text>" | --prompt-file <path|->] [--json]
                                            Push a message into the turn that is
                                            STILL RUNNING (「引导对话」) instead of
                                            cancelling and resending. Only agents
                                            whose CLI keeps stdin open mid-turn
                                            can take it; the rest refuse with
                                            RUN_STEERING_UNSUPPORTED.
  ${PRODUCT_CLI_NAME} run continue <runId> [--message "<text>" | --prompt-file <path|->]
               [--byok-protocol <protocol>] [--byok-base-url <url>]
               [--byok-key-env <env>] [--model <id>] [--follow] [--json]
  ${PRODUCT_CLI_NAME} run list   [--project <id>]            List recent runs.
  ${PRODUCT_CLI_NAME} run info   <runId>                     One run's status.
  ${PRODUCT_CLI_NAME} run result-package <runId> [--json]    Inspect run outputs and workspace
                                            provenance without applying them.

BYOK start/continue options:
  BYOK requires --model <id>; Azure also requires --byok-base-url.
  --byok-protocol <protocol>  anthropic|openai|azure|google|ollama|senseaudio|aihubmix.
                              Canonical DeepSeek/OpenRouter use native Codex;
                              other presets use the upstream BYOK executor.
  --byok-base-url <url>       Override the protocol's default service URL.
  --byok-api-version <value>  Optional provider API version.
  --byok-key-env <env>        Read the API key from this environment variable.
  --byok-keyless             Explicitly use a provider without an API key.
                              Use --model <id> to select the BYOK model.
  Provider continuations must resupply the same snapshot and env-key source;
  provider credentials are never persisted with a run.

Common options:
  --daemon-url <url>         OpenPixo daemon HTTP base.
  --json                     Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, {
    string: sub === 'start' || sub === 'continue' ? RUN_START_STRING_FLAGS : PROJECT_RESOURCE_STRING_FLAGS,
    boolean: sub === 'start' || sub === 'continue' ? RUN_START_BOOLEAN_FLAGS : PROJECT_BOOLEAN_FLAGS,
  });
  const base = (await projectDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  switch (sub) {
    case 'approvals':
    case 'approve': {
      const [id, requestId, decision] = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      if (!id || (sub === 'approve' && (!requestId || !['accept', 'decline', 'cancel'].includes(decision)))) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} run approvals <runId> [--json] | ${PRODUCT_CLI_NAME} run approve <runId> <requestId> <accept|decline|cancel> [--json]`);
        process.exit(2);
      }
      const suffix = sub === 'approve' ? `/${encodeURIComponent(requestId)}` : '';
      const response = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/approvals${suffix}`, {
        headers: { ...requestHeaders, 'content-type': 'application/json' },
        ...(sub === 'approve' ? { method: 'POST', body: JSON.stringify({ decision }) } : {}),
      });
      if (!response.ok) return structuredHttpFailure(response, 'run-not-found');
      process.stdout.write(JSON.stringify(await response.json(), null, 2) + '\n');
      return;
    }
    case 'list': {
      const url = flags.project
        ? `${base}/api/runs?projectId=${encodeURIComponent(flags.project)}`
        : `${base}/api/runs`;
      const resp = await fetch(url, { headers: requestHeaders });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const runs = data?.runs ?? [];
      for (const r of runs) {
        console.log(`${r.id}\t${r.status}\tproject=${r.projectId ?? '-'}\tplugin=${r.pluginId ?? '-'}`);
      }
      return;
    }
    case 'info': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} run info <runId>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/runs/${encodeURIComponent(id)}`, {
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'run-not-found');
      const data = await resp.json();
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    case 'result-package': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} run result-package <runId> [--json]`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/result-package`, {
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'run-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const run = data?.run ?? {};
      const workspace = data?.workspace ?? {};
      const storage = workspace.storage ?? {};
      const provenance = workspace.provenance ?? null;
      console.log(`run\t${run.id ?? id}\t${run.status ?? '-'}`);
      console.log(`workspace\t${storage.kind ?? '-'}\t${storage.baseDir ?? '-'}`);
      console.log(`provenance\t${provenance?.kind ?? '-'}\twriteback=${provenance?.writeback ?? '-'}`);
      console.log(`project\t${data?.project?.id ?? '-'}\tfiles=${data?.project?.fileCount ?? 0}`);
      const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
      for (const artifact of artifacts) {
        console.log(`artifact\t${artifact.file ?? '-'}\t${artifact.kind ?? '-'}\t${artifact.title ?? '-'}`);
      }
      return;
    }
    case 'cancel': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} run cancel <runId>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'run-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const canceledRun = data?.run ?? {};
      console.log(`[run] cancelled ${canceledRun.id ?? id}`);
      return;
    }
    // B11 「引导对话」. The dual of `cancel`: the turn is NOT stopped, the text is
    // written onto the agent child's still-open stdin so the model reads it
    // mid-turn. Long instructions go through --prompt-file <path|-> so a
    // heredoc / jq pipeline stays clean (same contract as `pixo run start`).
    case 'steer': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      const text = (
        (typeof flags.message === 'string' && flags.message.length > 0
          ? flags.message
          : await readPromptFromFlags(flags)) ?? ''
      ).trim();
      if (!id || !text) {
        console.error(
          `Usage: ${PRODUCT_CLI_NAME} run steer <runId> --message "<text>" [--json]\n`
          + `       ${PRODUCT_CLI_NAME} run steer <runId> --prompt-file <path|-> [--json]`,
        );
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/steer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'run-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      // Clean stdout stays machine-chainable; the hint goes to stderr.
      process.stderr.write('[run] delivered into the running turn — the agent keeps its work\n');
      console.log(`${id}\t${data?.messageId ?? ''}\t${data?.run?.status ?? '-'}`);
      return;
    }
    case 'continue': {
      const id = positionalArgs(rest, RUN_START_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} run continue <runId> [--message "<text>"] [--follow] [--json]`);
        process.exit(2);
      }
      const statusResp = await fetch(`${base}/api/runs/${encodeURIComponent(id)}`, {
        headers: requestHeaders,
      });
      if (!statusResp.ok) return structuredHttpFailure(statusResp, 'run-not-found');
      const status = await statusResp.json();
      if (status?.resumable !== true) {
        const payload = {
          error: {
            code: 'run-not-resumable',
            message: `Run ${id} does not have a safe recoverable native session.`,
          },
        };
        if (flags.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        else console.error(payload.error.message);
        process.exit(1);
      }
      if (!status.projectId || !status.conversationId) {
        const payload = {
          error: {
            code: 'run-missing-context',
            message: `Run ${id} is missing project or conversation context.`,
          },
        };
        if (flags.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        else console.error(payload.error.message);
        process.exit(1);
      }
      const message = await readRunMessageFromFlags(flags, RESUME_CONTINUE_PROMPT);
      let byokProvider;
      try {
        byokProvider = byokProviderFromCliOptions({
          protocol: flags['byok-protocol'], baseUrl: flags['byok-base-url'],
          apiVersion: flags['byok-api-version'], keyEnv: flags['byok-key-env'],
          keyless: flags['byok-keyless'] === true,
        }, process.env);
      } catch (error) { console.error(error.message); process.exit(2); }
      const body = {
        projectId: status.projectId,
        conversationId: status.conversationId,
        message,
        // This message is a continuation directive, not a self-contained
        // request, and this command ships no transcript with it. Declaring that
        // lets the daemon — the only layer that knows whether the stored
        // session survived its model/cwd/cursor guard — decide whether to send
        // the directive alone or reseed the original request alongside it.
        resumeContinuation: true,
        analyticsHints: { entryFrom: 'resume_continue' },
        ...(status.agentId ? { agentId: status.agentId } : {}),
        ...(byokProvider ? { byokProvider } : {}),
        ...(flags.model || status.model ? { model: flags.model || status.model } : {}),
      };
      if (byokProvider && nativeCodexProviderForConfig(byokProvider)) body.agentId = 'codex';
      const data = await postJsonToDaemon(base, '/api/runs', body, requestHeaders, byokProvider?.apiKey);
      if (flags.json && !flags.follow) {
        return process.stdout.write(serializeRunCliJson({
          ...data,
          continuedFromRunId: id,
        }, byokProvider?.apiKey, 2) + '\n');
      }
      console.log(redactSecrets(`[run] continued ${id} as ${data.runId}`, [byokProvider?.apiKey]));
      if (flags.follow) await streamRunEvents(base, data.runId, requestHeaders, byokProvider?.apiKey);
      return;
    }
    case 'watch': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} run watch <runId>`);
        process.exit(2);
      }
      await streamRunEvents(base, id, requestHeaders);
      return;
    }
    case 'start': {
      if (!flags.project) {
        console.error('--project <projectId> is required');
        process.exit(2);
      }
      let byokProvider;
      try {
        byokProvider = byokProviderFromCliOptions({
          protocol: flags['byok-protocol'],
          baseUrl: flags['byok-base-url'],
          apiVersion: flags['byok-api-version'],
          keyEnv: flags['byok-key-env'],
          keyless: flags['byok-keyless'] === true,
        }, process.env);
      } catch (err) {
        console.error(err.message);
        process.exit(2);
      }
      const body = { projectId: flags.project };
      if (byokProvider) body.byokProvider = byokProvider;
      if (byokProvider && nativeCodexProviderForConfig(byokProvider)) body.agentId = 'codex';
      else if (flags.agent) body.agentId = String(flags.agent);
      else if (byokProvider) body.agentId = 'byok-opencode';
      if (flags.conversation) body.conversationId = flags.conversation;
      const message = await readRunMessageFromFlags(flags);
      if (message) body.message = message;
      if (flags.plugin) body.pluginId = flags.plugin;
      if (flags.skill) {
        const selectedSkillIds = splitCommaSeparatedIds(flags.skill);
        if (selectedSkillIds.length === 1) body.skillId = selectedSkillIds[0];
        if (selectedSkillIds.length > 1) {
          body.skillId = selectedSkillIds[0];
          body.skillIds = selectedSkillIds;
        }
      }
      if (flags.model) body.model = flags.model;
      if (flags.reasoning) body.reasoning = flags.reasoning;
      if (flags['service-tier']) body.serviceTier = flags['service-tier'];
      if (flags.inputs) {
        try { body.pluginInputs = JSON.parse(flags.inputs); } catch (err) {
          console.error(`--inputs must be valid JSON: ${err.message}`);
          process.exit(2);
        }
      }
      if (flags['grant-caps']) {
        body.grantCaps = String(flags['grant-caps']).split(',').map((c) => c.trim()).filter(Boolean);
      }
      if (flags['snapshot-id']) body.appliedPluginSnapshotId = flags['snapshot-id'];
      if (flags['client-request-id']) body.clientRequestId = flags['client-request-id'];
      const resp = await fetch(`${base}/api/runs`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body:    JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (resp.status === 409 && data?.error?.code === 'capabilities-required') {
          return exitWithStructuredError({
            code:    data.error.code,
            message: data.error.message,
            data:    data.error.data,
          }, byokProvider?.apiKey);
        }
        if (resp.status === 422 && data?.error?.code === 'missing-input') {
          return exitWithStructuredError({
            code:    data.error.code,
            message: data.error.message,
            data:    data.error.data,
          }, byokProvider?.apiKey);
        }
        console.error(`POST /api/runs failed: ${resp.status} ${serializeRunCliJson(data, byokProvider?.apiKey)}`);
        process.exit(1);
      }
      if (flags.json && !flags.follow) {
        return process.stdout.write(serializeRunCliJson(data, byokProvider?.apiKey, 2) + '\n');
      }
      console.log(redactSecrets(`[run] started ${data.runId}`, [byokProvider?.apiKey]));
      if (flags.follow) await streamRunEvents(base, data.runId, requestHeaders, byokProvider?.apiKey);
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} run ${sub}`);
      process.exit(2);
  }
}

function serializeRunCliJson(value, byokApiKey, indentation) {
  // Only redact printed values; Run identities keep raw data.
  const secrets = byokApiKey ? [byokApiKey, JSON.stringify(byokApiKey).slice(1, -1)] : [];
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === 'string' && byokApiKey ? redactSecrets(entry, secrets) : entry
  ), indentation);
}

// Stream the SSE events at /api/runs/:id/events as ND-JSON on stdout.
// Each line is one event: { event, data } so a code agent can parse it
// without needing an SSE library.
async function streamRunEvents(base, initialRunId, requestHeaders = {}, byokApiKey) {
  const runId = initialRunId;
    const resp = await fetch(`${base}/api/runs/${encodeURIComponent(runId)}/events`, {
      headers: { accept: 'text/event-stream', ...requestHeaders },
    });
    if (!resp.ok || !resp.body) {
      console.error(`run watch failed: ${resp.status}`);
      process.exit(1);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let ended = false;
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const lines = block.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event: '));
        const dataLines = lines
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length));
        const event = eventLine ? eventLine.slice('event: '.length) : 'message';
        const dataRaw = dataLines.join('\n');
        let parsed;
        try { parsed = JSON.parse(dataRaw); } catch { parsed = dataRaw; }
        process.stdout.write(serializeRunCliJson({ event, data: parsed }, byokApiKey) + '\n');
        if (event !== 'end') continue;
        ended = true;
        break;
      }
    }
}

// `pixo shell --project <id>` opens an interactive PTY rooted at the project's
// working directory and attaches to it. This is the CLI parity for the web
// Terminal tab — both surfaces drive `/api/projects/:id/terminals`. Output
// streams down over SSE; local keystrokes are POSTed back up to /stdin. When
// stdin is a TTY we flip it into raw mode so the remote shell sees per-key
// bytes (ctrl-c, arrows, tab) instead of line-buffered input.
async function runShell(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} shell --project <projectId> [--shell <path>] [--json]
                                  Open an interactive shell in the project's
                                  working directory and attach to it.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
  --json               Print the created terminal session as JSON and exit
                       (does not attach).`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const flags = parseFlags(args, {
    string: PROJECT_RESOURCE_STRING_FLAGS,
    boolean: PROJECT_BOOLEAN_FLAGS,
  });
  if (!flags.project) {
    console.error('--project <projectId> is required');
    process.exit(2);
  }
  const base = (await projectDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  const body = {};
  if (flags.shell) body.shell = flags.shell;
  if (process.stdout.columns) body.cols = process.stdout.columns;
  if (process.stdout.rows) body.rows = process.stdout.rows;
  const createResp = await fetch(
    `${base}/api/projects/${encodeURIComponent(flags.project)}/terminals`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...requestHeaders },
      body: JSON.stringify(body),
    },
  );
  if (!createResp.ok) return structuredHttpFailure(createResp, 'project-not-found');
  const created = await createResp.json();
  if (flags.json) {
    return process.stdout.write(JSON.stringify(created, null, 2) + '\n');
  }
  const terminalId = created?.terminal?.id;
  if (!terminalId) {
    console.error('terminal create returned no id');
    process.exit(1);
  }
  await attachTerminal(base, flags.project, terminalId, requestHeaders);
}

// Bridge a local TTY to a remote PTY session: SSE `data` events → stdout,
// local stdin bytes → POST /stdin, terminal resize → POST /resize. Resolves
// when the remote shell emits its `exit` event.
async function attachTerminal(base, projectId, terminalId, requestHeaders = {}) {
  const termPath = `${base}/api/projects/${encodeURIComponent(projectId)}/terminals/${encodeURIComponent(terminalId)}`;
  const isRawTty = Boolean(process.stdin.isTTY && process.stdin.setRawMode);
  if (isRawTty) process.stdin.setRawMode(true);
  process.stdin.resume();

  const onInput = (chunk) => {
    fetch(`${termPath}/stdin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...requestHeaders },
      body: JSON.stringify({ data: chunk.toString('utf8') }),
    }).catch(() => {});
  };
  process.stdin.on('data', onInput);

  const onResize = () => {
    fetch(`${termPath}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...requestHeaders },
      body: JSON.stringify({ cols: process.stdout.columns, rows: process.stdout.rows }),
    }).catch(() => {});
  };
  process.stdout.on('resize', onResize);

  const restore = () => {
    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    if (isRawTty) {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }
    process.stdin.pause();
  };

  try {
    const resp = await fetch(`${termPath}/stream`, {
      headers: { accept: 'text/event-stream', ...requestHeaders },
    });
    if (!resp.ok || !resp.body) {
      console.error(`shell attach failed: ${resp.status}`);
      process.exit(1);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const lines = block.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event: '));
        const dataLine = lines.find((l) => l.startsWith('data: '));
        const event = eventLine ? eventLine.slice('event: '.length) : 'message';
        const dataRaw = dataLine ? dataLine.slice('data: '.length) : '';
        let parsed;
        try { parsed = JSON.parse(dataRaw); } catch { parsed = dataRaw; }
        if (event === 'data' && parsed && typeof parsed.data === 'string') {
          process.stdout.write(parsed.data);
        } else if (event === 'exit') {
          restore();
          process.exit(typeof parsed?.code === 'number' ? parsed.code : 0);
        }
      }
    }
  } finally {
    restore();
  }
}

function parseProjectFileVersionSourceFlag(raw) {
  if (raw == null) return null;
  if (raw === 'ai' || raw === 'manual' || raw === 'restore') return raw;
  console.error(`Invalid --source "${String(raw)}". Expected one of: ai, manual, restore.`);
  process.exit(2);
}

async function runFiles(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} files list   <projectId>                  List files in a project.
  ${PRODUCT_CLI_NAME} files read   <projectId> <relpath>        Stream file bytes to stdout.
  ${PRODUCT_CLI_NAME} files write  <projectId> <relpath> [< stdin]
                                               Write content from stdin.
  ${PRODUCT_CLI_NAME} files upload <projectId> <localpath> [--as <relpath>]
                                               Upload a local file.
  ${PRODUCT_CLI_NAME} files delete <projectId> <name> [--json]  Delete a project file.
  ${PRODUCT_CLI_NAME} files diff   <projectId> <relpathA> [<relpathB> | --against -]
                                               Print a unified diff.
                                               Explicit source identity edit; settle drafts first.
  ${PRODUCT_CLI_NAME} files versions <projectId> <relpath>      List saved HTML versions.
  ${PRODUCT_CLI_NAME} files version-read <projectId> <relpath> <versionId>
                                               Stream one saved HTML version.
  ${PRODUCT_CLI_NAME} files version-create <projectId> <relpath>
                                               Save the current HTML as a version.
  ${PRODUCT_CLI_NAME} files version-restore <projectId> <relpath> <versionId>
                                               Restore a saved HTML as a new current version.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
                       Exact caller membership for bound project requests.
  --prompt-file <path|->  Read a version prompt from file/stdin where supported.
  --source <ai|manual|restore>
                       Version provenance where supported.
  --json               Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, {
    string: PROJECT_RESOURCE_STRING_FLAGS,
    boolean: PROJECT_BOOLEAN_FLAGS,
  });
  const base = (await projectDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders =
    {};
  switch (sub) {
    case 'list': {
      const id = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files list <projectId>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/files`, {
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const files = Array.isArray(data?.files) ? data.files : [];
      for (const f of files) console.log(`${f.size}\t${f.name ?? f.path}`);
      return;
    }
    case 'read': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, rel] = positional;
      if (!id || !rel) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files read <projectId> <relpath>`);
        process.exit(2);
      }
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`,
        { headers: requestHeaders },
      );
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const buf = Buffer.from(await resp.arrayBuffer());
      process.stdout.write(buf);
      return;
    }
    case 'upload': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, localPath] = positional;
      if (!id || !localPath) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files upload <projectId> <localpath> [--as <relpath>]`);
        process.exit(2);
      }
      const buf = readFileSync(localPath);
      const desiredName = typeof flags.as === 'string' && flags.as.length > 0
        ? flags.as
        : basename(localPath);
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/files`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body:    JSON.stringify({
          name: desiredName,
          content: buf.toString('base64'),
          encoding: 'base64',
        }),
      });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      if (data?.versionWarning?.message) console.error(`[files] warning: ${data.versionWarning.message}`);
      console.log(`[files] uploaded ${data?.file?.name ?? desiredName}`);
      return;
    }
    case 'write': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, rel] = positional;
      if (!id || !rel) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files write <projectId> <relpath> [< stdin]`);
        process.exit(2);
      }
      // Read stdin synchronously into a buffer.
      let chunks = [];
      try {
        const stdin = readFileSync(0);
        chunks = [stdin];
      } catch (err) {
        console.error(`stdin read failed: ${err.message ?? err}`);
        process.exit(1);
      }
      const body = Buffer.concat(chunks);
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/files`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body:    JSON.stringify({
          name: rel,
          content: body.toString('utf8'),
          encoding: 'utf8',
        }),
      });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      if (data?.versionWarning?.message) console.error(`[files] warning: ${data.versionWarning.message}`);
      console.log(`[files] wrote ${data?.file?.name ?? rel}`);
      return;
    }
    case 'delete': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, name] = positional;
      if (!id || !name) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files delete <projectId> <name> [--json]`);
        process.exit(2);
      }
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`,
        { method: 'DELETE', headers: requestHeaders },
      );
      if (!resp.ok) return structuredHttpFailure(resp);
      if (flags.json) {
        const data = await resp.json();
        return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      }
      console.log(`[files] deleted ${name}`);
      return;
    }
    case 'diff': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, relA, relB] = positional;
      const against = typeof flags.against === 'string' ? flags.against : null;
      if (!id || !relA || (!relB && !against) || (relB && against)) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files diff <projectId> <relpathA> [<relpathB> | --against -]`);
        process.exit(2);
      }
      const left = await fetchProjectFileText(base, id, relA, requestHeaders);
      const rightLabel = against ?? relB;
      const right = against === '-'
        ? await readStdinUtf8()
        : await fetchProjectFileText(base, id, rightLabel, requestHeaders);
      const diff = createUnifiedDiff(`a/${relA}`, `b/${rightLabel}`, left, right);
      if (flags.json) return process.stdout.write(JSON.stringify({ diff }, null, 2) + '\n');
      process.stdout.write(diff);
      return;
    }
    case 'versions': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, rel] = positional;
      if (!id || !rel) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files versions <projectId> <relpath>`);
        process.exit(2);
      }
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelpath(rel)}/versions`,
        { headers: requestHeaders },
      );
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const versions = Array.isArray(data?.versions) ? data.versions : [];
      for (const version of versions) {
        const marker = version.current ? '*' : ' ';
        const prompt = typeof version.prompt === 'string' && version.prompt.trim()
          ? version.prompt.trim().replace(/\s+/g, ' ').slice(0, 96)
          : '-';
        const createdAt = Number.isFinite(Number(version.createdAt))
          ? new Date(Number(version.createdAt)).toISOString()
          : '-';
        console.log(`${marker}\tv${version.version ?? '-'}\t${version.source ?? '-'}\t${createdAt}\t${version.id ?? '-'}\t${prompt}`);
      }
      return;
    }
    case 'version-read': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, rel, versionId] = positional;
      if (!id || !rel || !versionId) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files version-read <projectId> <relpath> <versionId>`);
        process.exit(2);
      }
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelpath(rel)}/versions/${encodeURIComponent(versionId)}`,
        { headers: requestHeaders },
      );
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      process.stdout.write(String(data?.content ?? ''));
      return;
    }
    case 'version-create': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, rel] = positional;
      if (!id || !rel) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files version-create <projectId> <relpath> [--prompt <text> | --prompt-file <path|->] [--label <text>] [--source <ai|manual|restore>]`);
        process.exit(2);
      }
      const source = parseProjectFileVersionSourceFlag(flags.source);
      const prompt = await readPromptFromFlags(flags);
      const body = {};
      if (prompt !== null) body.prompt = prompt;
      if (typeof flags.label === 'string' && flags.label.length > 0) body.label = flags.label;
      if (source) body.source = source;
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelpath(rel)}/versions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...requestHeaders },
          body: JSON.stringify(body),
        },
      );
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      console.log(`[files] saved ${rel} as version ${data?.version?.version ?? data?.version?.id ?? '-'}`);
      return;
    }
    case 'version-restore': {
      const positional = positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS);
      const [id, rel, versionId] = positional;
      if (!id || !rel || !versionId) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} files version-restore <projectId> <relpath> <versionId> [--prompt <text> | --prompt-file <path|->]`);
        process.exit(2);
      }
      const prompt = await readPromptFromFlags(flags);
      const body = {};
      if (prompt !== null) body.prompt = prompt;
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelpath(rel)}/versions/${encodeURIComponent(versionId)}/restore`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...requestHeaders },
          body: JSON.stringify(body),
        },
      );
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      if (data?.versionWarning?.message) console.error(`[files] warning: ${data.versionWarning.message}`);
      console.log(`[files] restored ${rel} as version ${data?.version?.version ?? data?.version?.id ?? '-'}`);
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} files ${sub}`);
      process.exit(2);
  }
}

function encodeProjectRelpath(rel) {
  return String(rel).split('/').map(encodeURIComponent).join('/');
}

async function fetchProjectFileText(base, id, rel, headers = {}) {
  const resp = await fetch(
    `${base}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelpath(rel)}`,
    { headers },
  );
  if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('utf8');
}

async function readStdinUtf8() {
  const fs = await import('node:fs');
  return fs.readFileSync(0, 'utf8');
}

async function mintCliImportToken(baseDir) {
  const client = SidecarFactory.connectInherited();
  if (client == null) return null;
  let result;
  try {
    result = await client.invoke(APP_KEYS.DAEMON, SIDECAR_MESSAGES.MINT_IMPORT_TOKEN, { baseDir }, { timeoutMs: 800 });
  } catch {
    return null;
  }
  if (result?.ok === true && typeof result.token === 'string' && result.token.length > 0) {
    return result.token;
  }
  if (result?.ok === false && result.code === 'DESKTOP_AUTH_PENDING') {
    exitWithStructuredError({
      code: 'desktop-auth-pending',
      message: result.message ?? 'desktop auth required but secret not yet registered',
      data: { retryable: result.retryable === true },
    });
  }
  return null;
}

function createUnifiedDiff(leftLabel, rightLabel, leftText, rightText) {
  if (leftText === rightText) return '';
  const leftLines = splitDiffLines(leftText);
  const rightLines = splitDiffLines(rightText);
  let prefix = 0;
  while (
    prefix < leftLines.length
    && prefix < rightLines.length
    && leftLines[prefix] === rightLines[prefix]
  ) {
    prefix++;
  }
  let leftEnd = leftLines.length;
  let rightEnd = rightLines.length;
  while (
    leftEnd > prefix
    && rightEnd > prefix
    && leftLines[leftEnd - 1] === rightLines[rightEnd - 1]
  ) {
    leftEnd--;
    rightEnd--;
  }
  const oldMid = leftLines.slice(prefix, leftEnd);
  const newMid = rightLines.slice(prefix, rightEnd);
  const body = diffLineBody(oldMid, newMid);
  if (body.length === 0) {
    body.push(...oldMid.map((line) => diffLine('-', line)), ...newMid.map((line) => diffLine('+', line)));
  }
  const oldStart = oldMid.length === 0 ? prefix : prefix + 1;
  const newStart = newMid.length === 0 ? prefix : prefix + 1;
  return [
    `--- ${leftLabel}`,
    `+++ ${rightLabel}`,
    `@@ -${formatDiffRange(oldStart, oldMid.length)} +${formatDiffRange(newStart, newMid.length)} @@`,
    ...body,
  ].join('\n') + '\n';
}

function splitDiffLines(text) {
  const value = String(text);
  if (value.length === 0) return [];
  return value.match(/.*?(?:\r\n|\n|\r|$)/gs).filter((line) => line.length > 0);
}

function formatDiffRange(start, length) {
  return length === 1 ? String(start) : `${start},${length}`;
}

function diffLineBody(oldLines, newLines) {
  if (oldLines.length === 0) return newLines.map((line) => diffLine('+', line));
  if (newLines.length === 0) return oldLines.map((line) => diffLine('-', line));
  if (oldLines.length * newLines.length > 1_000_000) {
    return [...oldLines.map((line) => diffLine('-', line)), ...newLines.map((line) => diffLine('+', line))];
  }
  const width = newLines.length + 1;
  const lcs = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(width),
  );
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      out.push(diffLine(' ', oldLines[i]));
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(diffLine('-', oldLines[i]));
      i++;
    } else {
      out.push(diffLine('+', newLines[j]));
      j++;
    }
  }
  while (i < oldLines.length) out.push(diffLine('-', oldLines[i++]));
  while (j < newLines.length) out.push(diffLine('+', newLines[j++]));
  return out;
}

function diffLine(prefix, line) {
  const value = String(line);
  if (value.endsWith('\r\n')) return `${prefix}${renderDiffLineContent(value.slice(0, -1))}`;
  if (value.endsWith('\n')) return `${prefix}${renderDiffLineContent(value.slice(0, -1))}`;
  if (value.endsWith('\r')) return `${prefix}${renderDiffLineContent(value)}`;
  return `${prefix}${renderDiffLineContent(value)}\n\\ No newline at end of file`;
}

function renderDiffLineContent(value) {
  return String(value).replace(/\r/g, '\\r');
}

// `pixo templates …` is the headless face of NewProjectPanel /
// ExamplesTab — same /api/templates store, same DTO shapes. External
// agents (external automation, custom bots) use these to snapshot a
// project as a reusable starting point, list everything the user has
// saved, or drop one that is no longer needed. The web UI and the CLI
// share the daemon HTTP layer so neither can drift out of step.
async function runTemplates(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} templates list                                  List user-saved templates.
  ${PRODUCT_CLI_NAME} templates save  <projectId> --name <name>      Snapshot a project's current
                                                    files as a new template.
                     [--description <text>]
  ${PRODUCT_CLI_NAME} templates delete <id>                          Delete a saved template by id.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
  --json               Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  let flags;
  try {
    flags = parseFlags(rest, { string: TEMPLATES_STRING_FLAGS, boolean: TEMPLATES_BOOLEAN_FLAGS });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const base = (await cliDaemonBaseUrl(flags));
  // Extract positional arguments while stepping past `--flag value`
  // pairs for any string-valued template flag. Without this the id has
  // to be the very first token after the sub-verb, so a headless caller
  // that prefixes shared options (`pixo templates save --daemon-url ...
  // proj-1 --name Cards`) would hit the missing-id usage path before
  // ever reaching the daemon. Mirrors the `positionalArgs` helper in
  // the project commands.
  const positionalArgs = (values) => {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (!value) continue;
      if (value.startsWith('--')) {
        const eq = value.indexOf('=');
        const key = eq >= 0 ? value.slice(2, eq) : value.slice(2);
        if (eq < 0 && TEMPLATES_STRING_FLAGS.has(key)) i++;
        continue;
      }
      if (value.startsWith('-')) continue;
      out.push(value);
    }
    return out;
  };
  switch (sub) {
    case 'list': {
      // Wrap every fetch in try/catch so the user sees a clean
      // "failed to reach daemon at <url>: <code>" error from
      // surfaceFetchError when the daemon isn't running. Without
      // this Node throws a raw `TypeError: fetch failed`, which
      // matches the pattern the rest of the CLI uses
      // (the project verbs and runResearch).
      let resp;
      try {
        resp = await fetch(`${base}/api/templates`);
      } catch (err) {
        surfaceFetchError(err, base);
        process.exit(3);
      }
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const templates = Array.isArray(data?.templates) ? data.templates : [];
      if (templates.length === 0) {
        console.log(`No templates. Save one with \`${PRODUCT_CLI_NAME} templates save <projectId> --name "..."\`.`);
        return;
      }
      for (const t of templates) console.log(`${t.id}\t${t.name}`);
      return;
    }
    case 'save': {
      // Pull <projectId> from anywhere among the positional args
      // (`positionalArgs` already skipped past `--flag value` pairs)
      // so callers can put shared options before or after the id.
      const projectId = positionalArgs(rest)[0] ?? '';
      if (!projectId) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} templates save <projectId> --name <name> [--description <text>]`);
        process.exit(2);
      }
      const name = typeof flags.name === 'string' ? flags.name.trim() : '';
      if (!name) {
        console.error('--name required');
        process.exit(2);
      }
      const body = { name, sourceProjectId: projectId };
      if (typeof flags.description === 'string' && flags.description.length > 0) {
        body.description = flags.description;
      }
      let resp;
      try {
        resp = await fetch(`${base}/api/templates`, {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify(body),
        });
      } catch (err) {
        surfaceFetchError(err, base);
        process.exit(3);
      }
      // Templates POST returns 404 when sourceProjectId is unknown,
      // and 400 for body validation failures (missing name, too-long
      // fields). Both are reachable user errors with the daemon
      // already running, so default-classifying them as
      // `daemon-not-running` would send agents down the wrong recovery
      // branch. Map 404 → project-not-found and 400 → missing-input,
      // keep the default for 5xx so genuine daemon trouble still
      // surfaces as `daemon-not-running`.
      if (!resp.ok) {
        if (resp.status === 404) return structuredHttpFailure(resp, 'project-not-found');
        if (resp.status === 400) return structuredHttpFailure(resp, 'missing-input');
        return structuredHttpFailure(resp);
      }
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const id = data?.template?.id ?? '';
      const savedName = data?.template?.name ?? name;
      console.log(`[templates] saved ${savedName}${id ? ` (${id})` : ''}`);
      return;
    }
    case 'delete': {
      const id = positionalArgs(rest)[0] ?? '';
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} templates delete <id>`);
        process.exit(2);
      }
      let resp;
      try {
        resp = await fetch(`${base}/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (err) {
        surfaceFetchError(err, base);
        process.exit(3);
      }
      // The daemon route `DELETE /api/templates/:id` is intentionally
      // idempotent (returns `{ ok: true }` for unknown ids), so this
      // CLI verb mirrors that contract instead of inventing a
      // template-not-found exit code the production route never emits.
      // Any unexpected non-2xx still falls through to the generic
      // structured-failure envelope.
      if (!resp.ok) return structuredHttpFailure(resp);
      if (flags.json) {
        const data = await resp.json().catch(() => ({ ok: true }));
        return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      }
      console.log(`[templates] deleted ${id}`);
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} templates ${sub}`);
      process.exit(2);
  }
}

async function runConversation(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} conversation new  <projectId> [--title "<title>"] [--seed-from <cid>] [--fork-after <mid>] [--mode chat|plan]
                                           Create a conversation in a project.
                                           --seed-from copies another
                                           conversation's messages in (Side Chat).
                                           --fork-after stops the copy at one
                                           source message.
  ${PRODUCT_CLI_NAME} conversation list <projectId>           List conversations in a project.
  ${PRODUCT_CLI_NAME} conversation info <conversationId>      Print one conversation.
  ${PRODUCT_CLI_NAME} conversation rewind <conversationId> --project <id> --message <messageId> [--keep-files]
                                           Take a conversation back to just before
                                           one of your messages: it and every later
                                           message are removed, and the project's
                                           files go back to before it (unless
                                           --keep-files). Send the edited message
                                           afterwards. Same action as "Edit" on a
                                           sent message.

Common options:
  --daemon-url <url>         OpenPixo daemon HTTP base.
  --json                     Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const conversationStringFlags =
    sub === 'new' || sub === 'list'
      ? PROJECT_RESOURCE_STRING_FLAGS
      : PROJECT_STRING_FLAGS;
  const flags = parseFlags(rest, {
    string: conversationStringFlags,
    boolean: sub === 'rewind' ? new Set([...PROJECT_BOOLEAN_FLAGS, 'keep-files']) : PROJECT_BOOLEAN_FLAGS,
  });
  const base = (await projectDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders =
    sub === 'new' || sub === 'list'
      ? {}
      : {};
  switch (sub) {
    case 'new': {
      const [id] = positionalArgs(rest, conversationStringFlags);
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} conversation new <projectId> [--title "<title>"] [--seed-from <cid>] [--fork-after <mid>]`);
        process.exit(2);
      }
      const body = {};
      if (typeof flags.title === 'string') body.title = flags.title;
      const sessionMode = normalizeChatSessionModeFlag(flags.mode);
      if (sessionMode) body.sessionMode = sessionMode;
      if (typeof flags['seed-from'] === 'string' && flags['seed-from']) {
        body.seedFromConversationId = flags['seed-from'];
      }
      if (typeof flags['fork-after'] === 'string' && flags['fork-after']) {
        if (!body.seedFromConversationId) {
          console.error('--fork-after requires --seed-from');
          process.exit(2);
        }
        body.forkAfterMessageId = flags['fork-after'];
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/conversations`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body:    JSON.stringify(body),
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const conv = data.conversation;
      const mode = conv?.sessionMode ?? sessionMode;
      const modeSuffix = mode === 'chat' || mode === 'plan' ? ` (mode ${mode})` : '';
      console.log(`[conversation] created ${conv?.id ?? '-'}${modeSuffix}`);
      return;
    }
    case 'list': {
      const id = positionalArgs(rest, conversationStringFlags)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} conversation list <projectId>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/conversations`, {
        headers: requestHeaders,
      });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    case 'info': {
      const id = rest.find((a) => !a.startsWith('-'));
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} conversation info <conversationId>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}/api/conversations/${encodeURIComponent(id)}`);
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    case 'rewind': {
      const [cid] = positionalArgs(rest, conversationStringFlags);
      const projectId = typeof flags.project === 'string' ? flags.project : '';
      const messageId = typeof flags.message === 'string' ? flags.message : '';
      if (!cid || !projectId || !messageId) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} conversation rewind <conversationId> --project <id> --message <messageId> [--keep-files] [--json]`);
        process.exit(2);
      }
      const resp = await fetch(
        `${base}/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(cid)}/rewind`,
        {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ fromMessageId: messageId, restoreFiles: !flags['keep-files'] }),
        },
      );
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const files = data.files?.restored
        ? `files restored (${data.files.restoredFiles.length})`
        : `files kept (${data.files?.reason ?? 'unknown'})`;
      console.log(`[conversation] removed ${data.removedMessageIds?.length ?? 0} message(s); ${files}`);
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} conversation ${sub}`);
      process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: pixo chat  (Side Chat — context-seeded conversations)
//
// `pixo chat new --project <id> [--seed-from <cid>] [--fork-after <mid>] [--title "<t>"] [--json]`
//   Creates a new conversation that inherits another conversation's context
//   by copying its messages, optionally truncating at one source message.
//   Mirrors the web chat fork action and POSTs to the same
//   /api/projects/:id/conversations endpoint the UI uses. This is the CLI half
//   of the dual-track surface for context-seeded conversations.
// ---------------------------------------------------------------------------

async function runChat(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} chat new --project <id> [--seed-from <cid>] [--fork-after <mid>] [--title "<title>"] [--mode chat|plan] [--json]
                                           Create a Side Chat — a new conversation
                                           that copies in another conversation's
                                           context (--seed-from). Use
                                           --fork-after to stop at one source
                                           message.

Common options:
  --daemon-url <url>         OpenPixo daemon HTTP base.
  --json                     Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, {
    string: PROJECT_RESOURCE_STRING_FLAGS,
    boolean: PROJECT_BOOLEAN_FLAGS,
  });
  const base = (await projectDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  switch (sub) {
    case 'new': {
      // Accept --project for parity with the rest of the project-scoped CLI,
      // or a bare positional id for convenience.
      const id = typeof flags.project === 'string' && flags.project
        ? flags.project
        : positionalArgs(rest, PROJECT_RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} chat new --project <id> [--seed-from <cid>] [--fork-after <mid>] [--title "<title>"]`);
        process.exit(2);
      }
      const body = {};
      if (typeof flags.title === 'string') body.title = flags.title;
      const sessionMode = normalizeChatSessionModeFlag(flags.mode);
      if (sessionMode) body.sessionMode = sessionMode;
      if (typeof flags['seed-from'] === 'string' && flags['seed-from']) {
        body.seedFromConversationId = flags['seed-from'];
      }
      if (typeof flags['fork-after'] === 'string' && flags['fork-after']) {
        if (!body.seedFromConversationId) {
          console.error('--fork-after requires --seed-from');
          process.exit(2);
        }
        body.forkAfterMessageId = flags['fork-after'];
      }
      const resp = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/conversations`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body:    JSON.stringify(body),
      });
      if (!resp.ok) return structuredHttpFailure(resp, 'project-not-found');
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const conv = data.conversation;
      const seeded = body.seedFromConversationId
        ? ` (seeded from ${body.seedFromConversationId})`
        : '';
      const forked = body.forkAfterMessageId
        ? ` through ${body.forkAfterMessageId}`
        : '';
      const mode = conv?.sessionMode ?? sessionMode;
      const modeSuffix = mode === 'chat' || mode === 'plan' ? ` (mode ${mode})` : '';
      console.log(`[chat] created ${conv?.id ?? '-'}${conv?.title ? ` "${conv.title}"` : ''}${seeded}${forked}${modeSuffix}`);
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} chat ${sub}`);
      process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: pixo daemon  (Phase 1.5 lifecycle, plan §6 / §3.F2)
//
// `pixo daemon start [--headless] [--serve-web] [--port <n>] [--host <addr>]`
//   - --headless: implies --no-open, never tries to launch a browser.
//                 The default `pixo` (no subcommand) keeps its
//                 desktop-friendly behaviour for back-compat.
//   - --serve-web: same as --headless but allows the Next.js bundle to
//                  serve over the existing port. v1 doesn't bundle a
//                  separate web port; the flag is reserved so downstream
//                  packaged callers can branch on it.
//
// `pixo daemon status [--json] [--daemon-url <url>]` calls /api/daemon/status.
// `pixo daemon stop   [--daemon-url <url>]`         calls POST /api/daemon/shutdown.
// ---------------------------------------------------------------------------

async function runDaemon(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} daemon start [--headless] [--serve-web] [--port <n>] [--host <addr>] [--no-open]
                                          Start the daemon (Phase 1.5 headless mode).
  ${PRODUCT_CLI_NAME} daemon status [--json] [--daemon-url <url>]
                                          Print the daemon's runtime snapshot.
  ${PRODUCT_CLI_NAME} daemon stop   [--daemon-url <url>]   Send a graceful shutdown signal.
  ${PRODUCT_CLI_NAME} daemon db     status                 Print SQLite path + size + table row counts.
  ${PRODUCT_CLI_NAME} daemon db     verify [--quick]       Run integrity_check + foreign_key_check.
  ${PRODUCT_CLI_NAME} daemon db     vacuum                 Run SQLite VACUUM to reclaim space after deletes.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
  --headless           No browser auto-open; aliased --no-open.
  --serve-web          Serve the web UI over the existing port (no electron).
  --json               Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, { string: DAEMON_STRING_FLAGS, boolean: DAEMON_BOOLEAN_FLAGS });
  switch (sub) {
    case 'start':   return runDaemonStart(flags);
    case 'status':  return runDaemonStatus(flags);
    case 'stop':    return runDaemonStop(flags);
    case 'db':      return runDaemonDb(rest, flags);
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} daemon ${sub}`);
      process.exit(2);
  }
}

// Plan §3.GG1 — `pixo daemon db status`. Prints a SQLite inventory
// (file path, size on disk, schema version, per-table row counts).
async function runDaemonDb(rest, flags) {
  const sub = rest[0];
  if (!sub || sub === 'help' || rest.includes('--help') || rest.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} daemon db status [--json] [--daemon-url <url>]
  ${PRODUCT_CLI_NAME} daemon db verify [--quick] [--json] [--daemon-url <url>]
  ${PRODUCT_CLI_NAME} daemon db vacuum [--json] [--daemon-url <url>]

status:
  Prints a structured inventory of the daemon's SQLite backend:
    - file path (under .pixo/ by default; PIXO_DATA_DIR overrides)
    - size on disk (primary + WAL + SHM)
    - schema version (user_version PRAGMA)
    - per-table row counts (system tables excluded)

verify:
  Runs SQLite PRAGMA integrity_check (or quick_check with --quick)
  + foreign_key_check, returns a structured issues[] report.
  Exit 0 when ok=true, 4 when any issue is found.

vacuum:
  Runs SQLite VACUUM to reclaim space after large delete batches
  (snapshot prune, plugin uninstall, etc.). Reports before/after
  sizes + elapsed ms.`);
    process.exit(sub ? 0 : 2);
  }
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  if (sub === 'vacuum') {
    const resp = await fetch(`${base}/api/daemon/db/vacuum`, { method: 'POST' });
    if (!resp.ok) {
      console.error(`POST /api/daemon/db/vacuum failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    console.log(`[db vacuum] reclaimed ${formatBytes(data.reclaimedBytes ?? 0)} (`
      + `${formatBytes(data.beforeBytes ?? 0)} \u2192 ${formatBytes(data.afterBytes ?? 0)}, `
      + `${data.elapsedMs ?? 0}ms)`);
    return;
  }
  if (sub === 'verify') {
    const verifyFlags = parseFlags(rest.slice(1), {
      string:  new Set(['daemon-url']),
      boolean: new Set(['help', 'h', 'json', 'quick']),
    });
    const url = `${base}/api/daemon/db/verify${verifyFlags.quick ? '?quick=1' : ''}`;
    const resp = await fetch(url, { method: 'POST' });
    if (!resp.ok) {
      console.error(`POST ${url} failed: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const data = await resp.json();
    if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else {
      const issueCount = Array.isArray(data.issues) ? data.issues.length : 0;
      console.log(`[db verify] mode=${data.mode}  ok=${data.ok}  issues=${issueCount}  ${data.elapsedMs ?? 0}ms`);
      if (issueCount > 0) {
        for (const issue of data.issues) {
          console.error(`  [${issue.kind}] ${issue.message}`);
        }
      }
    }
    process.exit(data.ok ? 0 : 4);
  }
  if (sub !== 'status') {
    console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} daemon db ${sub}`);
    process.exit(2);
  }
  const resp = await fetch(`${base}/api/daemon/db`);
  if (!resp.ok) {
    console.error(`GET /api/daemon/db failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  console.log(`# Daemon DB`);
  console.log(`  kind:           ${data.kind ?? 'unknown'}`);
  console.log(`  location:       ${data.location ?? '?'}`);
  console.log(`  size on disk:   ${formatBytes(data.sizeBytes ?? 0)}`);
  console.log(`  schema version: ${data.schemaVersion ?? '(none)'}`);
  console.log(`  tables:`);
  const tables = Array.isArray(data.tables) ? data.tables : [];
  if (tables.length === 0) {
    console.log('    (none)');
  } else {
    const longest = Math.max(...tables.map((t) => t.name.length));
    for (const t of tables) {
      console.log(`    ${t.name.padEnd(longest)}  ${t.rowCount}`);
    }
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function runDaemonStart(flags) {
  const port = Number(flags.port ?? process.env.PIXO_PORT ?? 7456);
  const host = String(flags.host ?? process.env.PIXO_BIND_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  const headless = Boolean(flags.headless || flags['no-open'] || flags['serve-web']);
  const runtime = await startDaemonRuntime({
    host,
    logListening: false,
    openBrowser: !headless,
    port,
  });
  console.log(`[pixo] listening on ${runtime.url} (${headless ? 'headless' : 'desktop'})`);

  await new Promise((resolve) => {
    let shuttingDown = false;
    const stop = () => {
      if (shuttingDown) process.exit(0);
      shuttingDown = true;
      void runtime.stop().finally(() => {
        cleanup();
        resolve();
      });
    };
    const cleanup = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

async function runDaemonStatus(flags) {
  const base = await cliDaemonBaseUrl(flags);
  let resp;
  try {
    resp = await fetch(`${base}/api/daemon/status`);
  } catch (err) {
    return exitWithStructuredError({
      code:    'daemon-not-running',
      message: `Cannot reach daemon at ${base}: ${err?.message ?? err}`,
    });
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const data = await resp.json();
  if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  console.log(`[daemon] ${data.bindHost}:${data.port} v${data.version} pid=${data.pid} plugins=${data.installedPlugins}`);
}

async function runDaemonStop(flags) {
  const base = await cliDaemonBaseUrl(flags);
  let resp;
  try {
    resp = await fetch(`${base}/api/daemon/shutdown`, { method: 'POST' });
  } catch (err) {
    return exitWithStructuredError({
      code:    'daemon-not-running',
      message: `Cannot reach daemon at ${base}: ${err?.message ?? err}`,
    });
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  console.log(`[daemon] shutdown scheduled`);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo atoms / pixo skills / pixo status
//
// Resource and status introspection
// CLI parity. Every UI feature reachable via /api/* gets a CLI mirror
// (the §11.7 "headless = canonical" invariant).
// ---------------------------------------------------------------------------

async function runResourceList(name, args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} ${name} list           List ${name}.
  ${PRODUCT_CLI_NAME} ${name} show <id>      Print one entry.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, { string: RESOURCE_STRING_FLAGS, boolean: RESOURCE_BOOLEAN_FLAGS });
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  const apiPath = `/api/${name}`;
  const requestHeaders = name === 'skills'
    ? {}
    : undefined;
  switch (sub) {
    case 'list': {
      const resp = await fetch(`${base}${apiPath}`, {
        ...(requestHeaders
          ? { headers: requestHeaders }
          : {}),
      });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      const rows = data?.[name] ?? [];
      for (const row of rows) {
        const label = row.title ?? row.name ?? row.id ?? row.label;
        console.log(`${row.id}\t${label}`);
      }
      return;
    }
    case 'show': {
      const id = positionalArgs(rest, RESOURCE_STRING_FLAGS)[0];
      if (!id) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} ${name} show <id>`);
        process.exit(2);
      }
      const resp = await fetch(`${base}${apiPath}/${encodeURIComponent(id)}`, {
        ...(requestHeaders
          ? { headers: requestHeaders }
          : {}),
      });
      if (!resp.ok) return structuredHttpFailure(resp);
      const data = await resp.json();
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} ${name} ${sub}`);
      process.exit(2);
  }
}

// `pixo skills` lists; `pixo skills uninstall <id>` removes a user-installed skill.
// The uninstall arm exists because the Extensions page grew a 卸载 action, and a
// capability that only one surface can reach is not shippable (AGENTS.md,
// "Capability exposure (UI/CLI dual-track)"). Bundled skills are refused by the
// route, not here — the daemon owns that judgement.
async function runSkills(args) {
  if (!args[0] || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} skill install <https://github.com/owner/repo|github:owner/repo|https://…tar.gz|https://…tgz> [--json]
  ${PRODUCT_CLI_NAME} skill list
  ${PRODUCT_CLI_NAME} skill show <id>
  ${PRODUCT_CLI_NAME} skill uninstall <id>

\`${PRODUCT_CLI_NAME} skills …\` remains an alias for compatibility.`);
    process.exit(args[0] ? 0 : 2);
  }
  if (args[0] === 'install' || args[0] === 'add') return runSkillInstall(args.slice(1));
  if (args[0] === 'uninstall' || args[0] === 'remove') return runSkillUninstall(args.slice(1));
  return runResourceList('skills', args);
}

async function runSkillInstall(rest) {
  const flags = parseFlags(rest, {
    string: RESOURCE_STRING_FLAGS,
    boolean: RESOURCE_BOOLEAN_FLAGS,
  });
  const source = positionalArgs(rest, RESOURCE_STRING_FLAGS)[0];
  if (!source) {
    console.error(
      `Usage: ${PRODUCT_CLI_NAME} skill install <https://github.com/owner/repo|github:owner/repo|https://…tar.gz|https://…tgz> [--json] [--daemon-url <url>]`,
    );
    process.exit(2);
  }
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  try {
    const resp = await fetch(`${base}/api/skills/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...requestHeaders },
      body: JSON.stringify({ source }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = body?.error ?? `Skill install failed (${resp.status})`;
      if (flags.json) {
        console.log(JSON.stringify({
          ok: false,
          status: resp.status,
          code: body?.code ?? null,
          error: message,
        }));
      } else {
        console.error(`POST /api/skills/install failed: ${resp.status} ${message}`);
      }
      process.exit(1);
    }
    if (flags.json) return process.stdout.write(JSON.stringify(body, null, 2) + '\n');
    console.log(`[install] ${body?.skill?.id ?? body?.skill?.name ?? source}`);
  } catch (err) {
    surfaceFetchError(err, base);
    process.exit(3);
  }
}

async function runSkillUninstall(rest) {
  const flags = parseFlags(rest, { string: RESOURCE_STRING_FLAGS, boolean: RESOURCE_BOOLEAN_FLAGS });
  const id = positionalArgs(rest, RESOURCE_STRING_FLAGS)[0];
  if (!id) {
    console.error(`Usage: ${PRODUCT_CLI_NAME} skills uninstall <id> [--json] [--daemon-url <url>]`);
    process.exit(2);
  }
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  const requestHeaders = {};
  const resp = await fetch(`${base}/api/skills/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: requestHeaders,
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (flags.json) {
      console.log(JSON.stringify({ ok: false, id, status: resp.status, error: body?.error ?? null }));
    } else {
      console.error(`DELETE /api/skills/${id} failed: ${resp.status} ${body?.error ?? ''}`.trim());
    }
    process.exit(1);
  }
  if (flags.json) console.log(JSON.stringify({ ok: true, id }));
  else console.log(`[uninstall] ${id} removed`);
}

async function runStatus(args) {
  // Alias of `pixo daemon status`.
  return runDaemon(['status', ...args]);
}

// ---------------------------------------------------------------------------
// Subcommand: pixo diagnostics export <path> [--json]
//
// CLI surface for the Settings → About “Export diagnostics” feature. The
// daemon already exposes the bundle behind a local-loopback HTTP endpoint;
// this command is a thin shell over that endpoint so headless callers (CI,
// `pixo doctor` follow-ups, shell scripts) can collect a support bundle
// without driving the web UI.
// ---------------------------------------------------------------------------

async function runDiagnostics(args) {
  const sub = args[0];
  if (!sub || sub === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} diagnostics export [<path>] [--output <path>] [--json] [--daemon-url <url>]

Bundles daemon/web/desktop logs, machine info, and recent crash reports
into a zip. The bundle is the same one Settings → About → Export
diagnostics produces.

  <path>                 Where to write the zip. Defaults to
                         ./openpixo-diagnostics-<timestamp>.zip in the
                         current working directory. Alias: --output <path>.
  --json                 Print {path, sizeBytes} on stdout instead of a
                         human-readable summary. The file is still written
                         to <path>.
  --daemon-url <url>     Override the daemon HTTP base URL.`);
    process.exit(0);
  }
  if (sub !== 'export') {
    console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} diagnostics ${sub}`);
    process.exit(2);
  }

  const flags = parseFlags(args.slice(1), {
    string: DIAGNOSTICS_STRING_FLAGS,
    boolean: DIAGNOSTICS_BOOLEAN_FLAGS,
  });
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');

  const { DIAGNOSTICS_EXPORT_PATH, DIAGNOSTICS_FILENAME_PREFIX, diagnosticsFileName } =
    await import('@openpixo/diagnostics');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const explicitOutput = typeof flags.output === 'string' && flags.output.length > 0
    ? flags.output
    : positional[0];
  const targetPath = path.resolve(explicitOutput ?? diagnosticsFileName(DIAGNOSTICS_FILENAME_PREFIX));

  let resp;
  try {
    resp = await fetch(`${base}${DIAGNOSTICS_EXPORT_PATH}`);
  } catch (err) {
    return exitWithStructuredError({
      code:    'daemon-not-running',
      message: `Cannot reach daemon at ${base}: ${err?.message ?? err}`,
    });
  }
  if (!resp.ok) return structuredHttpFailure(resp);

  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buf);

  if (flags.json) {
    process.stdout.write(JSON.stringify({ path: targetPath, sizeBytes: buf.length }) + '\n');
    return;
  }
  console.log(`Wrote diagnostics bundle to ${targetPath} (${buf.length} bytes).`);
}

async function runVersion(args) {
  const flags = parseFlags(args, { string: RESOURCE_STRING_FLAGS, boolean: RESOURCE_BOOLEAN_FLAGS });
  if (flags.help || flags.h) {
    console.log(`Usage: ${PRODUCT_CLI_NAME} version [--json] [--daemon-url <url>]
Print the version reported by the local daemon.`);
    return;
  }
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  let resp;
  try {
    resp = await fetch(`${base}/api/version`);
  } catch (err) {
    return exitWithStructuredError({
      code:    'daemon-not-running',
      message: `Cannot reach daemon at ${base}: ${err?.message ?? err}`,
    });
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const data = await resp.json();
  if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  const version = typeof data?.version === 'string'
    ? data.version
    : (data?.version?.version ?? JSON.stringify(data));
  console.log(version);
}

// `pixo whats-new` — CLI mirror of the home-surface post-update highlights
// card. Prints the current hand-curated "what's new" highlight (or a note
// when there is none right now), from the same /api/whats-new endpoint the
// web UI reads.
async function runWhatsNew(args) {
  const flags = parseFlags(args, { string: RESOURCE_STRING_FLAGS, boolean: RESOURCE_BOOLEAN_FLAGS });
  if (flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} whats-new [--json]   Print the current release highlight, if any.`);
    process.exit(0);
  }
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  let resp;
  try {
    resp = await fetch(`${base}/api/whats-new`);
  } catch (err) {
    return exitWithStructuredError({
      code:    'daemon-not-running',
      message: `Cannot reach daemon at ${base}: ${err?.message ?? err}`,
    });
  }
  if (!resp.ok) return structuredHttpFailure(resp);
  const data = await resp.json();
  if (flags.json) return process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  console.log(`OpenPixo ${data?.version ?? 'unknown'}`);
  if (data?.content != null) {
    console.log(`\n${data.content.title}\n${data.content.body}`);
    if (data.content.linkUrl) console.log(`\nDetails: ${data.content.linkUrl}`);
  } else {
    console.log(`\nNo release highlights right now.`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: pixo doctor / pixo config (Phase 4 CLI parity tail).
//
// Plan §3.I2 / spec §12.2.
//
// `pixo doctor` — repo-wide diagnostics. Hits /api/daemon/status, lists
// installed plugins + runs the per-plugin doctor, lists skills /
// skills / atoms. Exits non-zero when any plugin
// doctor returns ok=false. Useful in CI: a failed exit causes the
// pipeline to surface plugin-system regressions.
//
// `pixo config get/set/list/unset` — wraps GET/PUT /api/app-config so a
// code agent can flip provider keys / orbit settings / pet config
// without leaving the terminal. JSON values pass through unchanged;
// scalar strings/numbers/booleans are coerced.
// ---------------------------------------------------------------------------

async function runDoctor(args) {
  const flags = parseFlags(args, { string: CONFIG_STRING_FLAGS, boolean: CONFIG_BOOLEAN_FLAGS });
  if (flags.help || flags.h) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} doctor [--json]   Print a daemon + plugin + resource health summary.

Exit code is non-zero when any installed plugin's doctor returns ok=false
or the daemon cannot be reached.`);
    process.exit(0);
  }
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');
  const report = {
    daemon:        null,
    plugins:       [],
    skills:        [],
    issues:        [],
  };

  // Daemon status
  try {
    const resp = await fetch(`${base}/api/daemon/status`);
    if (!resp.ok) {
      report.issues.push({ severity: 'error', code: 'daemon-status', message: `HTTP ${resp.status}` });
    } else {
      report.daemon = await resp.json();
    }
  } catch (err) {
    report.issues.push({ severity: 'error', code: 'daemon-not-running', message: String(err?.message ?? err) });
    if (flags.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      console.error('[doctor] daemon unreachable:', String(err?.message ?? err));
    }
    process.exit(64);
  }

  // Skill and atom inventory
  try {
    const [skillsResp, atomsResp] = await Promise.all([
      fetch(`${base}/api/skills`),
      fetch(`${base}/api/atoms`),
    ]);
    if (skillsResp.ok) {
      const data = await skillsResp.json();
      report.skills = data?.skills ?? [];
    }
    if (atomsResp.ok) {
      const data = await atomsResp.json();
      report.atoms = data?.atoms ?? [];
    }
  } catch (err) {
    report.issues.push({ severity: 'warn', code: 'resource-list-failed', message: String(err?.message ?? err) });
  }

  // Plugin doctor — runs the daemon's per-plugin check on every install.
  try {
    const listResp = await fetch(`${base}/api/plugins`);
    if (listResp.ok) {
      const list = await listResp.json();
      const plugins = list?.plugins ?? [];
      for (const p of plugins) {
        try {
          const doctorResp = await fetch(`${base}/api/plugins/${encodeURIComponent(p.id)}/doctor`, { method: 'POST' });
          const data = await doctorResp.json().catch(() => ({}));
          report.plugins.push({ id: p.id, version: p.version, ok: !!data?.ok, issues: data?.issues ?? [] });
          if (!data?.ok) {
            report.issues.push({
              severity: 'error',
              code:     'plugin-doctor-failed',
              message:  `${p.id}@${p.version}: ${(data?.issues ?? []).map((i) => i.code).join(', ')}`,
            });
          }
        } catch (err) {
          report.issues.push({
            severity: 'warn',
            code:     'plugin-doctor-error',
            message:  `${p.id}: ${err?.message ?? err}`,
          });
        }
      }
    }
  } catch (err) {
    report.issues.push({ severity: 'warn', code: 'plugin-list-failed', message: String(err?.message ?? err) });
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`[doctor] daemon ${report.daemon?.bindHost ?? '?'}:${report.daemon?.port ?? '?'} pid=${report.daemon?.pid ?? '?'}`);
    console.log(`[doctor] plugins: ${report.plugins.length} (skills ${report.skills.length}, atoms ${report.atoms.length})`);
    if (report.issues.length === 0) {
      console.log('[doctor] no issues');
    } else {
      for (const i of report.issues) {
        console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
      }
    }
  }
  const hasError = report.issues.some((i) => i.severity === 'error');
  process.exit(hasError ? 1 : 0);
}

async function runConfig(args) {
  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  ${PRODUCT_CLI_NAME} config list                      Print the full app config as JSON.
  ${PRODUCT_CLI_NAME} config get <key>                 Print one top-level key.
  ${PRODUCT_CLI_NAME} config set <key> <value>         Set a top-level key (string / number / boolean).
  ${PRODUCT_CLI_NAME} config set <key> --value-json '<json>'
                                       Set a key to a JSON value.
  ${PRODUCT_CLI_NAME} config unset <key>               Remove a top-level key.
  ${PRODUCT_CLI_NAME} config set agentImageModel <id|${AGENT_IMAGE_MODEL_AUTOMATIC}>
                                       The image model the agent makes art with; ids from
                                       \`${PRODUCT_CLI_NAME} media image-models\`.

Common options:
  --daemon-url <url>   OpenPixo daemon HTTP base.
  --json               Emit raw JSON.`);
    process.exit(args.length === 0 ? 2 : 0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest, { string: CONFIG_STRING_FLAGS, boolean: CONFIG_BOOLEAN_FLAGS });
  const base = (await cliDaemonUrl(flags)).replace(/\/$/, '');

  const fetchConfig = async () => {
    const resp = await fetch(`${base}/api/app-config`);
    if (!resp.ok) return structuredHttpFailure(resp);
    const data = await resp.json();
    return data?.config ?? {};
  };
  const writeConfig = async (next) => {
    const resp = await fetch(`${base}/api/app-config`, {
      method:  'PUT',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(next),
    });
    if (!resp.ok) return structuredHttpFailure(resp);
    return (await resp.json())?.config ?? next;
  };

  switch (sub) {
    case 'list': {
      const cfg = await fetchConfig();
      process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
      return;
    }
    case 'get': {
      const key = rest.find((a) => !a.startsWith('-'));
      if (!key) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} config get <key>`);
        process.exit(2);
      }
      const cfg = await fetchConfig();
      const value = cfg?.[key];
      if (flags.json) {
        process.stdout.write(JSON.stringify(value ?? null, null, 2) + '\n');
      } else {
        console.log(value === undefined ? '' : (typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
      }
      return;
    }
    case 'set': {
      const positional = rest.filter((a) => !a.startsWith('-')
        && a !== flags.value
        && a !== flags['value-json']);
      const [key, scalarValue] = positional;
      if (!key) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} config set <key> <value> | ${PRODUCT_CLI_NAME} config set <key> --value-json <json>`);
        process.exit(2);
      }
      let parsed;
      if (typeof flags['value-json'] === 'string') {
        try { parsed = JSON.parse(flags['value-json']); } catch (err) {
          console.error(`--value-json must be valid JSON: ${err.message}`);
          process.exit(2);
        }
      } else if (typeof flags.value === 'string') {
        parsed = coerceCliValue(flags.value);
      } else if (scalarValue !== undefined) {
        parsed = coerceCliValue(scalarValue);
      } else {
        console.error('Provide a value (positional, --value, or --value-json).');
        process.exit(2);
      }
      const cfg = await fetchConfig();
      const next = { ...cfg, [key]: parsed };
      const written = await writeConfig(next);
      if (flags.json) {
        process.stdout.write(JSON.stringify(written, null, 2) + '\n');
      } else {
        console.log(`[config] set ${key}`);
      }
      return;
    }
    case 'unset': {
      const key = rest.find((a) => !a.startsWith('-'));
      if (!key) {
        console.error(`Usage: ${PRODUCT_CLI_NAME} config unset <key>`);
        process.exit(2);
      }
      const cfg = await fetchConfig();
      const next = { ...cfg };
      delete next[key];
      const written = await writeConfig(next);
      if (flags.json) {
        process.stdout.write(JSON.stringify(written, null, 2) + '\n');
      } else {
        console.log(`[config] unset ${key}`);
      }
      return;
    }
    default:
      console.error(`unknown subcommand: ${PRODUCT_CLI_NAME} config ${sub}`);
      process.exit(2);
  }
}
