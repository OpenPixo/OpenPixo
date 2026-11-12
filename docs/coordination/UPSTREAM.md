# OpenDesign reuse audit

Date: 2026-10-25 (Asia/Tokyo). Read-only source audit; no application changes, installs, app launch, or model calls performed by this agent.

## Fixed source

- Repository: https://github.com/nexu-io/open-design
- Local inspected checkout: `.cache/upstream-open-design`.
- Commit: `9724c44142ea0afaee3d207f37901b31c66a44ad`, version `0.25.1`.
- Read root `AGENTS.md`, `apps/AGENTS.md`, and `apps/daemon/AGENTS.md`. This fork may override upstream product identity/policy where the user requests it; retain useful module boundaries.

## Run and Windows delivery

- `package.json`: Node `~24`, pnpm `10.33.2`; use the pinned toolchain rather than the existing M0 Node 26 runtime.
- Root `AGENTS.md`: Windows native development is best-effort. `better-sqlite3@11.10.0` has no Node 24 Windows prebuild and requires VS Build Tools 2022+ / node-gyp. README reports shipped Windows x64 installers, which is a separate claim from native dev support.
- Lifecycle: `pnpm tools-dev` starts daemon/web/desktop; `pnpm tools-dev run web --daemon-port <port> --web-port <port>` is the foreground web loop. Use this existing control plane.
- Verification: `pnpm tools-dev inspect desktop status --json`, desktop eval/screenshot, relevant focused tests, `pnpm guard`, `pnpm typecheck`. Upstream explicitly discourages full daemon/web suites locally unless requested.
- Packaging: `pnpm tools-pack win build --to nsis`; read `tools/pack/AGENTS.md` before touching identity/updater/installer code. It recommends short smoke namespaces to avoid NSIS/Next.js 260-character path failures and `--portable` for distributable artifacts.
- Daemon data paths must follow root `AGENTS.md` → **Daemon data directory contract**. Isolate test data using its supported `PIXO_DATA_DIR` propagation. Imported projects already use real `metadata.baseDir`.

## Reuse immediately

| Capability | Existing ownership | Implication |
| --- | --- | --- |
| DeepSeek and OpenRouter configuration | `apps/web/src/state/config.ts`: `KNOWN_PROVIDERS` and `BYOK_PROVIDER_PRESETS` | Reuse the provider form, connection tests, model discovery, persistence. DeepSeek OpenAI preset is `https://api.deepseek.com`; OpenRouter is `https://openrouter.ai/api/v1`. |
| OpenAI-compatible transport | `apps/web/src/providers/openai-compatible.ts`; daemon proxy | Supports compatible endpoints; separately validate each tool/image capability. |
| BYOK tool execution | `apps/daemon/src/runtimes/byok-opencode.ts` and `defs/byok-opencode.ts` | Existing filesystem agent uses OpenCode. Plain API/artifact mode is not equivalent to native Codex. Frozen Codex-only execution semantics need an explicit integration choice rather than a new provider UI. |
| Skills import/edit/delete | `apps/daemon/src/routes/static-resource.ts` (`/api/skills/import`, `PUT/DELETE /api/skills/:id`); `skills.ts` | Preserve body validation, side files, shadowing, and source provenance. Current scope is workspace/member, not project. |
| MCP configuration/OAuth | `apps/daemon/src/mcp-config.ts`, `mcp-routes.ts`, `mcp-oauth.ts` | Reuse schema and checks. User config is daemon-scoped; Codex forwarding is a separate missing link. |
| Real project folders | `apps/daemon/src/import-export-routes.ts` | Reuse import path realpath validation and baseDir rather than copying games. |
| Media rendering | `apps/web/src/components/chat/AudioArtifact.tsx`, file viewer and image preview | Reuse renderers for asset browser rather than building media editors. |

## Required corrections before claiming OpenPixo delivery

1. **Codex approvals:** `agent-protocol/codex-app-server/session.ts` fixes `approvalPolicy` to `never` and replies `unsupported request` to server requests. Add explicit request/response routing and user approval UI; preserve interruption/cleanup.
2. **Codex MCP:** `server.ts` around 13762 explicitly forwards external MCP only through Claude/ACP/OpenCode injection. Codex inherits its own CLI config; `runtimes/defs/codex.ts` app-server args have no external MCP override. Add a run-scoped Codex configuration path and project enablement without rewriting a user's global Codex configuration.
3. **Project skill/MCP enablement:** workspace visibility is not project scope. Keep installed packages/config shared as appropriate but select project-enabled entries when composing a run. Test two projects with different enabled entries.
4. **Provider semantics:** DeepSeek/OpenRouter preset existence does not prove native Codex works with them. Current reusable BYOK filesystem path is OpenCode, so avoid silently changing the frozen Codex-only execution commitment. Clearly state supported paths and validate provider credentials only when available.
5. **Updater identity:** `apps/desktop/src/main/updater/config.ts` enables updates by default for packaged builds and uses `https://releases.open-design.ai`. Set `PIXO_UPDATE_ENABLED=0` for OpenPixo packages until an OpenPixo feed exists, or replace the default/feed deliberately. Dev builds default disabled. Never distribute an OpenPixo build that upgrades itself to upstream OpenDesign.
6. **Upstream online surfaces:** `services/whats-new.ts` uses OpenDesign's feed on release channels; cloud/team/marketing surfaces advertise the upstream service. Hide or adapt these product surfaces in the fork while retaining reused infrastructure.

## Telemetry, local auth, and credentials

- `PRIVACY.md` and `app-config.ts:applyTelemetryDefaults`: optional metrics and content sharing default `true`. Safety/reliability telemetry bypasses that preference when a destination is configured.
- `analytics.ts:readPosthogConfig` returns null without `POSTHOG_KEY`. `langfuse-trace.ts:readTelemetrySinkConfig` requires `PIXO_TELEMETRY_RELAY_URL` or explicit Langfuse keys. The normal fork/dev build sends neither without destination configuration; packaging reads these values from env, not a bundled upstream secret.
- Keep telemetry destination env unset/cleared for OpenPixo delivery; consider opt-in defaults for the fork. Do not infer absence of network calls in cloud/news/registry services from disabled telemetry.
- `server.ts` refuses non-loopback binding without an API token unless an explicit auth-disable override is set. Preserve origin/API/desktop auth checks; use loopback for local delivery.
- `apps/web/src/state/config.ts` strips API credentials from localStorage and persists through daemon config; preserve the existing credential boundary. Do not export keys into game repositories or verification reports.

## License and provenance

- Root `LICENSE` is Apache-2.0. Retain upstream notices and record fixed commit plus changed paths.
- README explicitly retains individual bundled licenses, including MIT for `design-templates/guizang-ppt`, `design-templates/html-ppt`, and `skills/web-clone`.
- Preserve all bundled `LICENSE`/attribution files when reusing packages/templates. Root Apache does not grant separate rights to third-party brand assets or all example images; prefer shipping only needed catalogs or retaining their provenance.

## Not yet verified

Native dependency install, Windows app/package launch, actual Codex approvals and concurrency/subagent behavior, provider-paid tasks, asset indexing scale, installer identity, signing, and remote publication. Source presence is not runtime acceptance evidence.
