# Phase 2: CLI binary pixo — 2026-10-27

> Historical naming checkpoint. Library module, command and test references below describe that commit; [slim-core Batch 9](SLIM-CORE.md#batch-9--game-copy) later removes the global registry.

The source rename is implemented on codex/opendesign-base. Guard, repository typecheck, daemon build, executable resolution, translation preservation and the required isolated game-workspace smoke pass. The original checkpoint's daemon/prompt failures are now repaired: the owner-requested rerun at `52c56f7e` verified 30 failures across the wider known selection, and all 13 touched files now pass independently and together (**111/111, no skips**). See [the exact failure/disposition and command report](DAEMON-TEST-REPAIR.md). The separately reported Windows website-clone E2E failure is outside this daemon repair and was not rerun. No full daemon/web suite or live model/provider test ran.

Starting source: 5462c863d566ffccd1231c58c54d85b103d5b91b. No branch, PR or push was created. All task writes stayed in the repository, normal tooling OS temp, or the pnpm store. The installed Alpha.3 instance was not stopped, reused, uninstalled or modified. Scratch cleanup remains blocked: automatic approval review rejected both the bundled cleanup and the subsequent exact-path PowerShell removal with "blocked by policy". The ignored .tmp/phase2-cli directory remains; no more specific rejection reason was supplied.

## Commits and decision

- 3db784ba — refactor(cli)!: rename od binary to pixo
- 25c2316 — refactor(prompts)!: use pixo in prompts and agent content
- Documentation, ADR 0008 and this report are in the following local docs commit.

Each commit uses Claude <claude@local.invalid>, has no co-author trailer, and leaves guard and typecheck green. [ADR 0008](../adr/0008-cli-binary-pixo.md) records the executable decision; ADR 0006 has an appended partial-supersession note. No compatibility executable is provided.

## Constant consumers

PRODUCT_CLI_NAME is declared once in packages/contracts/src/product.ts and exported by the existing contracts barrel. It appears in 131 tracked TypeScript files: one declaration and 130 consuming files.

- Daemon: CLI help/usage and hints, fallback MCP install specifications in cli.ts, runtime MCP defaults in runtimes/mcp.ts, API error instructions, media/asset/recipe/extension commands and generated plugin README text.
- Prompts: daemon directions/media/system text, the contracts directions/system mirror and the shared openpixo-game composer. Existing mirror tests pass; the matrix snapshot changes only character counts caused by the longer command name.
- Web: the Use everywhere guide and copied instructions, plugin authoring/sharing/install text, Settings/terminal messages and all 19 locale dictionaries. All 94,208 locale strings match their original wording when the constant is substituted back.
- Other boundaries: the shared capability matrix, release-site copy, the root seed helper, CLI-bin references in E2E fixtures and packaging tests, and focused test expectations. Package-bin JSON and the bootstrap shim path remain explicit file/manifest values.

<details><summary>Complete TypeScript consumer inventory</summary>

```text
apps/daemon/src/artifacts-cli.ts
apps/daemon/src/assets/asset-cli.ts
apps/daemon/src/assets/ops/asset-ops-cli.ts
apps/daemon/src/cli.ts
apps/daemon/src/daemon-startup.ts
apps/daemon/src/diagnostics-client-evidence.ts
apps/daemon/src/diagnostics-export.ts
apps/daemon/src/game/templates-cli.ts
apps/daemon/src/game/verify-cli.ts
apps/daemon/src/handoff-cli.ts
apps/daemon/src/mcp.ts
apps/daemon/src/mcp/templates-cli.ts
apps/daemon/src/plugins/export.ts
apps/daemon/src/plugins/publish.ts
apps/daemon/src/plugins/resolve-snapshot.ts
apps/daemon/src/plugins/scaffold.ts
apps/daemon/src/prompts/directions.ts
apps/daemon/src/prompts/media-contract.ts
apps/daemon/src/prompts/system.ts
apps/daemon/src/recipes/character-cli.ts
apps/daemon/src/recipes/recipe-cli.ts
apps/daemon/src/routes/game-verify.ts
apps/daemon/src/runtimes/capabilities-cli.ts
apps/daemon/src/runtimes/mcp.ts
apps/daemon/src/server.ts
apps/daemon/src/services/plugin-share-tasks.ts
apps/daemon/src/services/project-extensions-cli.ts
apps/daemon/src/store/cli.ts
apps/daemon/src/tools-connectors-cli.ts
apps/daemon/src/tools-deliverable-syntax-cli.ts
apps/daemon/src/tools-live-artifacts-cli.ts
apps/daemon/tests/acp-stdio-mcp.test.ts
apps/daemon/tests/acp.test.ts
apps/daemon/tests/artifacts-cli.test.ts
apps/daemon/tests/cli-deploy.test.ts
apps/daemon/tests/cli-files-write.test.ts
apps/daemon/tests/cli-lint.test.ts
apps/daemon/tests/cli-phase2c.test.ts
apps/daemon/tests/cli-run-steer.test.ts
apps/daemon/tests/cli-skills-install.test.ts
apps/daemon/tests/cli-startup.test.ts
apps/daemon/tests/cli-templates.test.ts
apps/daemon/tests/comment-cli-http-sqlite.test.ts
apps/daemon/tests/comment-cli.test.ts
apps/daemon/tests/daemon-startup.test.ts
apps/daemon/tests/db-message-events.test.ts
apps/daemon/tests/directions-cli.test.ts
apps/daemon/tests/export-html-cli.test.ts
apps/daemon/tests/export-tool-token-authority.test.ts
apps/daemon/tests/export-tool-token-nonloopback-authority.test.ts
apps/daemon/tests/game/verify.test.ts
apps/daemon/tests/handoff-cli.test.ts
apps/daemon/tests/mcp-install-cli.test.ts
apps/daemon/tests/media-cli-help.test.ts
apps/daemon/tests/media-generate-multi-image.test.ts
apps/daemon/tests/media-generate-prompt-file.test.ts
apps/daemon/tests/media-generate-structured-error.test.ts
apps/daemon/tests/media-scaffold-cli.test.ts
apps/daemon/tests/media-wait-safety-output.test.ts
apps/daemon/tests/media-wait-stdout-flush.test.ts
apps/daemon/tests/plugin-workspace-cli.test.ts
apps/daemon/tests/plugins-upgrade.test.ts
apps/daemon/tests/project-cli.test.ts
apps/daemon/tests/prompts/core-slim.test.ts
apps/daemon/tests/run-cli.test.ts
apps/daemon/tests/runtimes/claude-approval-args.test.ts
apps/daemon/tests/runtimes/json-event-stream.test.ts
apps/daemon/tests/server-paths.test.ts
apps/daemon/tests/store/cli.test.ts
apps/web/src/components/LibrarySection.tsx
apps/web/src/components/MarketplaceView.tsx
apps/web/src/components/PluginLoopHome.tsx
apps/web/src/components/PluginsView.tsx
apps/web/src/components/ProjectView.tsx
apps/web/src/components/design-files/pluginFolderActions.ts
apps/web/src/components/home-hero/plugin-authoring.ts
apps/web/src/components/plugin-details/PluginShareMenu.tsx
apps/web/src/components/share-to-community/shareToCommunityPrompt.ts
apps/web/src/components/use-everywhere/agent-guide.ts
apps/web/src/components/use-everywhere/sections.ts
apps/web/src/i18n/locales/ar.ts
apps/web/src/i18n/locales/de.ts
apps/web/src/i18n/locales/en.ts
apps/web/src/i18n/locales/es-ES.ts
apps/web/src/i18n/locales/fa.ts
apps/web/src/i18n/locales/fr.ts
apps/web/src/i18n/locales/hu.ts
apps/web/src/i18n/locales/id.ts
apps/web/src/i18n/locales/it.ts
apps/web/src/i18n/locales/ja.ts
apps/web/src/i18n/locales/ko.ts
apps/web/src/i18n/locales/pl.ts
apps/web/src/i18n/locales/pt-BR.ts
apps/web/src/i18n/locales/ru.ts
apps/web/src/i18n/locales/th.ts
apps/web/src/i18n/locales/tr.ts
apps/web/src/i18n/locales/uk.ts
apps/web/src/i18n/locales/zh-CN.ts
apps/web/src/i18n/locales/zh-TW.ts
apps/web/tests/components/ChatPane.media-task-polling.test.tsx
apps/web/tests/components/PluginDetailView.curated-layout.test.tsx
apps/web/tests/components/PluginShareMenu.test.tsx
apps/web/tests/components/PluginsView.test.tsx
apps/web/tests/components/ToolCard.disclosure.test.tsx
apps/web/tests/components/chat/image-fail-cell-two-states.test.tsx
apps/web/tests/components/chat/image-retry.test.tsx
apps/web/tests/components/chat/image-strip-preview-actions.test.tsx
apps/web/tests/components/chat/mirror-gallery.test.tsx
apps/web/tests/components/chat/pixel-liquid-loading.test.tsx
apps/web/tests/components/home-hero/plugin-authoring-prompt.test.ts
apps/web/tests/components/pluginFolderActions.test.ts
apps/web/tests/components/use-everywhere-agent-guide.test.ts
apps/web/tests/runtime/chat/build-turn-blocks.test.ts
apps/web/tests/runtime/chat/live-row-elapsed.test.ts
apps/web/tests/runtime/chat/media-batch-row.test.ts
apps/web/tests/runtime/chat/media-surface-dispatch.test.ts
e2e/lib/fake-agents.ts
e2e/specs/web-clone/main.spec.ts
e2e/tests/artifact-lint-cli.test.ts
e2e/tests/hyperframes-runtime-render.test.ts
e2e/tests/openpixo/local-cli-project-mutation.test.ts
e2e/tests/openpixo/project-access.test.ts
packages/contracts/src/product.ts
packages/contracts/src/prompts/directions.ts
packages/contracts/src/prompts/openpixo-game.ts
packages/contracts/src/runtime/capability-matrix.ts
packages/contracts/tests/openpixo-game-prompt.test.ts
packages/contracts/tests/system-prompt.test.ts
scripts/seed-test-projects.ts
tools/pack/tests/mac-lifecycle.test.ts
tools/release/src/site/pages.ts
```

</details>

## Replacement counts

Counts are the net occurrences of the standalone legacy-name token removed from existing files relative to the starting source. Repeated command examples count individually; executable paths and removed migration instructions count too. Newly written ADR/report text is excluded. Comment-only and dependency-only files can contribute zero references.

| Area | Existing changed files | References replaced/removed |
|---|---:|---:|
| Docs and contribution content | 135 | 1993 |
| Bin, manifests, lockfile and root scripts | 8 | 10 |
| Daemon source | 71 | 663 |
| Prompt source | 6 | 16 |
| Daemon tests and fixtures | 62 | 122 |
| Web source | 23 | 95 |
| Web locales (19) | 19 | 285 |
| Web tests and fixtures | 23 | 106 |
| Skills and design templates | 6 | 43 |
| E2E | 6 | 18 |
| Other shared contracts/packages | 18 | 32 |
| Plugins | 73 | 138 |
| Tools source/tests | 7 | 6 |
| **Total** | **457** | **3527** |

The original section-3 scan yielded 2,462 candidate lines. Every candidate was classified before scoped edits. Broader checks also covered omitted subcommands, PATH checks, executable filenames, arbitrary-argument test labels, regex expectations and HTML code labels. No global substitution was used.

## Remaining section-3 search output

The original section-3 patterns, excluding node_modules/dist/.git/.tmp/.cache, return **30 matching lines across 11 files**. Every remaining line is accounted for below. There is no remaining active instruction to invoke the former OpenPixo executable.

| File and matching lines | Lines | Reason retained |
|---|---:|---|
| apps/daemon/src/mcp-routes.ts:27 | 1 | Historical explanation of the OS octal-dump utility; absolute MCP paths remain valid. |
| apps/daemon/src/plugins/export.ts:10 | 1 | Canonical plugin export format key, deliberately retained. |
| docs/adr/0006-full-hard-fork.md:45 | 1 | Historical body is preserved; an appended note supersedes only the executable name. |
| docs/adr/0008-cli-binary-pixo.md:8, 12, 17, 37 | 4 | Old-name history and the explicit retained manifest-field list in the new decision. |
| docs/deployment/docker.md:103 | 1 | GHCR package identifier and its registry settings, not a shell executable. |
| docs/roadmap.md:77, 99, 141, 144, 145, 189, 199, 205, 229 | 9 | Explicitly archived upstream document, unchanged. |
| docs/spec.md:85, 106, 145 | 3 | Explicitly archived upstream document, unchanged. |
| scripts/migrate-to-plugins/lib.ts:215 | 1 | Canonical manifest JSON property ordering, not a command. |
| specs/current/cli-rename-pixo.md:30, 34, 39 | 3 | Only the no-change list: internal identifiers, manifest format and historical OS utility. |
| docs/coordination/archive/decouple-skipped-domains.md:100 | 1 | Phase-1 exclusion of internal identifier renaming, not a CLI invocation. |
| specs/current/remove-opendesign-traces.md:7, 8, 45, 104, 107 | 5 | Later-phase internal prefix, manifest-field and persisted-key migration plan. |

Broader searches additionally retain manifest variables and export targets, OD environment names (including OD_BIN/OD_NODE_BIN), internal package names, .od paths, headers, CSS/bridge names, OS protocol and message prefixes. Generic fixture path values do not create or expose an executable. Negative MCP-copy assertions intentionally reject the former command value. Polish uses of the ordinary word remain translations; the Helm release name is a deployment identifier. The runtime log identity prefix stays for the later identifier phase. LICENSE, NOTICE, both archived docs and ADR 0006's historical body are preserved. A protected-token/JSON-key audit passed across 254 changed TS/JSON files.

## Command results

All pnpm commands used the pinned local Node 24.22.1 / pnpm 10.33.2 toolchain. Test paths below are package-relative. D means pnpm --filter @openpixo/daemon exec vitest run -c vitest.config.ts; W means pnpm --filter @openpixo/web exec vitest run -c vitest.config.ts. Lists A, B and C are expanded below.

| Command/invocation | Result |
|---|---|
| pnpm install (after bin rename) | PASS |
| pnpm install (release-site contracts dependency) | PASS; existing DeepSeek peer-version warnings |
| pnpm install (packaging test contracts dependency) | PASS; same peer warnings |
| pnpm install --offline (after stale repository bin-link cleanup) | PASS |
| pnpm guard (initial, resumed, code, content and final docs checkpoints) | PASS at every invocation |
| pnpm typecheck (first two attempts) | FAIL: packaging test lacked its new contracts dependency; added it and reinstalled |
| pnpm typecheck (corrected, code, content and final docs checkpoints) | PASS |
| pnpm --filter @openpixo/daemon build | PASS |
| node apps/daemon/bin/pixo.mjs --help | PASS; command names use pixo, no legacy-name word in top-level help |
| pnpm exec pixo --help (normal and isolated pinned PATH) | PASS |
| pnpm exec od (before stale link cleanup) | Nonzero; pnpm retained three generated repository shims pointing at the deleted entry. Only those verified repository files were removed |
| pnpm exec od (normal host PATH after cleanup) | Resolves Git's unrelated OS utility at C:\Program Files\Git\usr\bin\od.exe; does not resolve an OpenPixo alias |
| pnpm exec od (pinned toolchain + Windows PATH after reinstall) | PASS negative check: exit 1, Command not found; workspace bin has only the new name |
| D tests/runtimes/mcp.test.ts tests/mcp-install-cli.test.ts | PASS: 10 tests |
| D tests/media-cli-help.test.ts tests/mcp-install-info.test.ts tests/diagnostics-export.test.ts | PASS: 36 passed, 1 skipped |
| D tests/cli-startup.test.ts tests/runtimes/claude-approval-args.test.ts tests/acp.test.ts tests/acp-stdio-mcp.test.ts tests/prompts/system-prompt-matrix.test.ts --update | PASS: 123 tests, one expected character-count snapshot updated |
| D list A (43 files) | Starting rerun at `52c56f7e`: 459 passed, the same 3 failed, 1 existing skip. All three failures now pass after portable export-path/fake-Claude fixture repairs; [evidence](DAEMON-TEST-REPAIR.md). |
| D list B (16 files) | Starting rerun at `52c56f7e`: 138 passed, the same 5 failed. Native path fixtures and deferred image reads fix four; restoring retained craft routes fixes the real product bug. All five now pass; no exclusion. |
| D tests/cli-templates.test.ts tests/static-resource-routes.test.ts tests/server-bootstrap-regression.test.ts | Historical exploratory FAIL: a temporary missing import plus five deleted-design-system-route expectations; the phase-2 fixture edit was withdrawn. The later daemon repair retires those five cases and preserves both passing live skill-origin guards. |
| D tests/cli-templates.test.ts tests/server-bootstrap-regression.test.ts (corrected) | PASS: 25 tests |
| D tests/prompts (initial) | FAIL: 243 passed, 14 failed; includes the renamed-command snapshot difference |
| D tests/prompts (final phase-2 checkpoint) | Historical 244 pass / 13 fail in 20 files. Rechecked at `52c56f7e`; the three failing files are repaired and pass **39/39** independently and in the final combined selection. No prompt text/snapshot changed. |
| D baseline config: discovery-localization-drift, host-failure-narration, stable-sections and system-prompt-matrix | Historical 13-failure reproduction is closed. Retire four deleted-example cases; preserve current localization, narration and two changed stable sections. Matrix passed unchanged at the new baseline. |
| D baseline config: plugins-export and resume-continue-prompt-context | Closed: portable fixtures, **7/7** pass. |
| D baseline config: export-tool-token-authority and server-paths | Closed: deferred read and native absolute fixtures, **29/29** pass. |
| D baseline config: craft-route | Closed: retained craft routes restored, strengthened red spec goes green, **4/4** pass. |
| D baseline config: static-resource-routes (unchanged exploratory target) | Closed: retire five deleted-design-system cases; both live skill origin guards pass, **2/2**. |
| W tests/i18n/locales.test.ts tests/components/use-everywhere-agent-guide.test.ts tests/components/home-hero/plugin-authoring-prompt.test.ts tests/components/pluginFolderActions.test.ts tests/components/PluginShareMenu.test.tsx tests/components/PluginsView.test.tsx | PASS: 80 tests |
| W list C (20 files) | PASS: 253 tests |
| W tests/observability/iframe-error.test.ts tests/runtime/export-injection-points.test.ts tests/components/chat/w98-tool-failure-reason.test.tsx tests/components/use-everywhere-copy-guide.test.tsx | PASS: 27 tests |
| pnpm --filter @openpixo/contracts exec vitest run tests/openpixo-game-prompt.test.ts tests/system-prompt.test.ts tests/capability-matrix.test.ts | PASS: 33 tests in 2 files; the third path matched no file |
| pnpm --filter @openpixo/contracts exec vitest run tests/runtime/capability-matrix.test.ts | PASS: 1 test (correct path) |
| pnpm --filter @openpixo/contracts exec vitest run tests/system-prompt-metadata-block.test.ts tests/system-prompt-api-mode.test.ts tests/official-system-prompt.test.ts | PASS: 31 tests |
| pnpm --filter @openpixo/sidecar-proto exec vitest run tests/artifact-capture-mode.test.ts | PASS: 6 tests |
| pnpm --filter @openpixo/desktop exec vitest run tests/main/artifact-export-image-height.test.ts | PASS: 1 test |
| pnpm --filter @openpixo/tools-pack exec vitest run tests/mac-lifecycle.test.ts tests/resources/resources.test.ts | PASS on Windows: 10 tests |
| pnpm --filter @openpixo/tools-pack exec vitest run tests/web-sourcemaps.test.ts | PASS: 4 tests; upload skipped because credentials are absent |
| pnpm --filter @openpixo/release exec vitest run tests/site.test.ts | Initial invocation FAIL: wrong package filter, no test files; corrected below |
| pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts | PASS: 16 tests |
| E2E selected five tests plus specs/web-clone/main.spec.ts | FAIL: 7 passed, 1 baseline Windows fake-browser failure |
| E2E baseline config: specs/web-clone/main.spec.ts -t 'brokers a browser lifecycle' | Reproduced the fake-browser ENOENT; unrelated second case unselected |
| E2E final five-file selection (below) | PASS: 6 tests; includes required game-workspace smoke |
| Locale AST audit | PASS: 19 locale files, 94,208 strings preserved except command substitution |
| Protected identifiers / JSON keys audit | PASS: 254 changed TS/JSON files |
| Archive/license/bin-map audit | PASS; initial scratch comparison corrected to account for Git LF vs Windows CRLF |
| Original section-3 rg recheck and broader command-reference scans | PASS with only explained exceptions above |
| git diff --check / staged diff checks | Final PASS; removed two inherited Markdown trailing-space endings on renamed lines |
| Scratch cleanup: validated bundled command, then Remove-Item with the verified absolute phase-2 directory path | BLOCKED before execution by automatic approval review; .tmp/phase2-cli remains |

The baseline comparisons for daemon/prompt failures used the starting source without discarding the task edits; later comparisons used a temporary Vite transform. The unchanged static-route probe was also checked separately. Temporary configs and audit scripts live only under the ignored phase-2 scratch prefix; their deletion is blocked as recorded above. One initial baseline runner invocation used a wrong Vitest path and failed before tests started; the corrected invocation produced the results above. An initial broader rg expression omitted PCRE2 and failed to parse; the corrected --pcre2 search completed.

E2E used the existing suite.with.toolsDev lifecycle and isolated dynamic namespaces, with a temporary config redirecting suite scratch under the permitted phase-2 prefix. Exact final invocation:

```powershell
pnpm --filter @openpixo/e2e exec vitest run -c ../.tmp/phase2-cli/e2e.config.ts tests/openpixo/game-workspace.test.ts tests/openpixo/local-cli-project-mutation.test.ts tests/openpixo/project-access.test.ts tests/artifact-lint-cli.test.ts tests/hyperframes-runtime-render.test.ts
```

## Daemon baseline repair and remaining E2E limit

| Test file | Verified starting failures | Resolution |
|---|---:|---|
| daemon/tests/prompts/discovery-localization-drift.test.ts | 8 | Retire four deleted examples, normalize CRLF for four retained checks; **14/14 PASS**. |
| daemon/tests/prompts/host-failure-narration.test.ts | 4 | Normalize scanner paths/instance line endings, retire deleted pet entries, explicitly review two existing game directives; **7/7 PASS**. |
| daemon/tests/prompts/stable-sections.test.ts | 1 | Require exactly memory/mode drift; **18/18 PASS**. |
| daemon/tests/plugins-export.test.ts | 1 | Assert native complete output path; **5/5 PASS**. |
| daemon/tests/resume-continue-prompt-context.test.ts | 2 | Native Node/cmd fixture, complete stdin frame and flush completion signals; **2/2 PASS**. |
| daemon/tests/export-tool-token-authority.test.ts | 1 | Real PNG/deferred read preserves revocation-before-response assertion; **15/15 PASS**. |
| daemon/tests/server-paths.test.ts | 3 | Native absolute fixtures preserve override and relative-root checks; **14/14 PASS**. |
| daemon/tests/craft-route.test.ts | 1 | Real bug: list/detail routes were accidentally deleted with the design-system router. Independent craft registrar and stronger red/green HTTP checks; **4/4 PASS**. |
| e2e/specs/web-clone/main.spec.ts | Not rerun by daemon repair | Historical Windows fake-Chrome ENOENT remains outside this task; no current passing claim. |

The extra static-resource probe's five removed-design-system mutation cases were retired; its two live skill-origin guards pass. The wider known-daemon rerun also repaired three ACP wiring PATH fixtures and the agent-browser CRLF assertion. Older frontmatter, atom-chain, project-junction, handoff-startup and telemetry-smoke failures pass unchanged at `52c56f7e`. [DAEMON-TEST-REPAIR.md](DAEMON-TEST-REPAIR.md) records every title, category, command and the separate real craft bug. No removed domain, compatibility executable, provider test or phase-3 work was introduced.

## Exact focused file selections

### List A — daemon

```text
tests/acp-stdio-mcp.test.ts
tests/acp.test.ts
tests/cli-files-write.test.ts
tests/cli-run-steer.test.ts
tests/cli-skills-install.test.ts
tests/cli-startup.test.ts
tests/comment-cli-http-sqlite.test.ts
tests/comment-cli.test.ts
tests/daemon-lifecycle.test.ts
tests/daemon-url.test.ts
tests/db-message-events.test.ts
tests/diagnostics-export.test.ts
tests/directions-cli.test.ts
tests/handoff-cli.test.ts
tests/late-media-produced-file-association.test.ts
tests/library-figma-sidecar.test.ts
tests/mcp-install-cli.test.ts
tests/mcp-install-info.test.ts
tests/media-cli-help.test.ts
tests/media-generate-multi-image.test.ts
tests/media-generate-prompt-file.test.ts
tests/media-generate-structured-error.test.ts
tests/media-scaffold-cli.test.ts
tests/media-wait-safety-output.test.ts
tests/media-wait-stdout-flush.test.ts
tests/plugin-workspace-cli.test.ts
tests/plugins-canon.test.ts
tests/plugins-export.test.ts
tests/plugins-headless-run.test.ts
tests/plugins-marketplaces.test.ts
tests/plugins-publish.test.ts
tests/plugins-scaffold.test.ts
tests/plugins-upgrade.test.ts
tests/project-cli.test.ts
tests/resume-continue-prompt-context.test.ts
tests/routes/conversation-fork-title-numbering.test.ts
tests/run-cli.test.ts
tests/runtimes/claude-approval-args.test.ts
tests/runtimes/json-event-stream.test.ts
tests/runtimes/mcp.test.ts
tests/server-bootstrap-regression.test.ts
tests/store/cli.test.ts
tests/web-clone-browser-runtime.test.ts
```

### List B — additional daemon

```text
tests/artifacts-cli.test.ts
tests/chat-artifacts-run-cover.test.ts
tests/cli-deploy.test.ts
tests/cli-lint.test.ts
tests/cli-phase2c.test.ts
tests/cli-templates.test.ts
tests/craft-route.test.ts
tests/daemon-startup.test.ts
tests/export-html-cli.test.ts
tests/export-tool-token-authority.test.ts
tests/export-tool-token-nonloopback-authority.test.ts
tests/game/verify.test.ts
tests/plugins-genui-spec-enrichment.test.ts
tests/project-consumer-cli-workspace-scope.test.ts
tests/server-paths.test.ts
tests/export-cli-routing.test.ts
```

### List C — web

```text
tests/components/ChatPane.media-task-polling.test.tsx
tests/components/PluginDetailView.curated-layout.test.tsx
tests/components/PluginShareMenu.test.tsx
tests/components/PluginsView.test.tsx
tests/components/ToolCard.disclosure.test.tsx
tests/components/chat/image-fail-cell-two-states.test.tsx
tests/components/chat/image-retry.test.tsx
tests/components/chat/image-strip-preview-actions.test.tsx
tests/components/chat/media-row-surface.test.tsx
tests/components/chat/mirror-gallery.test.tsx
tests/components/chat/pixel-liquid-loading.test.tsx
tests/components/chat/w123-acp-inflight-tool-row.test.tsx
tests/components/home-hero/plugin-authoring-prompt.test.ts
tests/components/pluginFolderActions.test.ts
tests/components/use-everywhere-agent-guide.test.ts
tests/runtime/chat/build-turn-blocks.test.ts
tests/runtime/chat/live-row-elapsed.test.ts
tests/runtime/chat/media-batch-row.test.ts
tests/runtime/chat/media-surface-dispatch.test.ts
tests/i18n/locales.test.ts
```
