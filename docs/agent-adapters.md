# Agent adapters

OpenPixo delegates the model and tool loop to Codex, Claude Code or OpenCode.
The daemon resolves the executable, supplies the game prompt and project working
directory, and streams normalized events to the web UI and `pixo` CLI. BYOK uses
OpenCode for the same loop, including filesystem tools.

Related contracts: [architecture](architecture.md), [prompt composition](prompt-composition.md),
[skills](skills-protocol.md), [execution modes](modes.md).

## Runtime definitions and detection

`apps/daemon/src/runtimes/types.ts` defines `RuntimeAgentDef`. Definitions are
data and invocation builders; shared runtime modules own detection, launching,
parsing, cancellation and session recovery. `runtimes/registry.ts` is the source
of truth for the shipped registry:

| Definition | Runtime | Transport |
| --- | --- | --- |
| `defs/codex.ts` | Codex | Native app-server JSON-RPC; optional exec JSON |
| `defs/claude.ts` | Claude Code | Claude stream-json |
| `defs/opencode.ts` | OpenCode | OpenCode JSON events |
| `defs/byok-opencode.ts` | BYOK OpenCode | OpenCode JSON events |

`agents.ts` is a public re-export barrel. `detection.ts`, `executables.ts`,
`resolution.ts`, `launch.ts`, `invocation.ts`, `models.ts` and `capabilities.ts`
own the corresponding runtime facts. Detection probes the same launch target
that execution uses, isolates probe failures, and publishes availability,
version, authentication diagnostics, models and their source. The streaming
`GET /api/agents?stream=1` response emits each result as its probe settles.

Only these runtimes are selectable. A saved preference naming a removed runtime
must resolve to an available supported runtime, or the normal no-agent state.
Reading the preference does not migrate or delete the user's saved configuration.
This pre-run selection fallback does not retry a failed run with another agent.

## Claude Code

Claude uses `-p --input-format stream-json --output-format stream-json --verbose`.
The composed prompt is one JSONL user message. Stdin remains open for
`POST /api/runs/:id/steer`, then closes after a clean terminal turn boundary;
a mid-tool `tool_use` stop reason does not close it. Native sessions continue
with the CLI's session flags.

`runtimes/claude-stream.ts` translates text, thinking, tool calls, results,
usage and terminal state. Real CLI recordings in
`apps/daemon/tests/fixtures/claude-cli-recordings/` are the protocol evidence.
The root [agent runtime conventions](../AGENTS.md#agent-runtime-conventions)
describe partial-message boundaries and sub-agent exclusions.

Run-scoped MCP configuration supplies project and global extensions without
writing into an imported project's repository. Application approvals use the
existing run approval endpoints and Claude approval MCP integration, gated by
the CLI's advertised flags. Clarifying questions use the shared `<question-form>`
artifact, not a native tool-result answer path.

## Codex

The default transport launches the installed CLI's built-in `codex app-server`
over stdio JSON-RPC. New sessions use `thread/start`; later turns resume the
thread and send `turn/start`. Codex approvals and project MCP configuration use
the existing native RPC integration.

Early file previews use `item/fileChange/patchUpdated`. The daemon enables
`features.apply_patch_streaming_events` only for a stable server version at
least 0.123.0. Older, unknown and prerelease versions keep completed-file
behavior. See [patch-stream validation](testing/codex-patch-streaming.md).

`PIXO_CODEX_TRANSPORT=exec-json` selects `codex exec --json`. Its JSON parser
captures `thread.started.thread_id`; subsequent turns use `codex exec resume`.
Resume does not receive create-only `--sandbox`, `-C` or `--add-dir` flags.
Detection retains authentication and live-model probes with fallback model hints.

## OpenCode and BYOK

OpenCode runs with `run --format json` and the prompt on stdin. The adapter
discovers models, parses JSON events and captures the native session ID for
later turns. Bundled OpenCode remains a supported executable source.
Run-scoped `OPENCODE_CONFIG_CONTENT` supplies project/global MCP, directory
permissions and provider configuration.

`byok-opencode` shares this execution path. Provider credentials and model
selection become OpenCode configuration; OpenCode still owns model calls,
filesystem operations and tool execution. DeepSeek, OpenRouter and other
configured API providers remain available through this path. They are provider
choices, not additional CLI runtimes. See [headless BYOK](headless-byok.md).

Permission behavior and unsupported approval capabilities are declared by the
runtime; the UI must report those facts rather than imply uniform sandboxing.
The project cwd is the execution root, and explicitly allowed external
directories can widen access. Codex sandbox choices and CLI/provider policy
remain effective as implemented by their runtime helpers.

## Shared prompt, files and run lifecycle

Every runtime receives `composeOpenPixoGamePrompt`, the resolved project cwd,
enabled skills, extension inputs, engine/media guidance and conversation
context. Selected skills are staged as project-private copies where possible;
their bodies and read-only side-file guidance enter the same prompt. See
[prompt composition](prompt-composition.md) for the host protocols.

`claude-stream.ts`, `json-event-stream.ts` and the Codex app-server helpers
normalize the retained transports into run events. Runtime tools write project
files; the watcher, asset index and file workspace deliver the results. Missing
thinking, tool or usage data stays absent rather than becoming invented values.

Every physical run starts through `internalRunCreation.start(run, analytics,
starter)`. The run service owns persistence, SSE, cancellation, retries,
approvals and analytics. `<question-form>` detection continues to feed
`run_finished.asked_user_question` independently of the selected runtime.
Native-session recovery may reseed a stale session within the same runtime;
it does not silently change agent families.

Daemon data paths follow the root
[data directory contract](../AGENTS.md#daemon-data-directory-contract).
Replay the retained mock CLI recordings for parser changes; see
[`mocks/README.md`](../mocks/README.md). No live provider is needed for those checks.
