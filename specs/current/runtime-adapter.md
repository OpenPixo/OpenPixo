# Runtime adapter current state

OpenPixo ships Codex, Claude Code, OpenCode and BYOK OpenCode. The authoritative
runtime inventory, invocation notes and protocol ownership live in
[`docs/agent-adapters.md`](../../docs/agent-adapters.md). The registry contains
only those definitions; the test harness may register its mock agent separately.

Runtime definitions declare executable discovery, model/auth probes, invocation,
stream parsing, MCP integration and session-continuity facts. Shared daemon
services own the run lifecycle. A removed saved agent preference falls back
before a run starts without changing the stored configuration; a failed run
does not switch agent families automatically.

The retained transports are Claude stream-json, OpenCode/Codex JSON events and
Codex app-server JSON-RPC. Runtime tools write canonical project files. BYOK
provider configuration delegates the model/tool loop to OpenCode, including
DeepSeek and OpenRouter providers.

Project skills, MCP, approvals, interruption and continuation follow the
[`Phase 2 specification`](openpixo-phase2-multi-agent.md). Prompt composition
uses the shared game path documented in
[`docs/prompt-composition.md`](../../docs/prompt-composition.md).

Validation uses focused parser/session/selection tests and recorded mock CLI
replays. Preserve the real Claude CLI recordings. Each physical run starts
through `internalRunCreation.start` with an explicit analytics argument.
Daemon paths follow the root [`AGENTS.md`](../../AGENTS.md) data-directory contract.
