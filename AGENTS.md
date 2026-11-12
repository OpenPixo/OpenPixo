# Directory guide

This file is the single source of truth for agents entering this repository. Read this file first; after entering `apps/`, `packages/`, `tools/`, or `e2e/`, read that layer's `AGENTS.md` for module-level details. Do not copy module details back into the root file; root stays focused on cross-repository boundaries, workflow, and commands.

## Product and fork status

- Maintainer notes: plans, delivery status, the release runbook and the session handoff are kept outside this repository. If a `CLAUDE.local.md` exists next to this file, read what it points to before starting work; never copy those notes into this repository. References written as `openpixo-internal/...` point to those notes.
- This repository is **OpenPixo**, a local agent workbench for independent game developers. It is a full hard fork of `nexu-io/open-design` at `9724c44142ea0afaee3d207f37901b31c66a44ad` (0.25.1); see `docs/adr/0006-full-hard-fork.md`. Do not merge or rebase onto upstream; port upstream fixes by hand when they matter.
- Workspace packages use `@openpixo/*` and the root package is `openpixo` (ADR 0009). Runtime identifiers follow ADR 0010. The CLI binary is `pixo` (ADR 0008). The completed naming migration and regression policy follow `docs/adr/0011-remove-upstream-identifiers.md`. Public product naming comes from `packages/contracts/src/product.ts`.
- Retired design strategy, the design-system/brand resource domain, stock search, cloud/AMR, team collaboration, billing and cloud publication have been deleted. Local skill discovery lives in `apps/daemon/src/services/skill-catalog.ts`; local single-user project access lives in `apps/daemon/src/projects/project-access.ts`. Product surface switches have been removed. See [ADR 0012](docs/adr/0012-slim-core.md) for the current boundary and `docs/coordination/PHASE1-REMOVAL.md` for earlier removal evidence. The catalogue review is complete: ship only game resources and dependencies of recipes, Studio, the Store snapshot and asset tools. The retained inventory and family rules are in `docs/coordination/PHASE1-CATALOG-REVIEW.md`. Do not extend inherited surfaces for new OpenPixo work.

## Core documentation index

- Product and onboarding: `README.md`, `README.zh-CN.md`, `QUICKSTART.md`.
- Contribution and environment: `CONTRIBUTING.md`, `docs/i18n/CONTRIBUTING.zh-CN.md`, `docs/windows-troubleshooting.md`, `docs/RUNNING.md`.
- Architecture and protocols: `docs/architecture.md`, `docs/skills-protocol.md`, `docs/agent-adapters.md`, `docs/modes.md`.
- References and current plans: `docs/references.md`, `docs/code-review-guidelines.md`, `specs/current/maintainability-roadmap.md`, `specs/current/ci.md` (CI scope confidence methodology — required before changing planner confidence, routing, or omission policy in `.github/config/scopes.json` and `.github/scripts/scopes.py`), `specs/current/chat-panel-next.md` (ChatPanel 重构:基线、任务进度规格、决策记录、踩过的坑 — 改 chat 渲染管线/工具调用展示/执行记录前必读), `specs/current/chat-panel-next-plan.md` (交付计划与纠偏节点), `specs/current/openpixo-session-sidebar.md`.
- Directory-level agent guidance: `.github/AGENTS.md`, `apps/AGENTS.md`, `packages/AGENTS.md`, `tools/AGENTS.md`, `e2e/AGENTS.md`, `apps/web/src/components/chat/AGENTS.md` (chat 组件分层、`--chat-*` 样式接缝、降级形态与测试规约).
- Packaged auto-update architecture and high-confidence local harness: read `tools/pack/AGENTS.md` section "Packaged auto-update architecture and harness" before touching packaged updater code, release-channel identity, installer behavior, or updater UI.
- Packaged build cache contract: `tools/pack/CACHE.md` (determinant rules, materialization-time parameters, confidence grading — required before changing any build-cache node key).
- Prompt composition uses the shared game path (see "Prompt composition" below): `docs/prompt-composition.md` (inputs and host runtime contracts — required before changing shared game prompt text or daemon game prompt inputs).

## Workspace directories

