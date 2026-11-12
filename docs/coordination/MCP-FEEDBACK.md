# MCP connection feedback audit

Updated 2026-10-25 (Asia/Tokyo). Frozen requirement:
FIRST-RELEASE-SCOPE.md (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`), “MCP 由 Codex 使用，提供配置、依赖检测、缺失引导和连接反馈”.

## Dependency checks and connection feedback are separate

| Signal | Meaning |
| --- | --- |
| Extension dependency `missing` | Required configuration, supported transport, or the stdio executable is missing. |
| Extension dependency `ready` | The stdio command was found. This does **not** establish package installation, authentication, MCP initialization, or tool success. |
| Extension dependency `unknown` | HTTP configuration is present; connection has not been checked by this dependency inspection. |
| Native MCP startup `ready` | Codex reports that this server finished startup in this task's session. It does **not** establish a successful tool task or lasting availability. |
| Native MCP startup `failed` / `cancelled` | Codex reported that startup failed or was cancelled. This is feedback about that server, not an automatic failure of unrelated code work. |
| MCP `tool_result` | The outcome of an actual tool call; distinct from startup. |

The initial audit found a real gap: MCP tool calls and generic warnings already
had mappings, but `mcpServer/startupStatus/updated` was discarded as unknown.
Generic warning rows are also deliberately hidden by the existing chat UI, so
the previous “normal tool stream supplies connection failures” statement was
insufficient evidence for the frozen connection-feedback requirement.

## Delivered correction

- `agent-protocol/codex-app-server/normalize.ts` maps the native notification to
  the existing `status` event with `label: mcp_connection` and diagnostic detail
  limited to server name, native state, error text, and failure reason.
  Starting, ready, failed, cancelled, and reauthentication-required feedback are
  retained. Unknown states do not invent a connection result.
- The server-state map belongs to one normalizer/session. Nullable-thread
  notifications stay on that run's callback; explicit foreign thread IDs pass
  through the existing root-thread filter. No global connection registry was
  added. Aggregating each server's latest state prevents chat's consecutive
  status coalescing from hiding one server's failure when another becomes ready.
- Per the user's 2026-10-25 direction, chat hides `mcp_connection` startup
  diagnostics entirely, including summaries, counts and error details, in
  both live and reopened messages. This replaces the collapsed-summary UI.
  Runtime events and CLI diagnostics retain the original feedback.
  Existing warning/error suppression remains in place.
- The same feedback is available through `GET /api/runs/:id/events` and the
  existing `pixo run watch <runId>` JSON event stream. No new endpoint or CLI
  execution engine is needed.
- Only named notification fields enter feedback. Known secret patterns are
  scrubbed before the normalizer stores detail. The run output boundary also
  scrubs exact provider credentials, credential-named MCP environment values,
  and nonstandard MCP header values from display text while retaining native
  correlation IDs and control values. Configuration objects are not logged as
  feedback. This is the existing lexical/exact-value protection, not a claim
  that arbitrary business text can be recognized as secret.

The audit also removed the pre-existing process-list exposure of project MCP
configuration. `runtimes/codex-project-mcp.ts` returns structured
`config.mcp_servers` for native `thread/start` and `thread/resume`; runtime_core
owns the session/server wiring. Enabled project MCP configuration is absent
from app-server argv. The operator-only `exec-json` rollback explicitly refuses
enabled project MCP with guidance to use app-server, rather than serializing
configuration or possible credentials into argv.

## Native evidence, without model calls

The installed npm binary identified itself as **codex-cli 0.160.0**. Its own
generated TypeScript declares the notification payload:
`threadId: string | null`, `name`, `status`, `error: string | null`, and
`failureReason: "reauthenticationRequired" | null`; the state enum is
`starting | ready | failed | cancelled`. The protocol guard now checks these
identifiers and literals.

Native recordings are committed under
`apps/daemon/tests/fixtures/codex-app-server/`; their
[recording notes](../../apps/daemon/tests/fixtures/codex-app-server/MCP-RECORDINGS.md)
explain their scope. The isolated probes produced:

| Probe | Observed result |
| --- | --- |
| Deliberately nonexistent local executable | Native `starting → failed`, with Windows error 2. |
| Reviewed `e2e/resources/openpixo-mcp.ts` fixture | Native `starting → ready` after MCP initialization. |
| MCP supplied solely in `thread/start.config` | Native ready and a fixture receipt confirming the start-specific environment marker was consumed; argv contained no MCP config. |
| MCP supplied solely in `thread/resume.config` with explicit in-memory history | Native ready and a receipt confirming the resume-specific environment marker was consumed; argv contained no MCP config. |

All probes used disposable isolated Codex homes and sent **zero `turn/start`
requests**. They did not call a model, load user Codex configuration, or start
arbitrary user servers. Scratch evidence is retained under
`.tmp/mcp-feedback-native/`, `.tmp/mcp-feedback-native-ready/`, and
`.tmp/mcp-rpc-config-native/`; all are ignored local evidence, not daemon data
path conventions. Daemon-managed paths follow root
[AGENTS.md](../../AGENTS.md), **Daemon data directory contract**.

The resume probe proves native consumption of that RPC's configuration using
the supported in-memory-history path, which creates a native thread. It does
**not** prove continuation of a real disk-backed game session. An empty new
thread has no disk rollout, so its initial `no rollout` response was a probe
setup limitation and was not treated as a product defect.

## Focused verification and limits

- Final daemon selection: **7 files, 76 tests passed** (notification replay,
  existing normalization/parity/protocol guard, structured config, argv policy,
  and the real daemon startup route using fake native Codex).
- The production startup regression proves: project skill/config injection;
  stdio environment and HTTP header preservation in RPC; no MCP config or dummy
  credentials in argv; visible MCP failure in replayed SSE; successful run
  completion after an explicit approval; short credential removal; and exact
  thread/turn/item IDs despite `DEBUG=1`.
- Historical rendering selection before the user's hide-MCP decision: **2 files, 3 tests passed**. A failed MCP remained
  visible during streaming and on completed successful messages, including
  when another server is ready; existing raw error-row suppression still holds.
- Daemon source/test typecheck and web typecheck: **passed**. The initial
  production attempt used global Node 26 in pnpm's child and failed SQLite's
  ABI check; pinning the full child PATH to workspace Node 24 fixed the setup.
  Five strict optional-index assertions in new fixtures were corrected before
  the final passing daemon typecheck.

This closes deterministic startup-feedback and private-RPC wiring evidence.
It does not assert real paid-provider work, real-game MCP tool participation,
HTTP authentication across third-party servers, or packaged release acceptance.
No full daemon/web suites, paid models, commit, publication, or packaging were
performed for this audit. Repository-wide final guard/typecheck and integrated
acceptance remain with the orchestrator.
