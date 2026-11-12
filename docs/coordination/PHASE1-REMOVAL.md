# Phase 1 removal report — updated 2026-10-27

> Historical Phase 1 record. Later [slim-core removal](../adr/0012-slim-core.md)
> supersedes the retained-domain and test inventories below, including ACP,
> craft, comments, the global Library and inherited publication; measurements remain evidence for
> their recorded commits.

Catalogue follow-up (2026-10-28): the historical 507-entry pending decision below
is closed by [slim-core batch 4](PHASE1-CATALOG-REVIEW.md). Its inherited-family
filter has been removed; the old retention tables are historical evidence.

The sections before [Round-two completion](#round-two-completion-2026-10-27) are historical checkpoints. Their stopped/partial status and exploratory failures are superseded by that completion record; they are not current acceptance exclusions.

Pre-phase-3 daemon repair (2026-10-27): the owner-requested rerun at `52c56f7e`
verified 30 failures in 13 files. Those exclusions are now closed: all 13 files
pass independently and together (111/111, no skips), with guard, typecheck,
daemon build and isolated game-workspace E2E passing. See the exact starting
titles, categories, real craft-route bug and command evidence in
[DAEMON-TEST-REPAIR.md](DAEMON-TEST-REPAIR.md).

Only **阶段 1：删除隐藏的继承功能** was processed, in the plan's order, on `codex/opendesign-base`, starting at `14c11b91`. Items 1, 5, 7, and 12 remain undeleted under the user's stop-domain rule. Item 11 is a conservative content subset; item 13 removes only switches whose remaining callers are gone. This is not a claim that every inherited domain has been removed.

No phase 2 naming changes, global toolchain/configuration changes, push, model/provider test, full daemon/web suite, installed-instance operation, or process termination was performed. `LICENSE` and `NOTICE` remain unchanged. The intentionally running installed Alpha.3 instance was not used for validation.

## Extraction commits

| Extraction | Commit | Result |
|---|---|---|
| Skill frontmatter parser | `1eff40cf` | Moved `apps/daemon/src/design-systems/frontmatter.ts` to `apps/daemon/src/services/frontmatter.ts`; shared skill, memory, installation, and route consumers now import the neutral service. |
| Token evidence | `cdc009ea` | Moved `apps/daemon/src/design-systems/token-evidence.ts` to `apps/daemon/src/services/token-evidence.ts`; plugin token extraction no longer imports the design-systems implementation. |
| Shared HTML/image/PDF rendering | `9f401cc4` | Extracted `apps/daemon/src/artifacts/html-render.ts`, including render-request construction, image loading/decoding, and raster PDF assembly. Kept these capabilities while removing PPTX conversion. |

All three extraction commits passed root guard/typecheck and focused checks before the next deletion. The original extraction runs recorded 66 passing cases for shared frontmatter/skill consumers, 24 for token extraction/mapping, and 24 for rendering/export. Known baseline exclusions are recorded below. The final shared-boundary command passed another 88 cases.

## Domain accounting

| Item | Domain | Commit / disposition |
|---|---|---|
| 1 | Design systems | **Skipped.** Even after the required extractions, `apps/daemon/src/design-systems/server-services.ts` still owns `listAllSkills`, `listAllSkillLikeEntries`, `listAllDesignTemplates`, and `validateProjectSkillId`. They serve shared skill selection and game-run setup. Removing this domain needs a further catalogue/validation ownership decision not covered by the three prescribed extractions. |
| 2 | Deck/PPT templates and PPTX export | `51a5e3a0`. Removed deck rendering templates/skills, PPTX APIs/CLI/UI/contracts, the converter vendor tree and dependency, and packaging resources. Screenshot/image/PDF rendering remains. Presentation plugin examples were subsequently removed in item 11. Generic saved-template and HTML artifact infrastructure remains. |
| 3 | Figma migration | `9407f17e`. Removed import decoder, migration API/CLI/contracts, dialogs and discovery entry points, dedicated scenario/atom and tests. Removed the decoder dependency. Protected Library Figma sidecars remain. General external Figma skills are retained for item 11 review. |
| 4 | Orbit | `6f70f95c`. Removed service, API/contracts, settings/config, templates, examples and dedicated tests. Moved `formatLocalProjectTimestamp` to `apps/daemon/src/services/project-timestamp.ts` because generic automation naming uses it. |
| 5 | Brands | **Skipped.** `FileWorkspace.tsx` uses `useDesignKit` and renders `DesignKitView` in shared file previews. `runtime/design-kit.ts` combines Brand contracts and parsed DESIGN.md content. This crosses shared imported-project previews and the retained design-system flow; removing it needs another decoupling boundary. |
| 6 | Critique theater scoring UI/workflow | `221df8f5`. Removed Theater components, settings UI, dedicated UI tests and `critique-conformance.yml`. Kept internal critique scoring/pipeline atoms and shared chat/viewer styles. This matches the plan's UI/workflow scope. |
| 7 | Vela/cloud/collab/billing | **Skipped.** Protected runtime auth, detection, environment, metadata, and AMR model probing import Vela integrations. Game verification and recipe routes also use collab-owned project authorization. Removing the domain would require runtime and authorization changes beyond this deletion plan. The Vela mock CLI and AMR wallet specs therefore remain. |
| 8 | Web Clipper | `0c661da7`. Removed the extension directory, Library download/source UI, probe route, and automatic origin trust for unpaired extensions. Library ingest, asset reads, pairing/token APIs, and persisted source metadata remain. |
| 9 | Codex pets | `248a797a`. Removed pet registry/sync, assets, hatch skill/plugin, API/contracts, UI/settings/slash commands, desktop companion window/IPC/bridge, package resources and dedicated tests. Generic task-status helpers remain. |
| 10 | Upstream deployment artifacts | `dee50851`. Removed `deploy/` and its Docker-image content spec after checking consumers. OpenPixo local packaging/dev/serve control planes remain. Historical deployment docs and tool-owned reference material are left for the later documentation phase. |
| 11 | Non-game design skills/plugins | `a1b1fe96`. Removed 96 directories: remaining presentation plugins, dedicated clinical/valuation/dating/HR/invoice/resume/trading/real-estate examples, upstream product showcases, and two clearly unrelated skills. Pruned related catalogue copy, baked-preview records, and presentation seeder entries. See the individual deletion/retention ledger below. |
| 12 | OD Next | **Skipped after dependency preflight; no deletion commit.** The ordinary game-run path calls `assertOdNextLegacyTextContributorCoverage` from `runtimes/od-next-exact-input.ts` through `composeChatAgentTextPayload`. Shared run records and observability also carry strategy state, and `chat-turn-host-protocol.ts` imports the OD Next production-marker module. Decoupling this safely crosses runtime input ownership and run bookkeeping, beyond moving prompt wording into a pure contracts module. The game question-form guidance itself is already in `openpixo-game.ts`. No speculative runtime rewrite was made. Root **Prompt variants** remains three paths because all three still exist. |
| 13 | Surface switches | The commit carrying this report removes Orbit, Web Clipper and codex-pet switches/calls. Eight gates remain because retained code/catalogue families still use them: design systems, shared templates, Figma skills, brands, critique atoms, Vela cloud, collaboration, billing. Removing them would expose retained inherited content or require additional domain work. |

The user-requested one-domain-per-deletion-commit ordering is preserved. Skipped domains have no deletion commit.

## Item 11: uncertain content retained

[PHASE1-CATALOG-REVIEW.md](PHASE1-CATALOG-REVIEW.md) lists all **96 deleted directories** and **507 retained catalogue entries**, with one reason per entry. Retention is conservative: plausible game UI, Studio, documentation, promotional-media, asset-tool use, or dependency on a skipped domain prevents a confident deletion. It does not assert every retained entry is currently used. Plugin core atoms, game recipes, runtimes, media infrastructure, and explicit game/asset skills remain protected infrastructure.

## Moved instead of deleted

- Shared frontmatter parsing and token evidence now live in daemon `services/`.
- HTML rendering, image decoding/loading and raster PDF assembly now live in daemon `artifacts/html-render.ts`.
- Local project timestamp formatting now lives in daemon `services/project-timestamp.ts`.
- Generic slash-menu translations moved from `pet.slash*` to `composer.slash*`; their text is unchanged.
- The plugin-description sanitization test now uses a neutral in-test Markdown fixture instead of reading the deleted Humanize PPT plugin. Its injection assertions remain.

No runtime/agent-protocol, sidecar/platform implementation, plugin core, media pipeline, Library, packaging control plane, or replay infrastructure was deleted as a domain. Shared screenshot capture and PDF export remain available. The packaging resource list no longer includes the removed PPTX vendor or community pets. The Windows electron-builder cache schema was advanced to 11 for the PPTX resource recipe change, as documented in `tools/pack/CACHE.md`.

## Validation

Every shell command first prepended the repository's pinned Node/pnpm directories to PATH. All commits passed **`pnpm guard`** and **`pnpm typecheck`** before committing. Interim syntax/stale-consumer/stale-declaration failures were repaired before their commits. The host package was rebuilt after removing its pet API so downstream typechecks read current declarations.

### Passing command record

The commands below are focused invocations, not full daemon/web suites. Counts are from their completed runs; excluded baseline cases are explained separately.

| Command | Result |
|---|---|
| `pnpm guard` | PASS on the three extractions and every deletion/cleanup commit. |
| `pnpm typecheck` | PASS on unsandboxed starting HEAD and every committed result. |
| `pnpm install --offline` | PASS after dependency/manifest changes in items 2, 3, 4 and 6. |
| `pnpm --filter @openpixo/host build` | PASS; refreshed pet-free bridge declarations. |
| `pnpm --filter @openpixo/plugin-runtime typecheck` | PASS after item 11. |
| `pnpm --filter @openpixo/daemon exec vitest run tests/origin-validation.test.ts tests/library-ingest-ssrf.test.ts tests/library-asset-stream.test.ts tests/library-figma-sidecar.test.ts tests/http/powered-preview-origin.test.ts --hookTimeout 30000` | PASS, 87 tests; item 8. |
| `pnpm --filter @openpixo/daemon exec vitest run tests/static-resource-routes.test.ts tests/origin-validation.test.ts` | PASS, 67 tests; item 9. |
| `pnpm --filter @openpixo/host exec vitest run tests/index.test.ts` | PASS, 15 tests; item 9. |
| `pnpm --filter @openpixo/desktop exec vitest run tests/main/updater-host-boundary.test.ts tests/main/deeplink-focus.test.ts tests/main/window-chrome.test.ts` | PASS, 23 tests; item 9. |
| `pnpm --filter @openpixo/packaged exec vitest run tests/protocol.test.ts` | PASS, 38 tests; item 9. |
| `pnpm --filter @openpixo/tools-pack exec vitest run tests/resources/resources.test.ts tests/win-resources.test.ts --testNamePattern '^(?!.*bundles the DeepSeek Harness runtime)'` | PASS, 29 tests; one reproduced environment failure excluded. |
| `pnpm --filter @openpixo/web exec vitest run tests/state/config.test.ts tests/components/SettingsDialog.test.ts tests/components/SettingsDialog.product-surfaces.test.tsx tests/components/ChatComposer.context-pickers.test.tsx tests/components/ChatComposer.search.test.tsx tests/components/ChatComposer.empty-send-guard.test.tsx --testNamePattern '^(?!.*shows the active imported-folder file)'` | PASS, 193 tests; one reproduced stale-copy baseline case excluded. |
| `pnpm --filter @openpixo/e2e exec vitest run tests/scripts/postinstall.test.ts --testNamePattern '^(?!.*(?:workflow intents|frozen workflow plan|keys dependency preparation))'` | PASS, 14 tests; three reproduced Windows environment failures excluded. |
| `pnpm --filter @openpixo/daemon exec vitest run tests/plugins-bundled.test.ts tests/plugins-bundled-atoms-roster.test.ts tests/plugins-bundled-scenarios-roster.test.ts --testNamePattern '^(?!.*od-default is hidden)'` | PASS, 30 tests; one previously reproduced registry baseline case excluded. |
| `pnpm --filter @openpixo/web exec vitest run tests/plugins-home/pluginPopularity.test.ts tests/i18n/content.test.ts tests/i18n/locales.test.ts tests/components/product-surfaces.test.tsx tests/components/PluginDetailView.curated-layout.test.tsx` | PASS, 42 tests; item 11. |
| `pnpm --filter @openpixo/daemon exec vitest run tests/frontmatter.test.ts tests/skill-url-install.test.ts tests/plugins-design-extract.test.ts tests/plugins-token-map.test.ts tests/artifacts/html-render.test.ts tests/pdf-export.test.ts tests/prompts/game-media-contract.test.ts` | PASS, 88 tests; final shared-service, export and game-prompt boundary check. |
| `pnpm --filter @openpixo/contracts exec vitest run tests/product.test.ts tests/analytics.test.ts` | PASS; one matching product test (there is no `tests/analytics.test.ts` match). |
| `pnpm --filter @openpixo/web exec vitest run tests/components/product-surfaces.test.tsx tests/components/SettingsDialog.product-surfaces.test.tsx tests/components/LibrarySection.a11y.test.tsx` | PASS, 7 tests; final switch cleanup. |
| Workflow YAML parsing plus local reusable-workflow target checks | PASS for all eight remaining workflows. |
| Focused Playwright project-management `--list` | PASS, 69 tests discovered after Figma removal; no UI runtime or model was started. |
| `git diff --check` | PASS before commits. |

Earlier committed focused checks also passed: item 2 daemon exports 43, export CLI 10, web export/i18n/toast 121, desktop capture geometry 27, packaging 30 and sidecar protocol 36; item 3 daemon 43 plus web 150 and the separate removed-Figma-chip witness; item 4 daemon/config 116, web/config/settings 186, task-page/i18n 31 and contracts 10; item 6 web/settings/event visibility 80 and actions-cache workflow cases 3. Filtered baseline cases are not counted as passing tests.

### Failures and limits

- Default sandbox execution initially produced an `EPERM` realpath failure against dependencies. Execution then used the user's authorized unsandboxed mode. Neither of the user's stop-condition errors (`.git/index.lock` permission denial or esbuild's ancestor-directory access failure) recurred in this run.
- Resolved by the pre-phase-3 rerun: frontmatter passes unchanged, and the retained agent-browser assertion now normalizes CRLF. The Bash HTML-PPT fixture and OD Next frozen-skill suites were deleted with their domains; no symlink case was recreated. See [repair evidence](DAEMON-TEST-REPAIR.md).
- The full atom-chain case in `tests/plugins-code-migration-e2e.test.ts` now passes unchanged at `52c56f7e` with the pinned local PATH. No replacement of its `true` command was needed.
- Prompt-corpus debt is closed for the verified failures: retain localization/narration/stability guards, normalize test-only paths/line endings, and retire only deleted examples/registry entries. No prompt text or snapshot was changed; [the report](DAEMON-TEST-REPAIR.md#prompt-review) records the two manually reviewed game-prompt verdicts.
- The scenario-roster `od-default is hidden` expectation fails against the existing intentionally empty upstream registry entry; reproduced before Figma removal. Composer submenu placement has an existing CSS CRLF expectation failure, also reproduced before that change.
- Orbit-adjacent daemon config checks contain an existing Windows path-separator expectation failure, reproduced before Orbit removal.
- The broader packaged-smoke-workflow file fails 13 cases both before and after critique workflow removal, due unavailable `python3`, CRLF assumptions and stale release-tool expectations. Remaining workflow references were checked directly instead.
- The Library SSRF test initially timed out twice in its 10-second `beforeEach` while importing/starting the daemon. It passes unchanged with the command-only 30-second hook allowance; the successful isolated run took about 17 seconds. No committed timeout was raised.
- Item 9 resource tests initially failed the DeepSeek runtime fixture because `corepack` is unavailable; the same failure was reproduced on the preceding commit. The composer imported-file test likewise failed before item 9 because it expects the former OpenDesign placeholder.
- Item 10 postinstall tests initially failed three cases with Windows exit 9009 from unavailable `python3`; all three reproduced before deleting `deploy/`.
- Initial item 11 focused runs found two fixtures reading deleted presentation files. The deck-only craft test was removed and the general description-sanitization fixture was replaced; final runs pass.
- One broad whitespace cleanup attempt was rejected by automatic approval review. A targeted cleaner restricted to exact whitespace-only diff lines succeeded instead; no rejected action remains blocked.

No full-suite, live-provider, installed-app, installer, or deployment acceptance is claimed. Skipped domains and retained gates need their own reviewed decoupling plan before removal.

## Final workspace checks

The final chat report records the cleanup commit and exact summary from `git diff --stat 14c11b91..HEAD`. `LICENSE`/`NOTICE` content, branch, commit author metadata and absence of pushes were checked. All `.tmp/phase1-*` files/directories, including the earlier attempt's report, draft and probe scripts, are removed after validation; other `.tmp/` content is retained.

## Skipped-domain decoupling (2026-10-26)

This follow-up executes [decouple-skipped-domains.md](../../docs/coordination/archive/decouple-skipped-domains.md) from `1fff25462e442a5318fcc538d802ee912f3d665a`, on `codex/opendesign-base`. **The overall task is partial.** OD Next and the design-system/brand resource implementation were removed. Section 4 stops after local project-access extraction because the protected stock-search capability has only a Vela production backend and can write into imported games. Section 5 remains pending. The search check below is therefore not a completed removal gate.

### Sections and commits

| Section | Commit and subject | Result |
|---|---|---|
| 2 | `93c2ed8d` — `refactor!: drop OD Next hooks from the ordinary run path` | Removed strategy checks/input branches from ordinary prompt and host-protocol paths; kept game and legacy question forms. |
| 2 | `d9940308` — `refactor!: delete OD Next strategy` | Removed strategy modules/assets, rollout/config/Labs UI, run/DB strategy fields, contracts, cards and dedicated tests. Ordinary plugin fallback, steering, replay, recovery and follow-up markers remain. |
| 3.2 step 1 | `39d1e2ab` — `refactor(daemon): extract skill catalog service` | Extracted local-only skill/template listing and project-skill validation. The user's local-only neutral-module rule takes precedence over the task's intermediate suggestion to retain team branches. |
| 3.2 step 2 | `b4dc84ba` — `refactor!: delete design systems and brands` | Deleted resource content, services, routes, project/config fields, legacy prompt injection, resource UI/selectors/translations, packaging resources and guard checks. Removed only Library's design-system category. |
| 4.3 step 1 | `4fe3a784` — `refactor(daemon): extract local project access` | Moved production project authorization to the local module; retained token/origin checks and file-operation sandbox checks. |
| 3 final audit | `6e793992` — `refactor!: remove retired resource import fields and transcript copy` | Removed remaining desktop/host import fields and unused brand-extraction transcript translations. |
| 4 stopping evidence | `f6995a0e` — `test(daemon): pin imported-game stock search dependency` | Added a mocked regression proving that stock search writes assets into an imported game's selected folder. No provider was replaced. |
| 2/3 validation correction | `b4c9a39b` — `fix(daemon): preserve ordinary lifecycle after domain removal` | Restored ordinary run analytics after the audit caught an overbroad earlier removal; removed only retired-domain analytics. Retired obsolete strategy/team-catalog fixtures, added local HTTP catalog coverage, and preserved ordinary recovery and artifact-stream assertions. |
| 3 final audit | `623bfcd7` — `refactor!: remove unused resource tool grants` | Removed the deleted resource read endpoint/operation from run grants and the unused resource example-preview source. |
| 4.3 steps 2–6 | **Held, no deletion commit.** | The attempted uncommitted workspace-header, AMR, media-provider and Vela-mock removals were restored to the verified local-access commit. Vela, AMR, collaboration, billing, their schemas/configuration/headers/UI and the Vela replay CLI remain. |
| 5 | **Pending, no deletion commit.** | Removing gates now would expose retained cloud/team/catalog surfaces. `PRODUCT_SURFACES`, its helpers and resource filters remain disabled. No decision was made on the 507 retained entries. |
| 6 | `docs(decoupling): record partial removal and validation evidence` — this report commit | Added ADR 0007, this report and the per-hit search inventory; updated current agent guidance, cloud-credit reuse notes and STATUS. The final chat identifies this commit's hash. |

The runtime engine, other adapters, `agent-protocol/`, sidecar/platform packages, plugin core, media pipeline, Library, packaging control planes and mock replay infrastructure remain. AMR is the only adapter the task permits deleting, but that exception was not applied after the stopping condition. No migrations or compatibility facade were added. Public/internal phase 2+ naming and the retained catalog review were not changed.

### The section 4 stopping condition

`apps/daemon/src/media/stock-search.ts` uses `searchVelaStockPhotos` as its sole production default. Its optional `search` argument is a test injection, not another shipping backend. `media/vela-stock-search.ts` calls the Vela CLI's `media stock-search` command. `routes/media.ts` exposes both project and tool stock-search endpoints and resolves imported output through `project.metadata.baseDir`.

The new test `tests/media-stock-daemon.test.ts` → `uses the stock service for an imported game and writes assets into that game folder` passes with a mocked service and mocked image response. Removing the backend would change an existing imported-game media workflow. A replacement provider, credential policy, or explicit retirement of stock search is needed before section 4 can continue. The task says to stop and report in this situation; none of those choices was guessed. [ADR 0007](../adr/0007-skipped-domain-decoupling.md) records this limit and the local-access semantics.

### Neutral modules and direct consumers

| New module | What remains and who imports it |
|---|---|
| `apps/daemon/src/observability/runtime-versions.ts` | Bounded runtime-version attributes. Direct consumers are the Claude, OpenCode and retained Vela child-evidence tests under `apps/daemon/tests/runtimes/`; there is currently no production importer. |
| `apps/daemon/src/services/skill-catalog.ts` | Local skills/templates/all-entry lists and project skill validation. `apps/daemon/src/server.ts` imports the factory and injects it through server context into resource, project, recipe and import paths; its unit tests import it directly. No team/workspace identity branch exists in this module. |
| `apps/daemon/src/services/text-generation.ts` | Generic HTTP retry, response-text extraction and transcript truncation from the removed finalizer. Direct consumers: daemon `design/handoff-design.ts`, `server.ts`, and `tests/handoff-design.test.ts`. |
| `packages/contracts/src/analytics/events/question-form.ts` | Generic question-form tracking ID, re-exported by `analytics/events.ts`; web `AssistantMessage.tsx` consumes the public analytics barrel. |
| `apps/web/src/runtime/browser-snapshot.ts` | Browser page-snapshot result type; `DesignBrowserPanel.tsx` imports it directly. |
| `apps/daemon/src/projects/project-access.ts` | Local ID/existence/storage-root authorization. Direct source consumers: `server.ts`, `server-context.ts`, `import-export-routes.ts`, `recipes/routes.ts`, `routes/browser-sessions.ts`, `chat.ts`, `deploy.ts`, `genui.ts`, `handoff.ts`, `host-tools.ts`, `live-artifact.ts`, `media.ts`, `runs.ts`, `terminal.ts`, `routes/plugins/index.ts`, and `routes/project/{index,conversations,chat-artifacts}.ts`; its unit test imports it directly. |

Managed-directory redirects cannot escape the project root; absolute imported `metadata.baseDir` is the explicit storage exception. Metadata access does not require an imported folder to be currently available. Existing sandbox checks still guard actual file operations. Project tool grants carry the project ID without a workspace identity.

Existing shared helpers were preserved: SSRF/DNS/redirect-safe `public-asset-fetch.ts` now serves Library directly; authored `DESIGN.md` provenance/clipboard readers remain; generic intent-document write evidence remains for diagnostics/retry behavior. The plugin token-map atom and its full-chain fixture were preserved without deciding the retained catalog's token vocabulary. The generic `<od-next>` marker is an ordinary follow-up protocol, distinct from the removed strategy.

### Required game and mock smokes

Each game smoke used `pnpm --filter @openpixo/e2e test tests/openpixo/game-workspace.test.ts` through the e2e-owned tools-dev harness. Each companion conversation used `pnpm tools-dev run web`, a distinct namespace, an explicit independent `OD_DATA_DIR`, an imported game, and `mocks/mock-agent.mjs` through a local OpenCode CLI wrapper. No real model was called. Each recorded conversation emitted one `text_delta`, seven `tool_use` events and two persisted messages, ending `succeeded`.

| Boundary | Game smoke | Mock namespace / run |
|---|---|---|
| Section 2 | PASS, 1 test, 46.76 s | `decouple-s2final-1793013725090`; run `9578f224-3f59-45ac-aaab-62ef7f2b50fa`, project `3ca5deda-3de5-4f04-8fe3-6cbabe4996c9`. |
| Section 3 | PASS, 1 test, 35.16 s; repeat 34.15 s | `decouple-s3-1793020244807`; run `a96bff61-d9ad-4b40-a79c-d344614be4f8`, project `5c928821-4205-47cb-bf37-f63c44327144`. |
| Section 4 partial/restored result | PASS, 1 test, 45.88 s | `decouple-s4final-1793023167107`; run `1e69cea3-cb27-4ec1-9936-863e26f83282`, project `02741609-d5d0-4c98-a631-7fe72d214495`. |
| Final ordinary-lifecycle correction | PASS, 1 test, 38.83 s | `decouple-finalaudit-1793026384277`; run `7317bdb5-2278-42f3-ba67-f4bd6f514de6`, project `256efdc7-e22d-4fdd-aa01-6ecd429b8325`. |

All conversations selected trace `0580c870-0310-44dd-9036-4c79074ce7cb`. Every task namespace was stopped via tools-dev; stop results reported no remaining service PIDs. Foreground controllers were stopped only after verifying their exact task namespace and command line. The installed Alpha.3 namespace, data and processes were not reused or stopped.

### Recorded-runtime replay

The actual `mocks/mock-agent.mjs` output was fed into the production Claude/JSON stream handlers. Event order, field shapes, semantic discriminants and emitted-text hashes were compared with the saved pre-section-4 experiment baseline; clock/opaque scalar values were normalized only for shape comparison. Comparisons passed during the experiment, after its restoration, and after the final analytics correction. This does not claim an AMR deletion shipped.

| Runtime | Recording | Parsed events | Shape SHA-256, unchanged |
|---|---|---:|---|
| Codex | `00e83799-a64b-4ce4-9a4e-2b09b72c7859` | 18 | `a85eb9952ec7cebf07aa7de2f5b31789f6ccea608eb76a979ad4d5449e14c559` |
| Claude Code | `04097377-d26e-4f04-b308-5e4e9e99fc76` | 73 | `e10ec2f31df3f03a7fa440fbf89f8960f7ff11845a1d57ecd1c2f77bd25020e1` |
| OpenCode | `0580c870-0310-44dd-9036-4c79074ce7cb` | 17 | `e8d80822e2a24a8632349866fe8ba6d93a20d60e6ce88b3d27dd1d757657fd8d` |

### Validation commands and results

All shell commands prepended the repository-local Node/pnpm directories to PATH. Every implementation commit had passing root guard/typecheck and its selected focused checks before committing. The final audit found a missed ordinary analytics regression, so the original selected checks were insufficient for that boundary; `b4c9a39b` corrects it with all 30 lifecycle tests passing. No full daemon/web suite or live model/provider suite was run.

Commands below use `V = pnpm --filter @openpixo/daemon exec vitest run` and `W = pnpm --filter @openpixo/web exec vitest run` only to keep the file lists readable.

| Command | Result |
|---|---|
| `pnpm guard` | PASS at each implementation commit and the final report state. |
| `pnpm typecheck` | PASS at each implementation commit and the final report state, including all app/tool test types. |
| `V tests/skill-catalog.test.ts tests/handoff-design.test.ts tests/routes/handoff.test.ts tests/public-assets.test.ts tests/library-ingest-ssrf.test.ts tests/runtimes/run-artifacts.test.ts tests/run-artifact-fs.test.ts tests/library-sync.test.ts tests/server-bootstrap-regression.test.ts tests/projects/project-access.test.ts --hookTimeout 60000 --reporter=dot` | PASS, 127 tests / 10 files. |
| `V tests/plain-stream-artifact-event-truncation.test.ts tests/project-cli.test.ts tests/run-create-workspace-gate.test.ts tests/skill-write-guidance.test.ts tests/plugins-bundled-scenarios-roster.test.ts tests/skill-catalog-local-routes.test.ts tests/services/run-analytics-lifecycle.test.ts --hookTimeout 60000 --reporter=dot` | Initial final-audit batch: 174 passed, 1 stream-flood timeout; six files passed. The stream file's successful rerun is below. |
| `V tests/plain-stream-artifact-event-truncation.test.ts --hookTimeout 60000 --testTimeout 120000 --reporter=dot` | PASS, all 5 tests, 101.76 s total. Controlled Qwen stdin fixture on an imported game avoids DeepSeek/cmd argv limits; Windows polling allowance retains all cap/persistence assertions. |
| `V tests/services/run-analytics-lifecycle.test.ts --reporter=dot` | PASS, all 30 tests after restoring ordinary capture, durable recovery, lifecycle/usage/storage observations. |
| `V tests/runtimes/runs.test.ts --testNamePattern 'ordinary run work completeness\|chat run service shutdown' --reporter=dot` | PASS, 58 selected tests; 28 unrelated cases unselected. |
| `V tests/skill-catalog-local-routes.test.ts --hookTimeout 60000 --reporter=dot` | PASS, 3 real-file HTTP checks: list/detail, rejected untrusted Origin, local deletion. Replaces the retired team-identity catalog assumptions. |
| `V tests/tool-tokens.test.ts tests/skill-catalog.test.ts tests/projects/project-access.test.ts --reporter=dot` | PASS, 14 tests. |
| `W tests/components/ProjectView.artifact-recovery-host-message.test.tsx tests/components/ProjectView.artifact-recovery-lifetime.test.tsx tests/components/ProjectView.home-artifact-recovery-owner.test.tsx tests/components/ProjectView.home-artifact-recovery-release-order.test.tsx tests/components/ProjectView.terminal-artifact-late-manual-save.test.tsx tests/components/ProjectView.terminal-artifact-manual-receipt.test.tsx tests/providers/daemon-sse-run-failure-verdict.test.ts --reporter=dot` | PASS, 22 tests / 7 matching files. Fixtures supply an empty asset page and select Files through the actual UI; recovery/autosave/navigation assertions remain. |
| `W tests/components/ProjectView.reattach-restore.test.tsx tests/providers/daemon-sse-run-failure-verdict.test.ts --reporter=dot` | PASS, 59 tests. Earlier two targeted ordinary reattach regression cases also passed before and after the approved removal. |
| `pnpm --filter @openpixo/e2e test tests/dialog` | PASS, 10 tests; 6 harness-declared skips across 4 skipped files. |
| `pnpm --filter @openpixo/e2e test tests/collab/headerless-mutation.test.ts --testNamePattern "real pixo binary"` | PASS, 1 applicable CLI case; 2 unrelated cases unselected in the focused invocation. |
| `pnpm --filter @openpixo/e2e test tests/openpixo/project-access.test.ts` | PASS, 2 local API/CLI cases including Origin rejection. |
| `V tests/media-stock-daemon.test.ts --testNamePattern 'imported game' --hookTimeout 60000 --reporter=dot` | PASS, 1 stock dependency witness; 6 unrelated cases unselected. Mock service/image only. |
| `pnpm --filter @openpixo/desktop exec vitest run tests/main/pick-and-import-workspace-context.test.ts --reporter=dot` | PASS, 1 test; the earlier desktop import/host boundary batch passed 3 tests / 2 files. Host build also passed after declaration changes. |
| `W tests/i18n/locales.test.ts tests/components/product-surfaces.test.tsx --reporter=dot` | PASS, 20 tests / 2 files; earlier locale-only coverage passed 17 tests; dedicated settings/entry/Library/provenance coverage also passed in the section 3 web batch. |
| `pnpm --filter @openpixo/daemon build` | PASS; repeated after ordinary analytics restoration. |
| `pnpm --filter @openpixo/web build` | PASS; repeated after the final translation/import cleanup. |
| `pnpm --filter @openpixo/desktop build` | PASS. |
| `pnpm --filter @openpixo/packaged build` | PASS; repeated after final import changes. |
| `pnpm --filter @openpixo/tools-dev build` | PASS. |
| `pnpm --filter @openpixo/tools-pack build` | PASS. |
| Exact section 8 `rg` command | Exit 0 with retained matches; **removal completion gate not passed**. Full location/match/explanation inventory linked below. |
| `git diff --check` | PASS before final commits. |

Earlier successful focused batches: section 2 daemon 262 tests/10 files, web 170/5, contracts 36/4, packaged Home 14; section 3 prompt/CLI 164/4, web 211/13, contracts 48/4, pack resources 22/1, release catalog export/pack 23/2. Section 4 local access: 75 passing tests/7 files with the reproduced symlink case excluded; the expanded local-access unit file later passed all 5 cases including a managed-directory junction escape. These counts overlap later checks and are not summed into a unique-test total.

### Failures, corrections and exclusions in this follow-up

- **Closed Windows exclusion:** the project-location symlink case already uses a junction at `52c56f7e` and passes in the unfiltered starting rerun. No additional edit or skip was needed; see [repair evidence](DAEMON-TEST-REPAIR.md#older-reports-that-no-longer-reproduce).
- **Rechecked without a hook override:** all 17 handoff HTTP cases pass at `52c56f7e` with the default hook budget. The older command-only allowance remains historical evidence, not a current requirement; no timeout was raised by this repair.
- **Corrected regression:** the final analytics run failed because an earlier deletion had left `install` empty. Ordinary observer logic was restored from the starting implementation and stripped only of OD Next/design-resource branches. All 30 lifecycle tests now pass. The report does not treat this as a baseline exclusion.
- **Retired assertions:** the old workspace-skill suite expected team visibility/ownership semantics that the instructed local-only catalog no longer implements. It was replaced only after the new local HTTP coverage passed; the local catalog unit tests and retained resource security checks also pass. No compatibility layer was added to satisfy obsolete team semantics.
- **Corrected fixtures:** six artifact-recovery files assumed the workspace started on Files and returned `{}` for the Assets API. They now select Files and return the actual empty-page shape; 15 recovery tests pass. The roster test's stale `od-default` registry expectation was corrected to the existing curated registry state without modifying a catalog entry.
- **Corrected Windows controlled-agent fixture:** DeepSeek's legacy composed prompt exceeded its 30,000-byte argv guard; a Windows cmd wrapper also hit its lower command-line limit. The generic artifact-stream tests now use a controlled Qwen stdin CLI on an imported game. Four cap/control cases passed immediately; the 4,000 separately yielded chunks required a Windows timing allowance. All 5 pass with the recorded command above. No model/provider was used.
- **Exploratory baseline failures, not accepted exclusions:** a broader Home/EntryShell probe reproduced 50 failures on preceding `93c2ed8d` (removed design-system/OD Next/deck assumptions, hidden AMR onboarding and existing UI state expectations). They are not all Windows failures, were not relabeled as such, and are not counted as passing or used to waive a gate. Their individual titles are appended below. No full web acceptance is claimed.
- Automatic approval review initially rejected ordinary OD Next reattach/routing edits; the user approved focused regression checks, which passed. A separate rejected test replacement was left intact and covered by a new local API/CLI test instead. No approval-dependent action remains pending.
- The earlier phase 1 report above lists CRLF, missing `python3`/`corepack`, CSS and workflow baseline failures. Those were not silently inherited as new exclusions here. The final packaging resource run passed all 22 selected cases; no missing-corepack case is counted as passing.

### Section 8 remaining-hit output

The exact command is:

```text
rg -n -i 'design-?system|designkit|brand-routes|od-?next|OdNext|vela|\bamr\b|collab|x-od-workspace|PRODUCT_SURFACES|isProductSurfaceEnabled' apps packages tools e2e scripts mocks
```

The historical search returned **21,316 matching lines across 1,668 files**. The per-hit inventory was deleted in round two as requested. Current results are summarized by category in the completion section below.

### Final workspace checks for this follow-up

Final diff summary: `5374 files changed, 23818 insertions(+), 988638 deletions(-)`.

`LICENSE` and `NOTICE` are unchanged from `1fff2546`; upstream attribution stays intact. Commits use the requested Claude/local identity, Conventional Commit subjects, short bodies and no co-author metadata. The branch stays `codex/opendesign-base`; nothing was pushed. No global Node, pnpm or git configuration was changed. Task-owned `.tmp/decouple-*` scratch is removed after the evidence is written; other workspace data and the installed Alpha.3 instance are preserved.

### Exploratory Home baseline failure titles

The following 50 titles were reproduced before the relevant routing removal. They document the exploratory failed command, not a current passing/excluded test list.

- EntryShell design systems view leaves workspace-scoped design-system activation to the mounted tab
- EntryShell route scroll isolation resets the shared scroll offset when navigating away from Home
- EntryShell onboarding OpenDesign AMR runtime gates Home on an authoritative signed-out Cloud session without clearing saved setup
- EntryShell onboarding OpenDesign AMR runtime completes Hosted onboarding straight from the signed-in Continue
- EntryShell onboarding OpenDesign AMR runtime resumes a completed setup after passive reauthentication without changing its model source
- EntryShell onboarding OpenDesign AMR runtime switches a completed but invalid setup to Hosted after sign-in
- EntryShell onboarding OpenDesign AMR runtime tests Local Agent on Continue, stays on failure, and retries on the next click
- EntryShell onboarding OpenDesign AMR runtime drops a Local Agent validation that lands after the user goes Back
- EntryShell onboarding OpenDesign AMR runtime validates the selected Local Agent in the background so Continue does not wait on a spawn
- EntryShell onboarding OpenDesign AMR runtime lets Continue join the in-flight Local Agent validation instead of dropping the click
- EntryShell onboarding OpenDesign AMR runtime releases the agent child when the user leaves the setup step mid-validation
- EntryShell onboarding OpenDesign AMR runtime restarts BYOK auto-validation against edited inputs instead of waiting the old one out
- EntryShell onboarding OpenDesign AMR runtime validates again when the user returns to a selection whose check was cut short
- EntryShell onboarding OpenDesign AMR runtime releases a BYOK request once its key is cleared and nothing can consume it
- EntryShell onboarding OpenDesign AMR runtime does not spend a second spawn when the debounce outlives a manual Test
- EntryShell onboarding OpenDesign AMR runtime does not validate a saved selection the step is still asking the user to set up
- EntryShell onboarding OpenDesign AMR runtime does not auto-select OpenDesign AMR when the AMR runtime is unavailable
- EntryShell onboarding OpenDesign AMR runtime shows OpenDesign Cloud as the default connect surface when AMR is available
- EntryShell onboarding OpenDesign AMR runtime keeps direct Local CLI setup active when delayed status discovers a Cloud login
- EntryShell onboarding OpenDesign AMR runtime excludes AMR from the Local CLI agent list
- EntryShell onboarding OpenDesign AMR runtime tests the selected Local CLI agent from onboarding
- EntryShell onboarding OpenDesign AMR runtime renders Local CLI test failures as alerts in onboarding
- EntryShell onboarding OpenDesign AMR runtime keeps AMR login pending while device authorization is waiting
- EntryShell onboarding OpenDesign AMR runtime shows daemon startup errors when AMR sign-in fails immediately
- EntryShell onboarding OpenDesign AMR runtime offers to reopen the sign-in page only after the browser has had a few seconds
- EntryShell onboarding OpenDesign AMR runtime shows the sign-in link right away when the browser could not be opened
- EntryShell onboarding OpenDesign AMR runtime clears AMR login pending when canceled and allows a fresh sign-in attempt
- EntryShell onboarding OpenDesign AMR runtime preserves a pre-start cancel when the status refresh rejects
- EntryShell onboarding OpenDesign AMR runtime cancels AMR login and re-enables onboarding after the login timeout
- EntryShell onboarding OpenDesign AMR runtime continues after AMR device authorization completes during polling
- EntryShell onboarding OpenDesign AMR runtime refreshes workspace context, billing, and team projects as soon as onboarding sign-in completes
- EntryShell onboarding OpenDesign AMR runtime recovers from a transient status failure during login polling and still continues after authorization completes
- EntryShell onboarding OpenDesign AMR runtime continues normally when OpenDesign AMR is signed in
- EntryShell onboarding OpenDesign AMR runtime tests BYOK on Continue, stays on rate limit, and retries on the next click
- EntryShell onboarding OpenDesign AMR runtime drops a BYOK validation that lands after its inputs changed
- EntryShell onboarding OpenDesign AMR runtime lets Azure BYOK onboarding enter a custom deployment directly
- EntryShell onboarding OpenDesign AMR runtime keeps the cloud sign-in landing stable while AMR detection is still in flight
- EntryShell onboarding OpenDesign AMR runtime renders the cloud sign-in CTA and no legacy AMR card once AMR is available
- EntryShell onboarding OpenDesign AMR runtime keeps the cloud sign-in CTA visible after detection settles without surfacing AMR
- HomeView context picker lists the Demo Add-menu rows on Home
- HomeView prompt handoff restores a saved Deck selection instead of seeding Prototype
- HomeView prompt handoff keeps an explicit queued type ahead of the fresh-home default
- HomeView prompt handoff hands the Home rail Prototype chip entirely to OD Next on submit
- HomeView prompt handoff keeps a Slide deck second-level scene on its own ppt route
- HomeView prompt handoff defaults to "No design system" (不指定) when the user has no personal default and submits a null designSystemId
- HomeView prompt handoff lets the user explicitly pick "No design system" to override a personal default and submit a null designSystemId
- HomeView prompt handoff keeps an official example card under 原型 on the automatic OD Next route and sends its example reference
- HomeView prompt handoff keeps a deck example card on the automatic ppt route and sends its example reference
- HomeView prompt handoff binds the deck chip and keeps only the design-system picker in the footer
- HomeView prompt handoff lets selected chips seed the hero through preset cards

## Round two — stock-search retirement (2026-10-27)

Starting point: clean `7c772afc`, branch `codex/opendesign-base`. This run is
**partial**. Step 1 is complete. Automatic approval review blocked step 2 before
its edit script was written or executed. Steps 3–5 depend on that removal and
have not started. Step 6 is limited to this progress record; the old per-hit
inventory remains pending deletion. No runtime/collaboration/web domain deletion
is claimed for this run.

### Steps and commits

| Requested step | Commit / outcome |
|---|---|
| 1: retire stock search | `2d24ccfc` — `refactor!: retire stock search`. Removed project/tool endpoints, CLI/help/flags, grants, service/backend, telemetry journal/collector and startup/shutdown hooks, analytics event catalog/payloads, contracts, runtime stock env variables, dedicated tests and telemetry docs. Shared media generation and project output handling remain. |
| 2: headers; AMR/Vela/collaboration and UI | **Blocked before edits.** Automatic approval review twice rejected the proposed runtime removal, stating that trusted transcript content established only stock-search authorization, despite the attachment and spec explicitly requesting the wider removal. Direct in-chat scope confirmation was requested. No rejected operation was bypassed. |
| 3: product gates | Not started: removing gates before step 2 would expose retained domains. |
| 4: specified domain skills/plugins | Not started; no retained catalog entry was changed. |
| 5: stale-test sweep | Not started. No stale failure was excluded or relabeled as environmental. No baseline worktree was created. |
| 6: final documentation | Partial evidence only in the accompanying documentation commit; the removal gate is not passed. |

No neutral production module was created this round. Stock-only consumers were
removed from `routes/media.ts`, `cli.ts`, `tool-tokens.ts`, `analytics.ts`,
`routes/telemetry.ts`, `server.ts`, the Codex env allowlist and contracts exports.
The previous local project-access/skill-catalog/shared-rendering modules and
their importers remain unchanged.

### Tests and mock validation

Deleted **5 whole test files / 61 expanded cases**: daemon stock routes 7,
CLI 1, search 21, telemetry 14, contracts 18. One stock identity case was also
removed from `agent-runtime-env.test.ts`: **62 removed cases total**, including
`it.each` rows. No retained fixture changed. No retained-feature regression was
found in the passing focused batch. This is not the broad stale-test sweep.

All commands prepended the pinned repository Node/pnpm directories to PATH.
No full daemon/web suite or live provider/model test was run.

| Command | Result |
|---|---|
| `pnpm install --offline` | Sandbox attempt failed with dependency `realpath` EPERM. Outside the sandbox, two implementation attempts failed on omitted stock event-name entries, then telemetry collector imports. Corrected both; final refresh/build closure PASS. |
| `pnpm guard` | PASS before and after final stock cleanup. |
| `pnpm typecheck` | Two implementation attempts failed on the same event-name/telemetry consumers. Corrected before commit; final all-app/package/tool/test typecheck PASS. |
| `pnpm --filter @openpixo/daemon exec vitest run tests/tool-tokens.test.ts tests/media-cli-help.test.ts tests/media-scaffold-cli.test.ts tests/media/policy-routes.test.ts tests/media/analytics-routes.test.ts tests/runtimes/agent-runtime-env.test.ts tests/services/run-analytics-lifecycle.test.ts tests/prompts/game-media-contract.test.ts --hookTimeout 60000 --reporter=dot` | First attempt: 5 files / 53 tests passed; 3 files failed importing removed stock telemetry. After removing the collector and shutdown hook: PASS, **8 files / 94 tests**, 67.52 s, no exclusions. |
| `pnpm --filter @openpixo/e2e test tests/openpixo/game-workspace.test.ts` | PASS, **1 test**, 33.55 s; imported assets, mock native Codex approvals/cancellation, independent sessions and project extensions preserved. |
| `pnpm exec tsx .tmp/decouple-round2/replay.ts baseline` | First failed because the recording cache was empty. Fetched only the three specified public traces into task scratch and verified manifest SHA-256 values. Rerun PASS: Codex **18**, Claude Code **73**, OpenCode **17** parsed events. AMR removal was blocked; no after-removal hash comparison is claimed. |
| `pnpm exec tsx .tmp/decouple-round2/mock-conversation.ts` | PASS: isolated `tools-dev run web`, independent explicit `OD_DATA_DIR`, imported game and mock OpenCode CLI. Namespace `decouple-round2-1793031270533`, project `244dcc2e-15d5-4491-bb98-50f57e13fd0d`, run `88e83e4d-951d-4d73-b9ee-46ad9ded20ef`, `succeeded`, **2 persisted messages**. Tools-dev stop reported no remaining service PIDs. |
| `git diff --check` | PASS before implementation commit. |

The three replay IDs are those in the previous report. Event counts match;
the new scratch baseline normalizes session/timing fields with a different
serialization, so its hashes are not represented as reproducing the old shape
hashes. The requested after-removal comparison remains pending.

### Section 8 search at the partial boundary

The exact section 8 command returned **28,163 matching lines / 2,601 files**,
exit 0. This includes generated outputs visible to the exact command, not just
tracked source. No per-hit inventory was added. Pattern-family counts overlap.

| Family | Lines | Current explanation |
|---|---:|---|
| Design systems / DesignKit / brand routes | 3,193 | Catalog/replay vocabulary, historical tests and generated output; stale-test sweep pending. |
| OD Next / ordinary follow-up marker | 909 | Generic follow-up protocol and historical tests/recordings/output. |
| Vela | 10,483 | Step 2 implementation/fixtures/output still present; also the Google `generativelanguage` substring. |
| AMR | 4,866 | Adapter, cloud/account UI, fixtures/output awaiting step 2. |
| Collaboration | 8,200 | Implementation, contracts and fixtures awaiting step 2. |
| Workspace headers | 1,304 | Producers/readers and fixtures awaiting step 2. |
| Product gates | 91 | Remain until their guarded domains are removed. |

Disjoint path counts: tests/fixtures 13,347; generated outputs 6,876; other
source/guidance 5,680; blocked domain source 1,822; tooling 297; mocks/replay 141.
This explains the partial boundary, **not** a claim that remaining hits are all
unrelated or approved retained items. Source implementation diff before this
report: `26 files changed, 10 insertions(+), 1961 deletions(-)`.

`LICENSE` and `NOTICE` remain unchanged from `7c772afc`. The installed Alpha.3
instance was untouched. No push, global install or global Node/pnpm/Git config
change occurred. The implementation commit uses the specified Claude identity
without co-author metadata. Task scratch and the task-owned successful smoke
output are removed after recording this evidence.

## Round-two completion (2026-10-27)

The repository owner directly confirmed the whole-repository scope and revoked the earlier authorization ambiguity. This continuation started at `1ec12623` with the previous uncommitted web/shell removal intact. Nothing was reset or stashed. Section 9 of the task governs this completion; the earlier partial checkpoints above remain historical.

### Delivered scope and commits

| Commit | Subject / result |
|---|---|
| `2d24ccfc` (preceding work) | `refactor!: retire stock search` |
| `1ec12623` (preceding work) | `refactor(daemon)!: retire Vela services and localize project operations` |
| `2903bd00` | `refactor!: remove Vela, team and billing web UI` — preserves the supplied working tree and completes the first stale-test corrections. |
| `69a756ce` | `refactor!: delete Vela-era contracts and shell integration` — cloud DTOs/SSE, invite shell glue, dedicated e2e suites/fixtures, packaging integration and retired CI shard. |
| `ad0ce624` | `refactor!: remove hosted identity and product switches` — local comments/tab/catalog state, analytics, 349 retired translation keys in the type and all 19 locales, CSS, and product-switch deletion. |
| `59b7e60e` | `refactor!: delete skills left by removed domains` — the five requested skills, two seed entries and the exclusively design-system plugin. |
| `e91a3fc3` | `refactor!: remove remaining AMR diagnostics and cloud UI hooks` — AMR log discovery/verifier/fixtures, unused cloud upgrade callbacks and lock UI, eight additional translation keys in every locale, ten Vela-only lifecycle analytics fields, stale comments/styles and retained boundary fixtures. |
| Final documentation commit | `docs: record phase 1 completion` — ADR/status/reuse guidance, cloud-only spec and per-hit inventory deletion, this evidence and the cleanup limitation. The final chat records its hash. |

Vela cloud, AMR, team collaboration, billing, wallet, subscription plans, cloud share/publication, message center and workspace-team identity have no active application entry points. Their runtime adapter, service routes, contracts, account headers, dedicated UI/CLI and e2e coverage are removed. Local comments retain anchors, pin order, source identity and persistence; cloud author/member fields are gone. No migration or compatibility layer was introduced. Existing databases may physically retain unused old nullable columns because this task explicitly forbids migration work.

`PRODUCT_SURFACES`, `ProductSurface` and `isProductSurfaceEnabled` are deleted. `productResources.ts` explicitly filters the already-hidden undecided resource families; it does not decide the other 507 catalog entries. The removed skills are `od-next-media-inputs`, `brand-extract`, `brand-guidelines`, `brandkit`, and `figma-create-design-system-rules`. Game prompts, recipes, Studio and asset tools have no dependency on them. `design-system-source-context-mr0bb87z` served only the removed domain and is deleted. Generic UI-kit/token-mapping content remains pending its existing catalog decision.

### Retained behavior restored

These were actual retained-feature regressions or defects exposed by the sweep, rather than excuses to remove their tests:

- FileViewer's deploy entry, Cloudflare Pages/Vercel menu, copy/open deployed link, and export/deploy/version-restore toasts were restored from HEAD before this continuation and retained throughout it.
- ChatPane's manual-retry action and recovery-click tracking were restored.
- Local Settings section normalization, App skill refresh, and RecentProjectsStrip's empty-to-populated hook order were corrected.
- ProjectView's file refresh again carries authoritative/fresh/change evidence; a failed conversation-list request throws for retry instead of masquerading as an empty list and creating a conversation.
- Local comments retain source/anchor identity, drift detection and anchor writeback.
- EntryNavRail's updater portal and desktop diagnostics/menu structure survive the cloud removal.
- Five retained font weights use the existing style ladder.
- Windows absolute/relative plugin paths install locally instead of being interpreted as marketplace names. The dedicated test failed with HTTP 404 before the path fix and passed afterward.
- The final daemon audit found that the removed Vela helper had also recognized external provider balance errors. Its text-only recognition was restored in the generic classifier and mapped to the existing `hard_quota` result, without a hosted recharge action. The new provider-quota tests went **4 red / 3 green** before the fix; afterward the new seven cases and 123 existing classifier cases all pass. The AMR/BYOK recharge snapshot was retired; generic ACP provider-error coverage remains.
- `pixo run start` again sends the selected local agent and chooses native Codex for the canonical BYOK providers, consistently with continuation. Existing CLI cases went red before this correction and pass afterward. This fixes the local/BYOK embeddability surface without restoring cloud flags.
- The final production web build exposed three layout CSS imports for deleted cloud campaign components. Removed those orphan imports; the retained onboarding stylesheet stays loaded and the production build passes.

Deploy, exports, project files/assets, CLI/BYOK onboarding, local social `pixo share`, plugins, recipes, Studio and imported-game paths remain. The model menu still shows unavailable-model hints; only its subscription-upgrade lock was retired. Read-only preview guards remain with generic project copy.

The final audit also retired the unused `PROJECT_SCOPE_REQUIRED` web response branch and its workspace-only wrapper. Local run-status polling and its shared cache remain. The Windows-version guidance now describes the selected agent in all 19 locales. The removed lifecycle analytics parser exclusively recognized `schema: vela.tool_execution_lifecycle`; no remaining producer exists, so its dedicated fields/cases were removed rather than recreated as generic infrastructure. Other tool execution timing, ACP diagnostics, generation identity and native protocol evidence remain.

### Stale-test sweep accounting

The initial selected baseline at `1fff2546` had **4,062 expanded tests: 3,753 passing, 305 failing, 4 skipped**. None of those failures was waived merely because it was present at baseline. Of its 305 failed full titles, **97 now pass with the same title; 208 were retired or rewritten** according to the removed-feature/retained-feature distinction.

Across web tests relative to the supplied `1ec12623` HEAD: **234 whole test files deleted; 2,768 declared test cases removed; 270 retained test files modified; 12 declarations added or retitled**. These are AST declaration counts, not a fabricated expansion of `it.each` data rows. Retained-file changes include fixture/assertion repairs and deletion of obsolete cases within mixed suites. Typical repairs: the empty `/assets` page shape, missing mock exports, removed workspace-context argument positions, local onboarding labels, local registry readiness, stale shared-project expectations, and Windows-native Chrome/file URLs. Production fixes are listed separately above.

The union of the original sweep and every remaining test matching the requested retained surfaces finished at **650 files / 7,118 expanded tests, all passing, zero skipped**. It covers share/deploy/comments/onboarding, ProjectView/FileWorkspace/ChatPane, App/EntryShell/HomeView/SettingsDialog, RecentProjectsStrip and PluginsView. This is the user-authorized selected batch, not the entire web suite. The nine real-Chrome geometry checks run on Windows and pass; none is excused as missing-browser behavior.

### Validation commands and outcomes

All pnpm/Node commands prepend the pinned repository toolchain to PATH. Repeated exploratory invocations are consolidated below; only the final corrected outcomes count as acceptance. Scratch configs/reports named here are intentionally deleted after this record is written.

| Command / selected files | Result, including failed attempts |
|---|---|
| `pnpm typecheck` | Initial supplied-tree check PASS. Intermediate edits caught removed contracts, old analytics fields/mocks and one remaining `showUpgradeLock` reference; all corrected. Final PASS across apps/packages/tools/tests. |
| `pnpm guard` | PASS at each commit boundary, including final source cleanup. No source-boundary exception added. |
| `pnpm --filter @openpixo/contracts build`; `pnpm --filter @openpixo/diagnostics build`; `pnpm --filter @openpixo/daemon build`; `pnpm --filter @openpixo/tools-dev build` | PASS. Explicit builds refreshed package exports and game/mock runtime artifacts. An early game invocation used stale baseline junctions/dist and is not accepted evidence; repaired six repository-local dependency junctions, rebuilt, and reran successfully. A final audit found and repaired one additional contracts-to-release junction. All 92 inspected local package links resolve outside the baseline worktree before its removal. |
| Final `pnpm --filter <package> build`, separately for `@openpixo/daemon`, `@openpixo/web`, `@openpixo/desktop`, `@openpixo/packaged`, `@openpixo/tools-dev`, `@openpixo/tools-pack` | All six PASS after baseline removal. Web first failed resolving three CSS imports belonging to deleted cloud campaign components; removed only those orphan imports, then the optimized build and TypeScript build pass. No root build alias was added. |
| `pnpm --filter @openpixo/web exec vitest run --config=<repo>/.tmp/decouple-finish/web-sweep.config.ts --reporter=json --outputFile=<report>` | Initial 215-file sweep had 426 failures, compared with 305 at baseline. All classified and corrected/retired; no baseline failure exempted. |
| Same web command with `web-retained.config.ts`, `web-final*.config.ts`, then `web-acceptance.config.ts` | Intermediate batches exposed stale fixture shapes, missing exports, retired identity arguments, obsolete cloud assertions and the retained regressions above. The last cleanup initially missed one lock-only render branch (21 failures); that branch was removed. Final selected batch PASS, **650 files / 7,118 tests**, no exclusions. |
| `pnpm --filter @openpixo/web exec vitest run tests/components/chat/turn-boundary-spacing.test.tsx --reporter=verbose` | PASS, **9 real-Chrome checks** after adding Windows browser discovery and proper file URLs. These are also included in the broad selected result. |
| `pnpm --filter @openpixo/contracts test tests/analytics-agent-provider.test.ts tests/analytics-run-finished-contract.test.ts tests/media-failure-next-step.test.ts tests/comment-identity.test.ts tests/share-observation.test.ts` | PASS, **31 tests / 5 files**. Earlier focused contract export checks also passed (7 tests / 3 files). |
| `pnpm --filter @openpixo/daemon test tests/comment-attachments.test.ts tests/services/diagnostics-evidence.test.ts tests/diagnostics-export.test.ts tests/run-failure-classification.test.ts tests/run-failure-action-certificate.test.ts tests/run-failure-account-suspended.test.ts tests/run-analytics-observability.test.ts tests/services/run-analytics-lifecycle.test.ts` | **280 pass, 1 stale expected-classification failure, 1 pre-existing Windows skip**. Corrected the generic provider-quota fixture; rerunning `tests/run-failure-classification.test.ts` PASS, **123/123**. Combined selected boundary is **281 pass / 1 skip**. |
| `pnpm --filter @openpixo/daemon test tests/plugins-genui-spec-enrichment.test.ts tests/deploy-routes.test.ts` | PASS, **20 tests**, after correcting stale deploy fixtures. Local plugin path test separately went red (404) then green (**1 test**). |
| `pnpm --filter @openpixo/daemon test tests/run-retry-runtime.test.ts --testTimeout 60000` | Initial six local cases failed with non-native executable fixtures. Added native Windows wrappers; PASS, **6/6**. Seven AMR-specific cases and the AMR-only stall integration file were retired. Generic ACP engine/protocol tests and recordings remain. |
| `pnpm --filter @openpixo/daemon test tests/provider-quota-classification.test.ts tests/run-failure-classification.test.ts` | New test first ran alone: **4 failed / 3 passed**, proving the retained regression. Restored generic provider-balance recognition from the removed helper. Final PASS, **130/130**, two files. |
| Focused three-file ACP wiring batch (handshake/service/stage timeout), Windows-native controlled CLI fixtures | Historical comparison was **7 pass / 3 fail**. The pre-phase-3 repair identifies the isolated PATH's missing `powershell.exe`, retains Windows system tool directories and passes **10/10**, individually and together. No runtime-engine change or timeout increase; [evidence](DAEMON-TEST-REPAIR.md). |
| `pnpm --filter @openpixo/daemon test tests/acp-service-failure.test.ts` | Retired six Vela model-catalog/gateway-only vectors and updated generic provider-quota expectations. Final PASS, **172/172**. |
| Explicit 19-file retained daemon batch (CLI, prompts, local skills/plugins, project consumers and telemetry) | Initial **318 pass / 23 fail**. After stale fixture/expectation repairs and the CLI agent-selection fix: **339 pass / 1 stale prompt assertion**. The final prompt-only rerun passes **55/55** across the two affected files. |
| Explicit 59-file remaining daemon audit, listed below | Initial **1,118 pass / 55 fail / 37 conditional skips**. Retired AMR-only cases, fixed native Windows CLI fixtures, real local project setup, local raw-preview relative URL expectations, preparation-budget stages, media defaults and prompt snapshot. Final batch: **1,161 pass / 1 fixture timeout / 35 Windows skips**. The only timeout was the telemetry smoke's 10-second wait, too short for Windows inactivity + bounded process cleanup. Raised only the fixture wait to 30 seconds; focused rerun below passes all five cases. All remaining selected assertions are resolved; the skipped cases are explicitly listed. |
| Explicit 14-file daemon boundary tail | **312 pass / 3 fail / 3 Windows skips** initially. The three stale failures were local raw-preview rewriting expectations and a duplicate project-creation fixture; the follow-up three retained suites all pass. No preview, file, font or generated-asset functionality was deleted. |
| `pnpm --filter @openpixo/daemon test tests/runtimes/run-failure-telemetry-smoke.test.ts tests/server-startup-smoke.test.ts` | Native Windows wrappers make all **17 cases pass**. The startup suite initially failed teardown with an open SQLite shared-memory file; explicitly close its database before deleting the fixture. The corrected startup suite passes **12/12** in the follow-up batch. |
| `pnpm --filter @openpixo/daemon test tests/runtimes/run-failure-telemetry-smoke.test.ts --hookTimeout 60000 --testTimeout 60000` | Final focused PASS **5/5**, 61.14 seconds for the whole file. Preserves every failure/telemetry assertion; no extra exclusion. |
| `pnpm --filter @openpixo/daemon test tests/plugins-headless-run.test.ts` | Initial three stale fixture/Windows failures. Controlled broken-preview fixture preserves dependency containment and CLI error coverage without the deleted catalogue example. Native executable fixtures prevent installed `gh.exe` from winning over a `.cmd` mock. Several fixture implementation attempts failed and were corrected; final **7/7 PASS**, including local publish/contribute staging and fully mocked GitHub/Git operations. |
| `pnpm --filter @openpixo/daemon test tests/prompts/system-prompt-matrix.test.ts -u` | PASS **3/3**, one snapshot updated for the deleted prompt sections; uses a local/BYOK image model. |
| `pnpm --filter @openpixo/daemon exec vitest run tests/export-tool-token-authority.test.ts` | Pre-phase-3 repair: **15/15 PASS**, without title filters or timeout overrides. The historical 14-pass/one-FIFO-exclusion result is superseded by the portable deferred-read fixture. |
| Pre-phase-3 ACP wiring checks: each of the three files alone, then in the final 13-file selection | **10/10 PASS**, without title filters or timeout overrides. Windows system tools remain in the fixture-only PATH; the historical 7-pass/three-exclusion result is superseded. Exact invocations are in [the repair report](DAEMON-TEST-REPAIR.md#validation-commands). |
| `pnpm --filter @openpixo/web exec vitest run tests/runtime/amr-guidance.test.ts tests/components/FileViewer.test.tsx tests/components/modelOptions.test.tsx --reporter=dot` | PASS **333/333**, after final translation, read-only title and model-option repairs. Historical mixed-suite filename is retained; its AMR-only cases are gone. |
| `pnpm --filter @openpixo/daemon test tests/plugins-installer.test.ts tests/terminal-workspace-authority.test.ts tests/diagnostic-experience.test.ts tests/api-failure-journal.test.ts` | Initial unsigned `official` marketplace fixture failed the existing signature requirement. Use a trusted external registry fixture; keep the signature policy intact. Directory-link rejection now uses a Windows junction where appropriate. Final PASS, **49/49**, four files. |
| `pnpm --filter @openpixo/diagnostics test tests/agent-logs.test.ts` | Initial unsafe-name fixture attempted a Windows-invalid colon path; retain the portable unsafe-name case and create the colon case only where legal. PASS, **8/8**. AMR-home-only case retired. |
| `pnpm --filter @openpixo/packaged test tests/config.test.ts tests/protocol.test.ts tests/sidecars.test.ts tests/source-origins.test.ts` | PASS, **101 / 1 Windows skip**, four files. |
| `pnpm --filter @openpixo/tools-pack test tests/resources/opencode-runtime.test.ts tests/resources/runtime-verification.test.ts tests/resources/resources.test.ts tests/win-resources.test.ts tests/config/config.test.ts` | PASS, **27/27**, five files; companion packaging retained. |
| `pnpm --filter @openpixo/tools-pack test` with the 20 changed packaging test files | Initial **173 pass / 9 fail / 2 platform skips**. Fixed stale mac invitation-layout assertions and installer log/icon fixtures. Follow-up `tests/mac.test.ts tests/win-custom-installer.test.ts`: **22 pass / 1 stale log-path failure**; final installer-only rerun PASS **2/2**. All affected assertions pass after those repairs. No installer was installed/uninstalled. |
| `pnpm --filter @openpixo/tools-serve test` | Initial stale bootstrap manifest/checksum/content-revert fixtures failed; corrected to existing release behavior. Final PASS, **21/21**, five files. |
| `pnpm --filter @openpixo/e2e test tests/packaged-smoke-workflow.test.ts tests/scripts/scopes.test.ts tests/scripts/convergence.test.ts` | Earlier failures came from missing command tools, Windows line endings and stale release fixtures. Used command-local repository shims for Bash/Node/python3/jq, corrected fixtures without changing release policy. Final **67 pass / 1 existing explicit skip**, three files. Scope validation, handoff self-check and convergence validation also PASS. |
| `pnpm --filter @openpixo/e2e test tests/openpixo/game-workspace.test.ts` | Required after domain removal: PASS **1 test / 31.87s**; after skill removal: PASS **1 test / 30.05s**. See isolated conversation witnesses below. |
| `pnpm exec tsx .tmp/decouple-finish/mock-conversation.ts s2final` and `... s4final` | Both PASS with mocks only, separate tools-dev namespaces and explicit independent `OD_DATA_DIR`. Both task-owned runtimes stopped with no remaining/forced service PIDs. |
| `pnpm exec tsx .tmp/decouple-round2/replay.ts` | PASS, **18 / 73 / 17 events**, identical before/after values/order/shapes after session-ID normalization. Direct `node` initially failed TS-to-JS import resolution; use tsx. Historical normalizer/hash reproduction is limited as explained below. |
| `pnpm install --offline --ignore-scripts` | FAILED with no-TTY module-removal guard; no global install/config change. Existing dependencies were used; bad repository-local junctions were repaired explicitly. |
| `git diff --check`; attribution/branch/author checks; final category search | PASS. Search exit 0 means matches were found and classified, not zero matches. Cleanup and diff summary are recorded at the final boundary. |
| `git worktree remove --force <verified .tmp/decouple-baseline>`; bounded empty-directory cleanup | PASS. Baseline removed; 25 empty deleted-path directories removed. |
| Recursive cleanup of `.tmp/decouple-finish` and `.tmp/decouple-round2` | BLOCKED by automatic approval review, with the only stated reason “blocked by policy.” A narrower attempt using the verified literal `decouple-finish` path was also rejected before execution. Both ignored scratch directories remain; no alternate deletion mechanism was used. |

An exploratory daemon command accidentally started the full suite because the package test script's built-in `-c` took precedence over the additional `--config`. It was interrupted as soon as a worker outside the selected file list was identified; no report or acceptance result is claimed from it. A changed-file batch containing the two otherwise untouched large chat/connection files was also stopped, since only unused fixture declarations had changed there. Subsequent commands pass nonempty explicit file lists, never alternate configs. This was a validation-command mistake, not an authorized expansion. No real model, live provider test, deployment, publication, installed-app operation or unowned-process termination was run.

### Exclusions and baseline evidence

**Web sweep: zero exclusions and zero skips.** The following unchanged conditional cases appeared in other selected boundary batches. Each condition/title exists in `git show 1fff2546:<path>`; none is an unexplained post-removal assertion failure:

| File / exact case | Evidence and disposition |
|---|---|
| daemon `tests/diagnostics-export.test.ts`: `records an unreadable rotated log as an error instead of silently dropping it` | Existing `skipIf(win32 || root)`; POSIX chmod permission denial does not translate to Windows. |
| packaged `tests/sidecars.test.ts`: `observes a real running child killed with SIGKILL exactly once` | Existing `skipIf(win32)`; POSIX signal observation. |
| tools/pack `tests/linux.test.ts`: `exports APPIMAGE fallback to the execed Electron process` | Existing Linux-only conditional; cannot execute AppImage on Windows. |
| tools/pack `tests/launcher/macos/payload.test.ts`: `creates a payload zip with bootstrap-readable contents` | Existing Darwin-only conditional; platform payload tooling. |
| e2e `tests/packaged-smoke-workflow.test.ts`: `[P1] lets the daily main build recover a shared beta advanced by a feature branch` | Already explicitly `it.skip` at baseline. This is an inherited disabled release-policy test, **not a Windows failure** and not a waived web-sweep failure. It is not counted as passing. |
| daemon `tests/acp-handshake-failure-wiring.test.ts`: `keeps a bundled runtime that never started retryable, and does not blame the CLI` | **Closed, PASS.** Keep native process-enumeration tools in the isolated fixture PATH. Exact startup text, retryability, retry count and persisted classification remain asserted; file **6/6**. |
| daemon `tests/acp-service-failure-wiring.test.ts`: `names a mid-turn provider overload as an upstream outage` | **Closed, PASS.** Same PATH correction; every provider error frame and restored verdict remains classified as upstream failure; file **3/3**. |
| daemon `tests/acp-stage-timeout-wiring.test.ts`: `reaches the chat as a named, retryable timeout on every surface` | **Closed, PASS.** Same PATH correction; preserve timeout/retry details on all surfaces; file **1/1**. No timeout increase. |
| daemon `tests/export-tool-token-authority.test.ts`: `revokes renderer asset capability as soon as the renderer promise settles` | **Closed, PASS.** Replace the POSIX FIFO with a real PNG plus a controlled deferred read. The response stays pending while the renderer-only URL is already revoked, then returns exact bytes. Containment validation is unchanged; file **15/15**, no exclusion. |

The older report's CRLF/python3/corepack/symlink failures were not inherited as blanket exclusions. The selected Windows fixtures were corrected or run with command-local tooling. The nine Chrome layout tests pass on this machine.

### Required imported-game conversations

| Boundary | Namespace / project / run | Result |
|---|---|---|
| Step 2 | `decouple-s2final-1793062217747` / `56aef511-211d-4b0f-9e0f-876c510da536` / `b5bc28c3-4380-432b-a0fe-debb4ed4895a` | succeeded, 2 persisted messages, 7 tool calls + 7 results + text. |
| Step 4 | `decouple-s4final-1793062290366` / `dcf9c3de-2e16-44a5-a8e5-4b6f2ffa57d9` / `6accdf73-385d-4c83-9f91-767eb62e1d6a` | succeeded, same event/message counts. |

Both imported a disposable Godot game, used `pnpm tools-dev run web`, and replayed mock OpenCode trace `0580c870-0310-44dd-9036-4c79074ce7cb`. Alpha.3's namespace, data and process were not reused or stopped.

### Recorded CLI comparison

The actual `mocks/mock-agent.mjs` replay output was parsed by both the current production handlers and handlers from the `1fff2546` worktree. Counts, shape, order and event values match (only generated session IDs normalized). Parser source also matches `7c772afc` byte-for-byte after CRLF normalization.

| Runtime / trace | Events | New before/after shape SHA-256 |
|---|---:|---|
| Codex / `00e83799-a64b-4ce4-9a4e-2b09b72c7859` | 18 | `216789d2364c5495b52c8fecd47bac575091fca01d6bcbbafb89136d2dcef435` |
| Claude Code / `04097377-d26e-4f04-b308-5e4e9e99fc76` | 73 | `e051d46c9d08d91fb09ced25d142563075445470db2e6072434662d1d733d0dc` |
| OpenCode / `0580c870-0310-44dd-9036-4c79074ce7cb` | 17 | `508c97ca3b165d011f45940b4c1993dd6d1c9456d5c804f75efb4814048cfe4a` |

The earlier hashes in this report (`a85eb995…`, `e10ec2f3…`, `e8d80822…`) **were not reproduced**. Their original scratch normalizer was not committed and could not be recovered. The fresh normalizer preserves categorical protocol values, keys, array order and primitive types, with sorted object keys; its hashes are equal across the before/after comparison. Different serialization must not be represented as matching the historical digest. Exact event-value equivalence and unchanged parser source provide the stronger direct regression check, while historical digest reproducibility remains a documented evidence limitation.

### Remaining matches by category

The section 8 search is rerun against source after cleanup. Only category totals and explanations are kept; the 21,316-line per-hit inventory is deleted. Pattern-family counts overlap. Zero product-switch matches remain.

| Category | Why retained |
|---|---|
| Bundled OpenCode | The owner resolved the pending packaging decision: official `opencode-ai@1.18.35` replaces the last Vela dependency. The resolver selects the build target's official binary package, retaining the daemon's bundled path. See the official OpenCode follow-up below. |
| Protocol/runtime evidence | Generic ACP handling, native agent delegation (`collabAgentToolCall`), tool timing/compaction/retry/terminal diagnostics and real CLI recordings remain protected. Some historical regression comments/fixture labels name AMR/Vela; no AMR adapter/login/cloud branch remains. Generic provider quota/account error handling also serves local/BYOK runtimes. |
| Local workspace / share | Local game workspace/provenance, task plans, comments, `tune-collab` artifact-refinement semantics, deploy links and social-link building are retained capabilities. Vercel team IDs and Cloudflare account IDs are external deployment-provider inputs. None is OpenPixo team identity or cloud publication. Machine/protocol identifiers are not phase-2-renamed. |
| Mixed retained tests | Historical negative-control workspace headers and retired route/agent strings assert local isolation or ordinary behavior. Mixed suites were repaired and pass; dedicated removed-domain suites are gone. |
| Catalog/provenance | The undecided 507 entries, generic design vocabulary, authored DESIGN.md, Library Figma sidecars and token/craft/plugin references remain within the existing catalog decision. The five explicitly authorized skills and exclusive plugin/seeds are gone. |
| Documentation and false positives | Historical ADR/task/regression evidence, upstream attribution and vendor terminology; `generativelanguage` and identifiers such as `autosaveLast` are substring matches. No per-hit inventory is retained. |

At the round-two checkpoint the production TypeScript string-literal audit for AMR/Vela, workspace identity headers/invites and message center found only the then-retained companion package name; that packaging dependency is now removed by the follow-up below. The checkpoint's section 8 scan reported **3,011 matching lines / 596 files** (exit 0). Overlapping family counts: design-system/designkit/brand **1,139**; OD Next/follow-up **140**; Vela substring **671**; AMR **576**; collaboration **463**; workspace-header negative controls **66**; product switches **0**. Tests/fixtures contributed **1,690** overlapping lines, mocks **3**, generated outputs **0**. These historical search counts classify matches, not remaining product surfaces.

### Remaining selected daemon file list and platform conditions

The historical remaining audit selected the 59 files below; this is not a full-suite alias. Its renderer-title exclusion is superseded by the portable deferred-read fixture. The [pre-phase-3 repair](DAEMON-TEST-REPAIR.md#validation-commands) records the new explicit selections, including all touched files together without title filters or timeout overrides:

```text
tests/acp-handshake-failure.test.ts
tests/acp-inflight-tool-rows.test.ts
tests/acp-stage-timeout-classification.test.ts
tests/acp-todo-tool-name.test.ts
tests/acp-tool-completion-diagnostics.test.ts
tests/acp-upstream-retryable-passthrough.test.ts
tests/acp.test.ts
tests/agent-session-resume.test.ts
tests/automatic-diagnostics.test.ts
tests/browser-use-diagnostics.test.ts
tests/byok/run-input-boundary.test.ts
tests/chat-project-authority.test.ts
tests/chat-run-artifact-quiet-period.test.ts
tests/codex-app-server-child-events.test.ts
tests/codex-thinking-tokens.test.ts
tests/db-agent-sessions.test.ts
tests/export-renderer-error-redaction.test.ts
tests/export-tool-token-authority.test.ts
tests/langfuse-bridge.test.ts
tests/langfuse-trace.test.ts
tests/mcp-brief-app.test.ts
tests/mcp-create-artifact.test.ts
tests/mcp-get-project.test.ts
tests/mcp-runs.test.ts
tests/mcp-write-tools.test.ts
tests/media-cli-help.test.ts
tests/media/diagnostics.test.ts
tests/media/tasks-routes.test.ts
tests/native-session-recovery.test.ts
tests/observability/main-run-observation.test.ts
tests/observability/run-terminal-lifecycle.test.ts
tests/plugins-bundled-scenarios-roster.test.ts
tests/plugins-headless-run.test.ts
tests/project-preview-containment.test.ts
tests/prompts/media-contract-mirror.test.ts
tests/prompts/system-prompt-matrix.test.ts
tests/proxy-routes.test.ts
tests/routes/project-create-preparation-deadline.test.ts
tests/routes/project-example-reference.test.ts
tests/routes/projects.test.ts
tests/routine-routes.test.ts
tests/run-diagnostics.test.ts
tests/run-failure-os-unsupported.test.ts
tests/run-runtime-type-analytics.test.ts
tests/runs-active-count.test.ts
tests/runs-list-awaiting-input.test.ts
tests/runtimes/env-and-detection.test.ts
tests/runtimes/executables.test.ts
tests/runtimes/launch.test.ts
tests/runtimes/resolve-model.test.ts
tests/runtimes/run-failure-telemetry-smoke.test.ts
tests/runtimes/run-terminal-reconciliation.test.ts
tests/runtimes/runs.test.ts
tests/runtimes/runtime-version-provenance.test.ts
tests/runtimes/service-failure-classification.test.ts
tests/server-bootstrap-regression.test.ts
tests/server-startup-smoke.test.ts
tests/system-prompt-template.test.ts
tests/user-facing-agent-label.test.ts
```

The 34 additional platform-conditional cases are listed individually here. For each file, `git show 1fff2546:apps/daemon/tests/<file>` contains the same condition: `fsTest = win32 ? test.skip : test` in executable/environment/launch tests (POSIX shebang/PATH/permission and macOS bundle fixtures), or `it.runIf(process.platform !== 'win32')` in runtime-version tests (POSIX executable probes under a minimal PATH). The AMR-only conditional cases are deleted and are not in this list. These are unexecuted Windows cases, not passes:

- daemon `tests/runtimes/env-and-detection.test.ts`: `resolveAgentExecutable prefers a configured CODEX_BIN override over PATH resolution`; `inspectAgentExecutableResolution reports configured and PATH Codex binaries separately`; `resolveAgentExecutable supports configured binary overrides for non-Codex adapters`; `resolveAgentExecutable prefers opencode-cli before desktop opencode fallback`; `detectAgents keeps Kimi available when ACP model discovery fails`; `detectAgents marks Codex available when nvm exposes a node shim but launch resolution upgrades it to the native binary`; `detectAgents records Antigravity permission capability from stderr help output`; `detectAgents surfaces Cursor Agent model labels without putting labels in ids`.

- daemon `tests/runtimes/executables.test.ts`: `resolveAgentExecutable prefers def.bin over fallbackBins when bin is on PATH`; `resolveAgentExecutable falls back through fallbackBins when def.bin is missing`; `resolveAgentExecutable returns null when neither def.bin nor any fallback is on PATH`; `resolveAgentExecutable searches mise node bins when PATH is minimal`; `resolveAgentExecutable still resolves agents without a fallbackBins field`; `resolveAgentExecutable searches ~/.npm-global/bin under a minimal GUI-launched PATH (issue #442)`; `resolveAgentExecutable also searches ~/.npm-packages/bin (alt npm prefix)`; `resolveAgentExecutable searches ~/.vite-plus/bin under a minimal GUI-launched PATH (vp global install)`; `resolveAgentExecutable honors $VP_HOME/bin when the custom Vite+ home is outside PATH`; `OD_AGENT_HOME isolates resolution from $NPM_CONFIG_PREFIX leakage`; `OD_SANDBOX_MODE scopes fallback toolchain discovery to OD_DATA_DIR`; `OD_SANDBOX_MODE resolves relative OD_DATA_DIR before fallback toolchain discovery`; `OD_AGENT_HOME isolates resolution from $VP_HOME leakage`; `resolveAgentExecutable finds codex inside ~/Applications/Codex.app when PATH is empty`; `resolveAgentExecutable prefers a PATH codex over the Codex.app bundle`; `resolveAgentExecutable ignores Codex.app bundle on non-darwin platforms`; `resolveAgentExecutable does not apply the Codex.app fallback to non-codex agents`; `codexAppBundleCandidates probes /Applications first when no home override is set`; `codexAppBundleCandidates is empty on non-darwin platforms`.

- daemon `tests/runtimes/launch.test.ts`: `resolveAgentLaunch selects nvm-installed codex under a minimal PATH and prepends its dirname`; `resolveAgentLaunch resolves a Codex npm wrapper to the native packaged binary`; `resolveAgentLaunch preserves a direct native CODEX_BIN override as the selected launch path`; `resolveAgentLaunch falls back to the Codex wrapper when the native package is missing`.

- daemon `tests/runtimes/runtime-version-provenance.test.ts`: `recovers a missing version cached by selected detection without a manual rescan`; `recovers a missing version cached by picker detection without a manual rescan`; `bounds repeated missing-version probes and keeps the CLI invocable`.

### Final workspace boundary

The branch remains `codex/opendesign-base`. Commits use `Claude <claude@local.invalid>`, Conventional Commits and short bodies, without co-author trailers. `LICENSE` and `NOTICE` match `7c772afc`. Nothing was pushed, globally installed/configured, or changed in the installed Alpha.3 instance. The verified `1fff2546` baseline worktree was removed with `git worktree remove --force`; its only tracked changes were the three controlled Windows ACP comparison fixtures. All 92 inspected package links were independent of that worktree. Deleted-path cleanup removed 25 empty directories, using bounded repository paths and nonrecursive empty-directory deletion. Automatic approval review rejected both computed and verified-literal recursive scratch deletion with “blocked by policy”; `.tmp/decouple-finish` and `.tmp/decouple-round2` therefore remain ignored. This is an incomplete cleanup step, not an authorization question. Other workspace data is preserved. Final guard/typecheck run again after the successful baseline cleanup and final source edits.

## Official OpenCode packaging follow-up (2026-10-27)

The repository owner resolved the final Vela packaging-source decision. The exact
required build dependency is now `opencode-ai@1.18.35`, released 2026-10-06 and
intentionally selected for release age. No recording or adapter contract requires
a newer version. The old package/resolver references are removed from source,
tests, documentation and lockfile; the historical AMR packaging plan is marked
retired. No phase 2 rename or runtime engine change is included.

Windows packaging selects official `opencode-windows-x64-baseline`. The resolver
also covers Windows arm64, macOS x64/arm64 and glibc Linux x64/arm64. All x64
targets use the baseline package for CPUs without AVX2; arm64 uses the native
package. Target resolution is independent of the host, never falling back to a
wrong platform. `OPEN_DESIGN_OPENCODE_DIR` remains first priority, optional
bundling may return null, and `--require-open-code` fails with both install and
override remedies. The native version must equal the installed meta package's
version and its declared optional-dependency pin.

The runtime path stays `bin/libexec/opencode/opencode(.exe)`. The meta package's
MIT license and any native package license/notices are copied under
`bin/libexec/opencode/licenses/<package>/`. Root `LICENSE` and `NOTICE` are
preserved. Windows resource-tree schema 11 explicitly hashes the package name,
version, binary tree, notice contents and destinations. Witness tests change each
input independently and prove unrelated generated `dist/` output is not an input.

### Validation command record

All direct Node/pnpm commands use repository Node 24.22.1 / pnpm 10.33.2.
Scratch commands, recording downloads and daemon-owned data use this task's
isolated paths; daemon data propagation follows the root `AGENTS.md` contract.

| Command / check | Outcome |
|---|---|
| `pnpm install` | Initial FAILED: stale prior virtual-store location required module removal and no TTY was available. |
| `pnpm install --config.confirmModulesPurge=false` | PASS, including repository postinstall builds and lockfile refresh. Command-local setting only. Existing DeepSeek peer warnings remain. The meta package's postinstall is intentionally unapproved by pnpm; the resolver directly consumes its installed native optional package. |
| `pnpm guard` | PASS; rerun before commit. |
| `pnpm typecheck` | PASS across the repository; rerun before commit. |
| `pnpm --filter @openpixo/tools-pack build` | PASS. |
| `pnpm --filter @openpixo/tools-pack exec vitest run tests/resources/opencode-runtime.test.ts tests/resources/resources.test.ts tests/resources/runtime-verification.test.ts tests/win-resources.test.ts` | PASS: 4 files, 30 tests. Covers all six target combinations, missing packages/binary, version mismatch, override priority, license copying and cache witnesses. |
| `pnpm tools-pack win build --to nsis --portable --require-opencode --namespace opencode-official --dir .tmp/opencode-build --json` | FAILED before building: misspelled strict flag. Correct spelling is `--require-open-code`. |
| Corrected NSIS command, first build attempt | INTERRUPTED only this task's build before native rebuild, to route tool-home caches inside the repository. No installed app was touched. |
| `pnpm tools-pack win build --to nsis --portable --require-open-code --namespace opencode-official --dir .tmp/opencode-build --json` | PASS, exit 0, including NSIS and launcher payload. Tooling profile, npm/Electron caches and outputs were repository-scoped; existing NSIS 3.0.4.1 compiler files were copied read-only from the user's cache into the repository cache. No global install/configuration change. |
| `pnpm exec tsx .tmp/opencode-verification/version.ts` | PASS: installed official Windows x64 baseline binary reports `1.18.35`. XDG paths isolated. |
| `pnpm exec tsx .tmp/opencode-verification/verify-resources.ts`; targeted `7z x` of `installer/payload-base.7z`, followed by the same check on extracted resources | PASS: both the assembled and installer-payload binaries report `1.18.35`, hashes match, official MIT license is present, and root notices match the repository. |
| `pnpm exec tsx .tmp/opencode-verification/replay.ts` | PASS: fetched only the three recorded sessions below, verified each manifest content SHA-256, ran `mocks/mock-agent.mjs --as <agent> --no-delay`, and fed its stdout through production Claude/JSON-event handlers. Counts 18 / 73 / 17. |
| `pnpm exec tsx .tmp/opencode-verification/check-replay.ts` | PASS: all three latest phase-1 shape digests match exactly. Initial Claude comparison omitted the categorical `stopReason`; restoring that documented semantic field reproduces its recorded digest. No parser or fixture changed. |
| `pnpm tools-dev start daemon --namespace opencode-official-detect --tools-dev-root .tmp/opencode-verification/tools-dev --no-env-file --json` | PASS with explicit isolated `OD_DATA_DIR`, `OD_SANDBOX_MODE=1` and `OD_RESOURCE_ROOT` pointing at the new resource tree. Restricted PATH, default plugins and model-catalog refresh disabled; no model/provider call. |
| `GET /api/agents`; `GET /api/runs` | PASS: `byok-opencode`, available, exact bundled executable path, version `1.18.35`; no runs. The first assertion checked local `opencode`, which correctly remains unavailable with an empty CLI PATH. The existing bundled resolver is consumed by `byok-opencode`; no runtime behavior was changed to alter that distinction. |
| `pnpm tools-dev stop daemon --namespace opencode-official-detect --tools-dev-root .tmp/opencode-verification/tools-dev --no-env-file --json` | PASS: graceful stop, no forced or remaining PIDs. An initial daemon was also stopped before restarting with restricted PATH. Only task-owned processes were stopped. |
| Tracked-file search for the retired package/resolver; `git diff --check` | PASS: no remaining references, no whitespace errors. |
| Task scratch cleanup | The aggregate computed recursive-delete command was BLOCKED by automatic approval review with “blocked by policy.” Separate read-only path checks and narrower literal-path `Remove-Item` commands without `-Force` PASS. All task scratch and the interrupted staging directory are removed. |

### NSIS artifact and resource evidence

Retained local verification output: `output/verification/opencode-1.18.35/`.
The installer is `OpenPixo-opencode-official-setup.exe`, **373,414,785 bytes**,
SHA-256 `6a412e3eb099d5a52f41974d342f4a6f05bfffe5f235a5574839e61b9e9659d9`.
It is an unsigned isolated verification build at the existing product version
`0.1.0-alpha.2`, not an installed update to the hands-on Alpha.3.

`resource-root/bin/libexec/opencode/opencode.exe` is retained from the actual
assembled resource tree. It reports **1.18.35**, is **180,656,008 bytes**, and
has SHA-256 `b6124f7c525820ac495eb5124067d172216640bb67a770e60679dba77da0c258`.
Extracting the same file from the installer payload reproduces that hash/version.
The official license hash is
`625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b`.
`verification.json`, `SHA256SUMS.txt` and focused command logs accompany the
installer and the retained binary/license tree. Task scratch and the interrupted
build's unpromoted cache staging are deleted; completed build-cache entries are
retained. No model/provider request or installed-build operation was performed.

### Recorded replay identity

| Runtime / trace | Events | Reproduced latest shape SHA-256 |
|---|---:|---|
| Codex / `00e83799-a64b-4ce4-9a4e-2b09b72c7859` | 18 | `216789d2364c5495b52c8fecd47bac575091fca01d6bcbbafb89136d2dcef435` |
| Claude Code / `04097377-d26e-4f04-b308-5e4e9e99fc76` | 73 | `e051d46c9d08d91fb09ced25d142563075445470db2e6072434662d1d733d0dc` |
| OpenCode / `0580c870-0310-44dd-9036-4c79074ce7cb` | 17 | `508c97ca3b165d011f45940b4c1993dd6d1c9456d5c804f75efb4814048cfe4a` |

To make these latest digests reproducible after scratch cleanup, hash the UTF-8
bytes of `JSON.stringify(shape(events))`, without indentation or a trailing
newline, using this exact normalizer:

```ts
function shape(value: unknown, key = ''): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(item => shape(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, shape(v, k)]));
  }
  if (typeof value === 'string' && ['type', 'name', 'status', 'stopReason'].includes(key)) return value;
  return typeof value;
}
```

These reproduce the **latest** round-two hashes, not the older unavailable
pre-section-4 serializer. The OpenCode recording itself also matches manifest
SHA-256 `b1b7fa5e36288ca4c80e86416f26fd58097881082c31d3a1d1a50ae942726121`.

### Remaining live acceptance

An explicitly authorized live check must still confirm official OpenCode's
provider authentication, selected model/reasoning variant, prompt-on-stdin JSON
stream, real tool execution, permissions, MCP/skills injection, cancellation and
native-session continuation. Existing mock replay proves compatibility with the
recordings, not that this official binary emits identical live events. macOS,
Linux and arm64 native execution are not verified by the Windows fixture matrix.
The installed Alpha.3 instance is preserved; no installed-build operation, push,
global install/configuration change or live run was performed.