- Workspace packages come from `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `shells/*`, `tools/*`, and `e2e`.
- Top-level content directories: `skills/` (functional skills the agent invokes mid-task — utilities, briefs, packagers; see `skills/AGENTS.md`), `design-templates/` (reusable media templates; see `design-templates/AGENTS.md` and `specs/current/skills-and-design-templates.md`), `plugins/` (plugin spec, official/community plugins, marketplace registry seeds; see `plugins/AGENTS.md`), `prompt-templates/` (image/video one-shot prompt templates with argument slots), `mocks/` (replay-based mock CLIs for `claude`, `codex`, `opencode` and its `opencode-cli` alias — PATH-overlay drop-in for tests and self-validation; see `mocks/README.md`).
- `apps/web` is the Next.js 16 App Router + React 18 web runtime; do not restore `apps/nextjs`.
- `apps/daemon` is the local privileged daemon and `pixo` bin. It owns `/api/*`, agent spawning, skills, artifacts, and static serving.
- `apps/desktop` is the Electron shell; it consumes web/daemon status through the sidecar client boundary.
- `apps/packaged` is the thin packaged Electron runtime entry; it starts packaged sidecars and owns the `openpixo://` entry glue only.
- `apps/closure` owns the independently distributable OpenPixo Closure content. It does not own acquisition, generation state, or shell policy.
- `packages/contracts` is the pure TypeScript web/daemon app contract layer.
- `packages/sidecar-proto` owns business DTOs and action names; `packages/sidecar` owns the complete business-agnostic sidecar client boundary and protocol implementation; `packages/platform` owns generic OS process primitives.
- `packages/standalone` owns the shell-neutral exact metadata, verification, materialization, generation, and launcher contract.
- `shells/terminal` owns the official Node carrier and terminal-facing lifecycle commands. Shells consume standalone contracts and must not import Closure app source.
- `tools/dev` is the local development lifecycle control plane.
- `tools/pack` is the local packaged build/start/stop/logs control plane, packaged updater harness, and installer identity/registry validation surface.
- `tools/serve` is the local fixture-service control plane; first service is `tools-serve start updater` for deterministic updater metadata and artifacts.
- `tools/release` owns release metadata, storage publishing, release reports, and notification-facing data contracts; packaged artifact construction and smoke testing remain in `tools/pack`.
- `e2e` owns user-level end-to-end smoke tests and Playwright UI automation; read `e2e/AGENTS.md` before editing its tests or commands.

## Inactive or placeholder directories

- `apps/nextjs`, `packages/shared`, and `apps/landing-page` have been removed; do not recreate or reference them.
- Local runtime data, `.tmp/`, `.cache/`, Playwright reports, and agent scratch directories must stay out of git. For daemon-managed data paths, read and follow **Daemon data directory contract** below; do not restate or improvise path conventions elsewhere.

# Development workflow

## Environment baseline

- Runtime target is Node `~24` and `pnpm@10.33.2`; use Corepack so the pnpm version pinned in `package.json` is selected.
- New project-owned entrypoints, modules, scripts, tests, reporters, and configs should default to TypeScript.
- Residual JavaScript is limited to generated output, vendored dependencies, explicitly documented compatibility build artifacts, and the allowlist in `scripts/guard.ts`.

## Windows

- Windows is OpenPixo's first release platform and the primary development machine. macOS and Linux remain supported by the inherited tooling but are not release targets yet.
- This checkout carries a pinned local toolchain (Node 24.22.1, pnpm 10.33.2) under the ignored `.cache/toolchain/`. In PowerShell, prepend `.cache\toolchain\node_modules\node\bin` and `.cache\toolchain\node_modules\.bin` to `PATH` before running `pnpm`. Do not alter the user's global Node/pnpm installations.
- On a fresh machine: install Node 24 (`winget install OpenJS.NodeJS.LTS` or https://nodejs.org) and verify with `node --version`; do not use Node 22.
- `corepack enable` fails with EPERM on Windows (cannot write shims to `Program Files`). Use `npm install -g pnpm@10.33.2` instead.
- `better-sqlite3` has no prebuilt binary for win32/Node 24; `pnpm install` will compile it from source via node-gyp (~2 min). Requires Visual Studio Build Tools 2022 or newer. This is expected — not a sign of version incompatibility.
- See `docs/windows-troubleshooting.md` for other setup errors. For `tools-dev` start/stop/status usage, see "Local lifecycle" below.

## Local validation scope

- Run focused tests for changed files and affected integration boundaries.
- Do not run full daemon or web suites locally unless explicitly requested by the user. This also applies to final regression.
- Run `pnpm guard` and `pnpm typecheck` before publication. If CI fails, investigate the failing lane and rerun the relevant focused tests.

## Local lifecycle

- Use `pnpm tools-dev` as the only local development lifecycle entry point.
- Do not add or restore root lifecycle aliases: `pnpm dev`, `pnpm dev:all`, `pnpm daemon`, `pnpm preview`, or `pnpm start`.
- Ports are governed by `tools-dev` flags: `--daemon-port` and `--web-port`.
- `tools-dev` exports `PIXO_PORT` for the web proxy target and `PIXO_WEB_PORT` for the web listener; do not use `NEXT_PORT`.
- Do not stop, uninstall, or reuse the namespace of a hands-on installed OpenPixo instance that the maintainer marks as intentionally running; use an isolated namespace for tests.

## Daemon data directory contract

This section is the only repository-wide source of truth for daemon-managed
data paths. Every README, guide, deployment note, and operational handoff that
mentions daemon data paths must point here instead of restating the rules.

This boundary is strict. Do not introduce concrete filesystem examples for the
daemon data directory, recommended data directory, shared data directory,
deployment mount, or example data directory. If existing code exposes a legacy
fallback, treat it as implementation detail or a known escape candidate, not as
a documentation pattern to copy. If a change needs a data-path rule that is not
covered here, request a core-maintainer decision in the PR instead of inventing
a new convention.

The daemon has one active data-root truth source:

- On daemon startup, `apps/daemon/src/server.ts` resolves `PIXO_DATA_DIR` into
  `RUNTIME_DATA_DIR`.
- All daemon-owned data paths must derive from `RUNTIME_DATA_DIR` or from a
  constant derived from it, such as `PROJECTS_DIR` or `ARTIFACTS_DIR`.
- `PROJECTS_DIR` is the managed-project root. Imported-folder projects are the
  explicit exception: they use `metadata.baseDir` for the user-selected
  external workspace.
- `ARTIFACTS_DIR`, SQLite, app config, MCP config/tokens, plugin state, checkpoint stores,
  generated files, logs owned by sandbox mode, and agent runtime homes are
  daemon data and must remain under the resolved daemon data root unless this
  file names a specific exception.
- Agent subprocesses receive the resolved daemon data root as `PIXO_DATA_DIR`.
  They must inherit the daemon's truth source instead of guessing their own
  data path.

Development propagation:

- `tools-dev` consumes sidecar launch/discovery/lifecycle atomics and owns only developer orchestration policy.
- `tools-dev --namespace <name>` does not, by itself, define daemon data
  isolation.
- A development run that needs an isolated daemon data root must pass
  `PIXO_DATA_DIR` into the daemon process environment. After that, the daemon
  resolves it once and all daemon data paths flow from `RUNTIME_DATA_DIR`.

Packaged propagation:

- `tools-pack` / `apps/packaged` own packaged channel and namespace layout.
- Packaged code resolves the final namespace-scoped daemon data root before
  spawning the daemon.
- The packaged daemon receives that final data root as `PIXO_DATA_DIR`; daemon
  code must not infer packaged data paths from app names, Electron `userData`,
  ports, channel names, or namespace names.

Sanctioned exceptions:

- `PIXO_MEDIA_CONFIG_DIR` is a narrow override for `media-config.json` only. It
  is not a second daemon data root.
- External tool homes such as `CODEX_HOME` are integration inputs, not daemon
  data roots. The daemon must not describe them as OpenPixo runtime data.
- Agent/project-cwd skill staging aliases are not daemon data roots.
- Manifest metadata keys and CSS identifiers are semantic namespaces, not
  filesystem path conventions.

Known escape candidates that must not be reused:

- Module-level defaults that point at a cwd-relative legacy data directory.
- Helper defaults such as `defaultRegistryRoots()` that recompute a data root
  from `process.env.PIXO_DATA_DIR` or a cwd fallback instead of receiving
  `RUNTIME_DATA_DIR`.
- `openDatabase(projectRoot)` calls that rely on its fallback instead of
  passing the resolved data root.
- Script help text or examples that suggest concrete legacy data directories.

Do not extend these escape patterns. When a fix is obvious, route the path
through `RUNTIME_DATA_DIR` or an explicit data-root argument. When it is not
obvious, block the PR and request core-maintainer guidance.

## Root command boundary

- Keep root scripts reserved for true repo-level checks and tools control-plane entrypoints: `pnpm guard`, `pnpm typecheck`, `pnpm tools-dev`, `pnpm tools-pack`, and `pnpm tools-serve`.
- Do not add root aggregate `pnpm build` or `pnpm test` aliases. Build/test commands must stay package-scoped (`pnpm --filter <package> ...`) or tool-scoped (`pnpm tools-pack ...`).
- Do not add root e2e aliases; e2e package commands and ownership rules live in `e2e/AGENTS.md`.

## Inherited GitHub automation

`.github/` keeps only PR CI: the `ci.yml` business layer, its `comment`/`autofix`/`report`/`convergence`/`rerun` atom workflows and shared helpers (`.github/scripts/`, `.github/config/`), the local-validation workflow `catalog-validate.yml` (pending a scope decision), and `openpixo-release.yml`, the release workflow. Upstream release pipelines, Feishu/Discord notifiers, backport, contributor bots and other organization automation were removed under ADR 0006. Therefore:

- Read `.github/AGENTS.md` before editing anything under `.github/`, and `specs/current/ci.md` before changing scope routing in `.github/config/scopes.json` or `.github/scripts/scopes.py`.
- Do not add new business-named follow-on workflows; express new CI follow-ons through `ci.yml` plus the existing atom workflows.
- OpenPixo's release channels are Stable and Beta, on separate feeds and app identities. Releases follow the maintainers' release runbook. The upstream release channel model is not OpenPixo policy.
- Packaged identity must stay OpenPixo-specific: never ship a build whose app identity, OS protocol, data namespace, or updater feed reuses the upstream identity or feed (ADR 0005). The channel tokens in `tools/pack/AGENTS.md` ("Channel identity rules") are implementation/test inputs and do not define release policy.

## Boundary constraints

- Tests under `apps/`, `packages/`, and `tools/` live in a package/app/tool-level `tests/` directory sibling to `src/`; keep `src/` source-only and do not add new `*.test.ts` or `*.test.tsx` files under `src/`. Playwright UI automation belongs to `e2e/ui/`, not app packages.
- App packages must not import another app's private `src/` or `tests/` implementation as a shared helper. In particular, `apps/web/**` must not import `apps/daemon/src/**`; web/daemon integration belongs behind HTTP APIs, `packages/contracts`, and app-local provider boundaries.
- Cross-app, cross-runtime, or repository-resource consistency checks belong in `e2e/tests/` when they need to observe more than one app/package boundary; promote reusable logic to a pure package instead of borrowing another app's private source.
- Keep shared API DTOs, SSE event unions, error shapes, task shapes, and example payloads in `packages/contracts`; update contracts before wiring divergent web/daemon request or response shapes.
- Keep `packages/contracts` pure TypeScript and free of Next.js, Express, Node filesystem/process APIs, browser APIs, SQLite, daemon internals, and sidecar control-plane dependencies.
- Keep project-owned entrypoints, modules, scripts, tests, reporters, and configs TypeScript-first; generated `dist/*.js` is runtime output, and source edits belong in `.ts` files.
- New `.js`, `.mjs`, or `.cjs` files need an explicit generated/vendor/compatibility reason and must pass `pnpm guard`.
- App business logic must not know about sidecar/control-plane concepts. Keep sidecar awareness in `apps/<app>/sidecar` or the desktop sidecar entry wrapper.
- New OpenPixo domains (game harness, asset index and tools, recipes, account, credits, store) go in their own modules and route files; `server.ts` and `cli.ts` get only registration lines.
- Sidecar process stamps must have exactly five fields: `channel`, `namespace`, `source`, `mode`, and `app`. IPC is private implementation detail and is never a stamp field.
- Sidecar identity is argv-only. Do not create identity/state files derived from a stamp.
- Orchestration layers (`tools-dev`, `tools-pack`, packaged launchers) must call `@openpixo/sidecar` client/atomic primitives; do not expose argv assembly, IPC paths, or process scans.
- Packaged runtime paths must be namespace-scoped and independent from daemon/web ports; ports are transient transport details only.
- Default runtime files live under `<project-root>/.tmp/<source>/<namespace>/...`; private IPC endpoints are derived by `@openpixo/sidecar` from the five-field stamp and the current OS principal. POSIX endpoints use a principal-scoped, hashed directory under the OS temporary directory; callers must treat the concrete path as opaque.

## Capability exposure (UI/CLI dual-track)

Every user-facing capability must be reachable through both the web UI **and** the `pixo` CLI (`apps/daemon/src/cli.ts`). Shipping a feature with only one of the two surfaces is a regression.

- The CLI is the embeddability contract. Agents running inside OpenPixo (Codex, Claude Code, OpenCode) and external agents drive capabilities such as media generation, asset processing, and recipes through `pixo` subcommands — they do not render the web UI. A UI-only capability cannot be used mid-task by an agent.
- Both surfaces must call the same `/api/*` endpoints; do not let the CLI talk to one shape and the UI to another. The daemon HTTP layer is the single source of truth, with `packages/contracts` carrying the shared DTOs.
- The CLI form must support `--json` for machine-readable output and accept long-form prompts via `--prompt-file <path|->`, so jobs that pipe through `xargs`, `jq`, and `<heredoc` stay clean.
- Adding a new capability is a three-step closure: HTTP endpoint in `apps/daemon/src/*-routes.ts` or `apps/daemon/src/routes/` (with a contract type in `packages/contracts/src/api/`), UI surface in `apps/web/src/`, and `pixo <capability>` subcommand in `apps/daemon/src/cli.ts` registered through `SUBCOMMAND_MAP`. Land all three in the same change; do not stage them across PRs.
- If one surface is genuinely not applicable (e.g. an internal-only daemon health probe), say why in the PR body. "I'll do the CLI later" is not a valid reason.
- Existing reference points: `pixo media …`, `pixo extensions …`, `pixo plugin …`, `pixo project …`, `pixo mcp …`, `pixo recipe …`, `pixo game plan …`. Copy that pattern for new capabilities.

## Git commit policy

- Git commits must not include `Co-authored-by` trailers or any other co-author metadata.

## Pull request expectations

- Open PRs with `.github/pull_request_template.md` and fill every section, not just the title. Titles use Conventional Commits (`fix(web): …`, `feat(daemon): …`); the upstream Plane identifier gate does not apply to OpenPixo.
- "Why" must answer both the author's use case and the pain being addressed (user problem, technical debt, prod issue, or unblocker), not just a one-line restatement of the title.
- "What users will see" describes the change from a user's perspective — what they click, what new thing appears, what default behavior changed — not from a code perspective.
- The Surface area checklist must reflect actual surfaces touched, including extension points (`skills/`, `plugins/`, `prompt-templates/`, `design-templates/`), CLI flags, env vars, i18n keys, and new root `package.json` dependencies.
- If any UI surface is touched, attach screenshots showing the entry point — where users discover the change — not just the feature in isolation; before/after is best for behavior changes.
- For bug-fix PRs, link the red-spec test that reproduces the bug and confirm it went red before the fix and green after, per "Bug follow-up workflow" below.
- `CONTRIBUTING.md` covers PR scope, dependency policy, and the issue-first rule for non-trivial features; `docs/code-review-guidelines.md` is the reviewer-facing complement.

## Code review guide

- Use `docs/code-review-guidelines.md` as the review standard. That document is the operational guide; this `AGENTS.md` is the source of truth when the two disagree, including where ADR 0006 drops upstream organization rules.
- Before reviewing changes under `apps/`, `packages/`, `tools/`, or `e2e/`, read that directory's `AGENTS.md` and apply its local boundaries.
- Blocking review feedback should focus on correctness, security/secrets, data integrity, repository boundary violations, contract/migration breakage, missing required validation, or high-risk maintainability issues.

## Prompt composition

- Every project uses `composeOpenPixoGamePrompt` in `packages/contracts/src/prompts/openpixo-game.ts`. There is no legacy design composer or core-variant switch.
- `apps/daemon/src/game/prompt.ts` adds daemon model-catalogue and runtime plan-tool facts. The server passes its resolved working directory for managed, template-created, imported and no-project runs; prompt composition does not change data paths.
- The shared game media contract, engine profile, game plan, recipes, custom instructions, enabled skills and plugin stages enter through explicit inputs. Unknown engines are inspected before editing. Plan mode and text-only provider limits remain explicit.
- Before changing prompt text, read `docs/prompt-composition.md`. Give every host protocol one source; runtime plan-tool names live in `apps/daemon/src/runtimes/plan-tool-note.ts` and per-turn done/follow-up/focus markers stay outside the cached prefix.

## Agent runtime conventions

- `RuntimeAgentDef.promptInputFormat` selects how the daemon writes the prompt to a child's stdin. The default `'text'` writes the composed prompt and ends stdin immediately. `'stream-json'` wraps the prompt as one JSONL `user` message and KEEPS stdin open so the daemon can stream further user messages back in mid-turn. Claude (`apps/daemon/src/runtimes/defs/claude.ts`) ships `'stream-json'` together with `--input-format stream-json` as generic mid-turn input infrastructure; the daemon closes stdin once the turn terminates cleanly. Every other agent stays on `'text'`.
- `apps/daemon/src/server.ts` tracks `run.stdinOpen` on the run object. `applyClaudeStreamJsonRunBookkeeping` closes stdin (and records `turnCompletedCleanly`) when a `turn_end` (or `usage`) event arrives with a non `tool_use` `stop_reason`. The `tool_use` stop reason means the model paused mid tool (waiting on claude-code's internal runner); closing stdin there would truncate the follow up response.
- `claude-stream.ts` reads the turn's `stop_reason` from **three** frames, because Claude Code moved the field and the daemon does not control which build a user has installed. In order of precedence per message: (1) `stream_event` → `message_delta` → `delta.stop_reason`, the only place Claude Code 2.1.259 carries it, available only when `--include-partial-messages` is negotiated; (2) `assistant` → `message.stop_reason`, the legacy shape, which 2.1.259 leaves `null` on every frame but which older CLIs and argv-compatible forks still populate; (3) the terminal `result` frame, surfaced as `usage`, present on every build and flag combination. `emitTurnEndOnce` dedupes them by assistant message id so a build that fills both (1) and (2) announces one turn once. There is deliberately no version gate — nothing tells us which release stopped filling the legacy field, and forks version themselves independently.
- Whichever source fires, `turn_end` is emitted AFTER every tool_use of the message has been emitted, so the daemon never closes stdin before it has seen the turn's tool calls. Only a main-turn frame may fire it: a forwarded Task sub-agent frame carries a non-null top-level `parent_tool_use_id` and is refused.
- A `result` frame ends one **user turn**, not the CLI process: a stream-json session whose stdin stays open emits one `result` per turn and keeps reading. That makes it a valid per-turn reset point for `claude-stream.ts`'s artifact-echo dedup, and on a build with no in-stream boundary at all it is the only one.
- Verbatim CLI recordings backing all of the above live in `apps/daemon/tests/fixtures/claude-cli-recordings/` (see its `README.md`). Assert new turn-boundary behavior against those, **not** against the older hand-built Claude fixtures elsewhere in `apps/daemon/tests/` — those put `stop_reason` on the `assistant` wrapper and describe a stream the current CLI no longer produces.
- With no upstream to absorb CLI protocol changes (ADR 0006), every productized runtime (Codex, Claude Code, OpenCode) keeps real CLI recordings; a new CLI version is replayed against them before support for it is claimed.
- The host asks the user clarifying questions through the `<question-form>` artifact (see "Asking the user questions" below), NOT through a stdin-injected `tool_result`. There is no `AskUserQuestion` tool wiring, no `/api/runs/:id/tool-result` endpoint, and no host-answer return path. The stream-json input skeleton is generic infrastructure, and its one product consumer is `POST /api/runs/:id/steer` (「引导对话」): the USER pushes a further message into a turn that is still running, which is the opposite direction from `<question-form>`. Admissibility lives in `apps/daemon/src/runtimes/run-steering.ts` (`classifyRunSteering`) — do not re-derive it at a call site, and do not extend it into a host-question path.

## Starting a physical Run

- Every physical Run is started through `internalRunCreation.start(run, analytics, starter)` (`apps/daemon/src/services/internal-run-service.ts`). Calling the run registry's `start` directly bypasses the Run analytics lifecycle, so the Run reports no `run_created` and no `run_finished` and nothing says so. `pnpm guard`'s "run start choke point" check enforces this; the only allowed caller of `.runs.start(` is the service itself.
- The `analytics` argument is required on purpose. A caller with no identity to attribute the Run to — an internal run without an attributed request — passes `requestAnalyticsContext: null` explicitly; the lifecycle then stays silent instead of inventing one. Stating "no identity" is a decision the code has to record, not a step a caller can skip.
- A daemon-created Run that continues an existing task inherits its analytics identity and lineage from the Run that caused it, via `inheritedRunLineageHints` (`apps/daemon/src/services/run-analytics-lifecycle.ts`). Resolve lineage through that helper rather than from the source Run's `analyticsRecovery`: the lifecycle re-reads host facts before it captures, so a short Run can hand off before its own recovery record exists.

## Asking the user questions

- There is exactly one mechanism for clarifying user intent: the `<question-form>` markdown artifact the model emits inline. `AssistantMessage.tsx` renders `QuestionFormView` directly inside the originating assistant message, and answers flow back as the next user message (`formatFormAnswers` in `apps/web/src/artifacts/question-form.ts` → `POST /api/chat`). There is no separate Questions tab or native tool card.
- `<question-form>` is valid on any turn when essential information is missing, and it is how a new game is planned. Its canonical JSON syntax, supported controls and answer contract live in the shared game prompt (`packages/contracts/src/prompts/openpixo-game.ts`). Do not invent a native question tool or stdin answer path.

## Planning a new game

- Every new game starts in the setup dialog, one question per screen. The first time only, it asks the user's experience (app config `gameExperience`, also in Settings and `pixo config`); every game, it asks the size (`gameSetup.scope`: quick 2–4 hours / crafted 3–15 days / long 1 month+, last answer preselected). A first-timer sees only 2D views and only the Phaser and Godot starters. There is no release screen: no stores, systems, Steam features, price or milestone; languages sit under 更多设置, and only a long project offers one "以后想上 Steam" checkbox (`release.steamLater`). New questions must change what gets built and stay few. `new-game/setup-routing.ts` holds the routing rules. A plain idea typed on Home opens `NewGameDialog` before a project exists, and the text becomes its first message word for word. A start that binds to a project the dialog cannot make (a plugin, a skill, a folder, other attached context) is created as before, and `ProjectView` opens `GameSetupDialog` and holds the first message when `newGameNeedsSetup` says so. Closing it continues in chat. The finished sample stays one click, and an imported game with work in it is never interrupted. The required answers in `wizard-state.ts` ask more of a new game than `gameSetupStepComplete` asks of a stored setup, so older projects and scripted setups are not called unfinished. A stored setup counts as started with a genre plus a size or (older setups) platforms. Older setups' release answers are kept and still become build requirements in `renderReleaseRequirements`; Steam is otherwise mentioned only when `steamLater` is set.
- Every new game, any size, walks 玩法 → 画风 → 引擎与技术 → 计划 → 制作 in chat, one step at a time, each confirmed by the user and labelled in the user's language ("第 2 步 / 共 5 步：画风"). Setup answers are starting points to confirm, not settled facts. Gameplay ends with a "one minute of play" the user confirms; art shows 2–3 samples of the game and the pick becomes the style reference; only a palette the user set is a requirement. The plan lists 3–6 stages. After approval the agent builds one stage per turn ("阶段 1 / 共 4：…", read from the conversation, no daemon state), says how to try it, ends with a `<question-form>` and waits; it lists art before generating it. A quick game keeps every step, short. A game that already exists is not interviewed. Text: `renderGamePlanBlock` and the per-turn `renderGamePlanTurnNote` (`packages/contracts/src/prompts/openpixo-game.ts`); app config `gameExperience` reaches the prompt as an explicit input. Approval records the newest agent message as `metadata.gamePlan.approvedPlan`, so build turns see the plan whatever the transcript keeps.
- The state is daemon-owned `metadata.gamePlan`, stamped at creation: `POST /api/projects` for kinds that can be a game, game-from-template except the finished sample, and an import of an empty folder. No stamp means no gate. `skipDiscoveryBrief` (`pixo project create --skip-plan`) opts out for scripted use.
- Only the user approves: the bar above the composer (`components/chat/GamePlanBar.tsx`) or `pixo game plan approve`, both through `POST /api/projects/:id/game-plan/approve`. That route refuses an agent's token and waits while a run is active, which is the only time an agent has a shell. Do not add a path where the model's output ends planning, including a reserved form id.
- The gate is not prompt wording. While planning, `startChatRun` forces Plan mode, and Plan mode is now read-only on every runtime (`runtimes/read-only-turn.ts`): Codex gets the `read-only` sandbox with no approvals, Claude Code loses its edit tools and the host answers its permission requests, OpenCode gets deny rules. `routes/game-plan.ts` refuses recipes, non-image media and more than a few concept images from an agent token, and refuses `pixo game scaffold`.
- A game is the whole window, not a webpage with a game in it (`renderGameShapeBlock`). The folder picked on Home becomes the project's `metadata.baseDir` through the existing working-dir handoff, not a `linkedDirs` reference. `pixo game verify`, `playtest`, run and engine detection work on every project, managed or not.
- `run-artifacts.ts:runAskedUserQuestion` powers the `run_finished.asked_user_question` analytics signal by scanning the run's streamed text for a complete renderable question form (reassembled across `text_delta` chunks), not by detecting any tool call.

## Hosted media provider names

- The hosted (credits) generation path is provider-neutral. Without a user's own provider key, nothing names the upstream media provider: UI, CLI, prompts, task state, errors and result URLs. That covers the daemon catalogue, because every CLI and agent reads it: the provider is `media-gateway` with neutral model ids and labels. Old model and provider ids resolve in the daemon only (`RENAMED_GATEWAY_MODELS`, `RENAMED_MEDIA_PROVIDERS` in `media/models.ts`).
- A provider is named only where a user sets their own key for it: its entry in Settings and onboarding, and that route's output once the key exists. Entry copy presents it as one choice among many and never implies OpenPixo uses it.
- Hosted files move straight between the app and the provider; the cloud only hands out links. `apps/daemon/src/media/openpixo-hosted.ts` is the only place that holds such a link; it must not reach the UI, the CLI, task state, a project file or a log.
- In the media adapter (`apps/daemon/src/media/index.ts`) the missing-key error stays neutral. Regression tests scan the served catalogue, both locales and the rendered media contract.

## Art budget

- A user with credits and no own image tool gets art from the agent by approving an art budget with the plan. The ledger is two SQLite tables in `apps/daemon/src/game/art-budget.ts`, never project metadata, because metadata is read-modify-written in many places.
- Only the user sets a budget: the approve bar, the line above the composer (`components/chat/ArtBudgetLine.tsx`), or `pixo game plan budget`. `routes/art-budget.ts` refuses an agent's token and waits while the project has an active run. A budget the user saves on the approve bar before approval pays for planning's style samples, inside the concept-image cap; audio and 3D still wait for approval.
- The daemon prices every agent request itself (`game/art-budget-spend.ts`): an agent supplies no quote, price or request id. The check and the reservation are synchronous in `ArtBudgetLedger.reserve`; do not put an await between them.
- A charge counts as used until the cloud proves it kept nothing. `OpenPixoHostedMedia.follow` reports that proof through `HostedSettlement`; do not release on a timeout, a crash or an unknown failure. A retry of an open request reuses its request id and quote, so the cloud answers with the job it already has.
- Hosted audio (`openpixo-sfx`, `openpixo-voice`, `openpixo-music`) and hosted 3D spend the same budget under the same rules. Hosted 3D has three quality tiers (`OPENPIXO_MODEL3D_SERVICES` in `packages/contracts/src/api/openpixo-cloud-media.ts`): `openpixo-model3d-draft`, `openpixo-model3d` (medium, the default) and `openpixo-model3d-high`; check for a 3D service with `isOpenPixoModel3dService`, never by comparing against the medium id. Recipes spend neither; image recipes run with an agent's token may spend the budget, one candidate by default, every candidate priced and reserved by the daemon before the run starts (`recipes/routes.ts`), and only after every own tool. `configuredRecipeProviders` still leaves `openpixo` out.
- Each project has a spending mode, `ask` (default) or `auto` (`ArtSpendingMode`). In `ask` the agent spends only what the user approved on an art card: the agent ends its reply with `<art-request credits="N">` (`packages/contracts/src/api/art-request.ts`), the chat draws Approve, and the click calls `POST /api/projects/:id/art-budget/approve` (`pixo game plan approve-art`), which refuses an agent's token and waits while a run is active. One approval pays for one run, the first that spends from it; `ArtBudgetLedger.reserve` checks and claims it in the same transaction as the budget. Planning's style samples need no card. In `auto` the budget alone limits spending. The mode is set on the art budget line or `pixo game plan budget --mode`.
- Token-less local generation with a user-confirmed quote does not count against the budget, and an agent's shell can reach it: `apps/daemon/tests/game/art-budget.test.ts` pins that known gap. The budget bounds what a well-behaved agent spends through its token.

## Chat UI conventions

- `apps/web/src/components/file-viewer-render-mode.ts` decides URL-load vs srcDoc for plain HTML previews. URL-load is the default; inline assets, local forms, sandbox storage and focus/redirect guards can require srcDoc. FileViewer retains both transports and switches visibility, keeping the active iframe ref aligned. Preview message handlers must verify the sending iframe and, for active-document signals, reject inactive transports. Design editing, comments, slide navigation, palette and tweaks bridges have been removed.
- TodoWrite has **no pinned card above the composer**. The task list appears in full exactly once, inside the turn's execution record, as `执行计划 · N 步` plus one drawer per step (`components/chat/ExecutionShell.tsx`, decisions D29 / B17 in `specs/current/chat-panel-next.md`). Do not reintroduce the removed `PinnedTodoSlot`.
- What *is* pinned above the composer is the **Plan pill** (`components/chat/PlanPill.tsx`): a one-line `第 N / M 步` capsule, with the whole list in a hover-only popover that opens **upward**. `N` is *which step is running now* (not `{done}/{total}`), and the pill disappears once the run ends or nothing in the list is unfinished. Visibility, `N`/`M`, and the per-step mark live in the pure `runtime/chat/plan-pill.ts`; the component only draws.
- Because the pill sits **outside** the `.chat-log` scroll container, it is wired into the same auto-scroll plumbing as `QueuedSendStrip`: it takes a `containerRef`, `ChatPane`'s `ResizeObserver` observes that element, and the pane-level `MutationObserver` re-attaches the observation whenever it mounts or unmounts. Any future pinned element there needs the same three pieces or new messages stop scrolling into view. The pill renders **before** `QueuedSendStrip` in DOM order so a growing queue pushes it up instead of overlapping it.
- `latestTodoWriteInputFromMessages` is the conversation-level discovery link (used by the pill); `unfinishedTodosFromEvents` (the daemon's own criterion) is untouched.
- The **run status line** (`components/chat/RunStatusLine.tsx`, derived by the pure `runtime/chat/run-status.ts`) sits directly above the composer inside `composerNode`, is always mounted at a fixed height, and says in plain words what the run is doing now. It does not repeat the pill's `N / M`. Images, audio and video a turn made are shown outside the execution record by `components/chat/AssetGallery.tsx`; its detection rule is `runtime/chat/turn-assets.ts`. The files a turn changed are listed beside them by `components/chat/TurnChanges.tsx` (`runtime/chat/turn-changes.ts`). All of it is specified in `specs/current/chat-inline-assets-and-run-status.md` — new generation paths must match that rule.
- The **context indicator** (`components/chat/ContextIndicator.tsx`, derived by the pure `runtime/chat/context-usage.ts`) sits at the right end of the run status line and shows only what a runtime reported through `context_usage` events: OpenCode's step totals against limits the daemon knows (`runtimes/context-limits.ts`), Codex's last call against its stated window, Claude Code's last message against the window in its `result` frame. No limit means it is not mounted; nothing is estimated. Its popover lists what the runtime said the last call was made of (`ContextUsageParts`), where it compacts, and how often this conversation has. Hosted models take their window per model from the cloud catalogue. A `context_compacted` event leaves one line at the end of the turn. OpenCode marks a compaction only after the fact, with a synthetic `compaction_continue` text after the summary step, so `json-event-stream.ts` holds a turn-ending step's text until it knows that step was not the summary (recording: `apps/daemon/tests/fixtures/opencode-cli-recordings/`).
- The skills a turn used are named at the top of the message by `components/chat/TurnSkills.tsx` (`runtime/chat/turn-skills.ts`): the daemon's `skills_loaded` event plus the skill files the agent read. Being listed in the prompt does not count as used.
- Continuing a turn's remaining tasks (`onContinueRemainingTasks`) has no rendered home yet; `AssistantMessage` still accepts the prop.
- MCP startup connection status (`mcp_connection` events) is not shown in chat, live or restored; run events and CLI diagnostics keep it (`specs/current/chat-panel-next.md`).
- Tool group rendering uses `dedupeSnapshotToolRetries` to collapse `TodoWrite` snapshots (only the most recent call survives, since each call is a state replace). `SNAPSHOT_TOOL_NAMES` lists the snapshot-style tools; non-snapshot tools pass through untouched.

## Web CSS ownership

- `apps/web/src/index.css` is an import-only cascade entrypoint. Do not add selectors or declarations there; add imports only when a truly global stylesheet is needed, and keep import order intentional.
- Shared global styles belong in `apps/web/src/styles/`: design tokens, base/reset rules, primitives, app-shell layout, and legacy cross-component selectors that cannot safely be scoped yet. Keep domain-level global files grouped by owner (for example `styles/viewer/` and `styles/workspace/`) instead of adding more large files directly under `styles/`.
- New component-owned UI styles should default to CSS Modules next to the component (`Component.module.css`) instead of expanding global stylesheets.
- When touching an existing component with nearby global styles, prefer migrating that component's local selectors to a CSS Module as part of the change if it is small and testable. Do not mix a large mechanical move with behavior/styling changes in the same patch.
- Keep global class names only for deliberate shared contracts: reusable primitives, theme hooks, third-party/content styling, cross-component layout, or selectors that rely on global cascade/specificity. Document any new global selector group with its owning feature.
- CSS refactors must preserve cascade semantics. For mechanical splits, verify expanded import content/order matches the previous stylesheet; for CSS Module migrations, validate the affected UI path with `pnpm --filter @openpixo/web typecheck` and a focused build/test or visual check when practical.

## Web component reuse

- New `apps/web` UI should reuse shared primitives from `@openpixo/components` when one exists instead of styling plain HTML elements directly. For example, use `Button` for app buttons and `VisuallyHidden` for screen-reader-only text/status content.
- Do not add new raw primitive classes such as `primary`, `primary-ghost`, `ghost`, `subtle`, `icon-btn`, or `sr-only` for new UI. Those classes are legacy compatibility surface for existing markup until it is migrated.
- If a needed primitive is missing, prefer adding a small focused primitive to `packages/components` with colocated CSS Modules, then consume it from the app. Keep product-specific layout and workflow styling in the app, not in `packages/components`.
- Keep semantic plain HTML when it is content markup or a specialized control that the shared package does not model yet.
- `apps/web` transpiles `@openpixo/components` from source during dev, so component and CSS Module edits should work through the normal web dev loop without rebuilding the package.

## i18n keys

- `apps/web/src/i18n/types.ts` defines `Dict` and the only UI locales, `en` and `zh-CN`. `LocaleDicts` is `Record<Locale, Dict>`: both dictionaries must be complete. Add each new key to `types.ts`, `locales/en.ts` and `locales/zh-CN.ts`; typecheck and `apps/web/tests/i18n/locales.test.ts` enforce parity.
- The picker offers English and 简体中文. Unsupported saved preferences fall through to supported desktop/browser language detection, then English; Chinese browser language tags use `zh-CN`. Plugin/skill manifest translations and content-language data are separate from the web dictionary and must not be pruned merely because a UI locale is unsupported.
- A recipe's form text lives in its `pixo.json`, not in the web dictionary: `label_i18n`, `placeholder_i18n`, `optionLabels_i18n` and, for free text only, `default_i18n`. A recipe still receives the value in `options`; the schema refuses a translation that could change that. `e2e/tests/recipes/form-translations.test.ts` fails on any recipe that is not fully translated.

## UI animation philosophy

- Default ease-out for UI transitions: `cubic-bezier(0.23, 1, 0.32, 1)`. Built-in `ease` is too weak; `ease-in` is forbidden for UI elements because it feels sluggish.
- Asymmetric durations: enter around 200ms, exit around 140ms. Exit reads as decisive because the user has already chosen to dismiss.
- Accordion expand and collapse uses `grid-template-rows: 0fr -> 1fr` (modern auto height pattern). Pair with opacity fade and the easing above. The shared `.accordion-collapsible` + `.accordion-collapsible-inner` class pair is the canonical implementation; reuse it for new disclosure UI.
- Never animate from `transform: scale(0)`. Start from `scale(0.9)` or higher with `opacity: 0`.
- For elements that show conditionally, keep them mounted and toggle a CSS class (e.g. `.chat-jump-btn-active`). React unmounts skip the exit transition entirely.

## Validation strategy

- Before adding, repairing, or optimizing tests, follow
  [`docs/testing/test-efficiency.zh-CN.md`](docs/testing/test-efficiency.zh-CN.md)
  for completion signals, virtual-clock usage, isolation, and performance
  validation.
- After package, workspace, or command-entry changes, run `pnpm install` so workspace links and generated dist entries stay fresh.
- For agent-stream / parser changes (`apps/daemon/src/runtimes/claude-stream.ts`, `json-event-stream.ts` and Codex app-server helpers), replay a recorded session through the mock CLIs in `mocks/` to verify event shapes round-trip without burning provider budget. PATH-overlay activation: `export PATH="$PWD/mocks/bin:$PATH" PIXO_MOCKS_TRACE=<8-char-id> PIXO_MOCKS_NO_DELAY=1`. See `mocks/README.md` for the trace catalog and selection knobs.
- Live model/provider tests are opt-in only (`e2e/tests/openpixo/live-codex.test.ts` per-provider gates) and spend the user's quota; never run them without the user's explicit approval for that run. Tests on a maintainer's machine keep real spend out of reach: clear `FAL_KEY` and `PIXO_FAL_KEY`, and leave every real agent CLI off the daemon's `PATH` and `*_BIN` values, because the daemon's automatic retry can reach one even when a fake binary answered first.
- Before marking regular work ready, run at least `pnpm guard` and `pnpm typecheck`, plus the package-scoped tests/builds that match the files changed. Do not use or add root `pnpm test`/`pnpm build` aliases.
- For local web runtime loops, prefer `pnpm tools-dev run web --daemon-port <port> --web-port <port>`.
- For e2e tests that need a tools-dev daemon/web runtime, use the shared tools-dev harness under `e2e/lib/tools-dev/` and the framework suite adapters (`e2e/lib/playwright/suite.ts`, `e2e/lib/vitest/suite.ts`). Do not hand-spawn `tools-dev` from test cases or duplicate lifecycle helpers under framework-specific folders.
- Playwright UI tests must import `test`/`expect` from `@/playwright/suite`, not directly from `@playwright/test`; type-only imports from `@playwright/test` remain fine. The suite owns one isolated tools-dev daemon/web/data root per Playwright worker. Do not add a shared-runtime fallback; set Playwright workers to `1` when constrained.
- Playwright suite code must not own workspace prebuild policy. CI and callers keep the existing prebuild steps; `tools-dev` daemon freshness checks are only a fallback guard.
- On a GUI-capable machine, validate desktop by running `pnpm tools-dev`, then `pnpm tools-dev inspect desktop status`.
- Stamp/namespace changes must validate two concurrent namespaces and run desktop `inspect eval` plus `inspect screenshot` for each namespace.
- Path/log changes must run `pnpm tools-dev logs --namespace <name> --json` and confirm log paths are under `.tmp/tools-dev/<namespace>/...`.

## Bug follow-up workflow

A working playbook for routine bug follow-ups. Treat it as a default action shape, not a contract; use judgment when the situation doesn't fit cleanly.

- **Lead with a red spec.** Encode the bug as a falsifiable test that goes red before any source change. If a red spec can't be written cheaply, clarify scope rather than push forward on a guess.
- **Try the cheapest layer first.** e2e Vitest at the daemon HTTP boundary → app-local Vitest → Playwright UI → platform-native harnesses; drop down only when the cheaper layer can't see the symptom.
- **Hold the spec's scope.** Defects outside the bug's described boundary belong in a follow-up with their own red spec; list them in the PR body's "Adjacent issues" section.
- **Let the fix read as an invariant.** Prefer a named helper whose docblock describes what must hold over a bolt-on `if` guard with apologetic history-comments.
- **Diff against the baseline.** When neighboring suites have pre-existing failures, stash or check out the base before claiming "no new failures."
- **Link the issue from the PR body** with `Fixes #N` / `Closes #N` / `Resolves #N` when the PR closes one.
- **Stage human verification for visible bugs.** For UI, platform-native behavior, animations, or races, stand up a buggy-vs-fix comparison the reviewer can drive (two namespaced runtimes, one per branch), and seed data only through production HTTP APIs.

For a worked example of one full loop (red e2e spec → fix → green), see `e2e/tests/dialog/stop-reconciles-message.test.ts`.

# Common commands

```bash
pnpm install
pnpm tools-dev
pnpm tools-serve start updater
pnpm tools-dev start web
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
pnpm tools-dev status --json
pnpm tools-dev logs --json
pnpm tools-dev inspect desktop status --json
pnpm tools-dev inspect desktop screenshot --path <png-path>
pnpm tools-dev stop
pnpm tools-dev check
```

```bash
pnpm guard
pnpm typecheck
```

```bash
pnpm --filter @openpixo/web typecheck
pnpm --filter @openpixo/web test
pnpm --filter @openpixo/web build
pnpm --filter @openpixo/daemon test
pnpm --filter @openpixo/daemon build
pnpm --filter @openpixo/desktop build
pnpm --filter @openpixo/tools-dev build
pnpm --filter @openpixo/tools-pack build
pnpm --filter @openpixo/tools-serve build
```

```bash
pnpm tools-pack win build --to nsis
pnpm tools-pack win install
pnpm tools-pack win cleanup
```

macOS and Linux `tools-pack` targets still exist (`pnpm tools-pack mac …`, `pnpm tools-pack linux …`) but are not OpenPixo release targets yet.

# FAQ

## Why is there no root `pnpm dev` / `pnpm start`?

To avoid starting daemon, web, and desktop through inconsistent env, port, namespace, or log paths. All local lifecycle flows must go through `pnpm tools-dev`.

## Why should `apps/nextjs` not be restored?

The current web runtime is `apps/web`. The historical `apps/nextjs` layout has been removed from the active repo shape; restoring it would reintroduce duplicate app boundaries and stale scripts.

## How does desktop discover the web URL?

Desktop queries runtime status through its sidecar client. The web URL comes from client status, not from desktop guessing ports, IPC paths, or reading web internals.

## How are sidecar-proto, sidecar, and platform split?

`@openpixo/sidecar-proto` owns business action names and DTO/status shapes. `@openpixo/sidecar` is the unique truth source for five-field argv stamps, private IPC, OS resources, process discovery, launch, invocation, and terminal lifecycle. `@openpixo/platform` provides generic OS process primitives beneath sidecar and must not leak those implementation details into apps or orchestrators.

## When is `pnpm install` required?

Run `pnpm install` after changing package manifests, workspace layout, command entrypoints, bin/link-related content, or after adding/removing workspace packages.

## Can I use Node 22 instead of Node 24?

No. `package.json#engines` specifies `node: "~24"`, which is the only supported runtime. The current lockfile pins `better-sqlite3@11.10.0`; on Windows it has no prebuilt binary for Node 24 and is built from source via node-gyp (see the Windows section). Older Node versions are not tested and may hit lockfile or dependency incompatibilities.
