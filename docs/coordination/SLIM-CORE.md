# Slim-core removal ledger — 2026-10-29

Batches 1a–8 are host-verified and committed. Batch 9 remains
unstaged/uncommitted for host review. No push, live provider call, global
configuration change or installed Alpha.3 operation is part of this run. The
owner's CLOUD-CREDITS-LAUNCH-PLAN.md edit is excluded and untouched.

| Batch | Commit | Files | + lines | − lines | Kept |
| --- | --- | ---: | ---: | ---: | --- |
| 1a | 857258b6 | 157 | 689 | 50,733 | Projects/chat, skills/MCP, guarded Runs. |
| 1b | 5d9da68f | 662 | 3,696 | 114,971 | Privacy, providers, question forms, game/media/store. |
| 2 | 78216c3f | 608 | 9,725 | 108,876 | Neutral files, plain HTML, exports and core chat. |
| 3 | 894557ed | 146 | 675 | 14,944 | Shared game prompt, question forms, run analytics. |
| 4 | 9e2ad047 | 1,678 | 1,496 | 226,955 | Game catalogue and required recipe/Studio/Store dependencies. |
| 5 | e6b5ff51 | 93 | 548 | 69,475 | Complete en/zh-CN UI; arbitrary content languages. |
| 6 | 1f3e91b0 | 382 | 1,198 | 59,193 | Codex/Claude/OpenCode, BYOK, approvals and steering. |
| 7 | 5cdeeee6 | 45 | 544 | 556 | Historical evidence, current core boundaries and maps. |
| 8 | 5b4e4205 | 59 | 184 | 8,316 | Runtime setup, ordinary project flows and protected game-mode copy. |

Statistics above are from git show --stat for each committed batch, including
host corrections. This sandbox has no local main ref; origin/main is the original
fork commit. The seven consecutive slim-core commits follow f225fa80, so the
labelled slim-core comparison is f225fa80..1f3e91b0 rather than the upstream range.
The committed range changes 3,166 files: +11,808/−638,928 lines
(git diff --stat f225fa80..1f3e91b0). Per-batch sandbox results below remain
historical evidence; host commit statistics above are authoritative.

Including batch 7, `git diff --stat f225fa80..5cdeeee6` reports 3,191 files,
+12,330/−639,462 lines. The host then committed CLI help cleanup (`6435af65`)
and game chat examples (`a864177f`) and reported all three builds and the isolated
home/Phaser/file-tree/Claude smoke passing. Batch 8 below has its own focused gates.

## Batch 1a — memory, automation and routines

- Host commit: `857258b6 refactor: remove memory, automation and routine domains`.
- Deleted those domains' daemon/web/CLI/contracts/i18n surfaces and exclusive tests.
- Kept chat, projects/sessions, skills/MCP and the guarded Run lifecycle.
- Commit stat: 157 files, 689 insertions, 50,733 deletions.
- Validation: owner verified and committed the batch.

## Batch 1b — inherited daemon/web domains

- Host commit: `5d9da68f refactor(core): remove inherited daemon and web domains`.
- Deleted connectors, critique, live artifacts, GenUI, deploy, upstream exporters,
  browser sessions, handoff CLI and their obsolete entry points and tests.
- Kept provider/BYOK configuration, privacy/error tracking, run telemetry required
  by the start choke point, question forms, game/assets/media/recipes/store and
  project extensions. Host review repaired retained-provider and runtime tests.
- Commit stat: 662 files, 3,696 insertions, 114,971 deletions.
- Validation: owner ran dependency installation, root guard/typecheck and every
  reviewed test file before committing.

## Batch 2 — design-tool UI surfaces

- Host commit: `78216c3f refactor(core): remove design-tool editing and preview surfaces`.
- Deleted design browsing/editors/overlays, mutable preview comments, deck/edit/
  inspect/tweaks/palette bridges, deck templates, craft and design daemon domains,
  inherited Home scenarios, exclusive dependencies/styles/tests/fixtures.
- Kept neutral FilesPanel/ProjectsPanel, ordinary HTML transport guards, code/
  text/markdown/image/audio views, diff, external editor/engine handoff, generic
  exports, question forms and all game/core paths. Annotation-history compatibility
  was temporarily retained; batch 3 removes it.
- Commit stat: 608 files, 9,725 insertions, 108,876 deletions.
- Validation: owner ran pnpm install, root guard/typecheck and every touched test
  file before committing. Historical baseline failures are not repeated here.

## Batch 3 — sole game prompt and retired annotation history

- Host commit: `894557ed refactor(core): make game prompt composition the only path`.
- Deleted legacy design composers/switches/directions and annotation-history
  compatibility. Kept game media, Plan, skills/plugins/MCP, question forms,
  runAskedUserQuestion, stable-prefix caching and ordinary messages/attachments.
- Existing DB columns were left untouched. Generic export fixtures were repaired
  and skill safety guidance restored for extension-only runs.
- Validation: owner verified root guard/typecheck and touched tests, then committed.

## Batch 4 — catalogue

Deleted:

- 123/153 skills, 49/54 design/media templates, 181/252 plugin directories,
  87/106 prompt JSON files: 440 entries total. Three deleted plugin directories
  had no manifest. Current plugin manifest count is 71, down from 249.
- 62/79 baked-preview records, 12 orphan/duplicate preview assets, retired catalogue
  copy/priority/popularity rows, three seed/slide-maintenance scripts and two root
  seed commands. Inherited-family filtering and obsolete default-plugin bindings
  are removed; no always-true filter or hidden fallback remains.
- Exclusive catalogue tests and retired designer atom/scenario dependencies.
  Family rules, the 507-entry historical decision and full retained inventory are
  in [PHASE1-CATALOG-REVIEW.md](PHASE1-CATALOG-REVIEW.md).

Kept, with reasons:

- 30 engine/browser/media/3D skills, five reusable media templates, 71 game/media/
  extension plugins and 19 game prompt JSON files. The Store's 18-entry snapshot,
  all 26 recipes, Studio's 12 recipe IDs and their skill dependencies remain.
- Seven generic coding atoms and two extension/media scenarios keep valid tool
  stages; deleted discovery/design stages and false runner claims are removed.
- Generic plugin/skill import, Store, file access, question forms and playback
  coverage survives. Borrowed resource fixtures move to neutral fixtures,
  including a flat TypeScript resource containing the unchanged vendored GSAP.
- Registry/authoring infrastructure and imported-plugin category labels stay.
  No database or data-path changes and no dependency removals were needed.

- Host commit: `9e2ad047 refactor(catalog): retain only game and core asset resources`.
- Commit stat: 1,678 files, 1,496 insertions, 226,955 deletions.
- Validation: owner verified root guard/typecheck, touched tests and three Playwright
  files before committing. The retained HyperFrames fixture name was restored.

## Batch 5 — locales

Deleted:

- 17 non-maintained UI dictionaries and 15 matching standalone content files
  (32 files). German content was inline; Traditional Chinese used an alias;
  both paths and all other retired UI-locale maps/aliases are removed.
- Retired language-picker choices, partial-dictionary fallback typing, UI RTL
  branching, 16 RTL-only CSS blocks and one Japanese font override. `Locale` is
  `en | zh-CN`; `LocaleDicts` is `Record<Locale, Dict>`.
- Obsolete locale assertions and, where importer validation exposed them, narrow
  oracles for already-deleted Tasks, connector drawers and preview comments.

Kept, with reasons:

- English/Simplified Chinese dictionary values and Chinese catalogue copy are
  unchanged. Both dictionaries have
  3,907 keys with no missing/orphan keys. Unsupported saved preferences fall
  through desktop/browser detection to English; Chinese browser tags use zh-CN.
  Regression tests cover all 17 retired saved values, both picker choices and
  supported manual choices. Prompt UI fallback follows the same two languages.
- Arbitrary conversation/output languages, generic text direction, OS locale
  transport, provider/voice language inputs and MCP request-language form data
  remain independent of UI locale support. Plugin/skill `title_i18n` and
  `description_i18n` data is untouched, as are retained catalogue fixtures.
- `plugin-content.ts` and `runErrors.ts` already used only English/Chinese and
  needed no map edits. Chinese fonts remain; no font assets or dependencies
  became unused. Package manifests and lockfile are unchanged; no install run.
- README link/locale validation remains enforced; its parser now understands the
  maintained root Markdown README pair and `LocaleDicts` registration syntax.
  Root/chat AGENTS guidance describes the two complete dictionaries.

New failing cases encountered (baseline/environment cases omitted):

| Case | Decision | Resolution |
| --- | --- | --- |
| Locale lists, retired dictionary imports, French-only Close/ARIA fixtures, question-form unbundled-language helper, invalid-key/run-error-ladder dictionary counts | (a) deleted UI locale support | Assert the maintained pair; keep generic behavior and arbitrary user-content language coverage. Full modified files rerun. |
| Retired Tasks/connector/preview-comment CSS oracles | (a) deleted features | Remove only exclusive cases; retain generic chat, audio and modal assertions. |
| Saved retired preference and shared game/follow-up UI fallback | (b) KEEP fallback | Reject unsupported saved values before dictionary lookup; normalize UI prompt fallback to English/zh-CN while preserving explicit conversation language. Red/green specs pass. |
| i18n-check cannot parse LocaleDicts or current root Markdown README switchers | (b) KEEP validation | Repair parsers/path lookup; retain broken-link, missing-locale and localized-core-document checks with red/green coverage. |
| Modal drag strip CSS has selectorless blocks from an earlier removal | (b) KEEP project/plugin modal behavior | Restore only retained backdrop selectors and match the hook list; add a red/green rule-binding regression. |

Validation uses the pinned local toolchain and package-scoped focused Vitest runs
with `--configLoader runner` and source-alias scratch configs where needed. No
full daemon/web suite, live provider, installed-instance lifecycle or global
configuration operation was run. Exact importer inventories, reports and baseline
proofs live under ignored `.tmp/slimcore/batch5/`.

| Command/scope | Result |
| --- | --- |
| `pnpm guard` | PASS |
| `pnpm --filter @openpixo/contracts typecheck` | PASS |
| `pnpm --filter @openpixo/web typecheck` | PASS |
| `pnpm --filter @openpixo/daemon exec tsc -p tsconfig.json --noEmit` | PASS |
| `pnpm --filter @openpixo/daemon exec tsc -p tsconfig.tests.json --noEmit` | PASS |
| `pnpm --filter @openpixo/e2e typecheck` | PASS |
| `pnpm exec tsc -p scripts/tsconfig.json --noEmit` | PASS |
| `pnpm i18n:check` / `pnpm i18n:coverage` | PASS; both maintained locales complete |
| `pnpm --filter @openpixo/web exec vitest run ...` | Baseline failures only: 406 files, 3,256 passed, 12 failed, 69 setup-blocked |
| `pnpm --filter @openpixo/contracts exec vitest run ...` | PASS: 4 files / 21 tests |
| `pnpm --filter @openpixo/daemon exec vitest run ...` | Baseline failures only: 6 files, 30 passed / 2 failed |
| `pnpm --filter @openpixo/e2e exec vitest run ...` | PASS: 6 files / 37 tests |
| `git diff --check` | PASS |

Two CRLF-sensitive CSS test readers now normalize line endings while preserving
their selectors/property assertions. Remaining web failures match f225 evidence:
preview keep-alive, NewGameDialog, support links, workspace-switcher tests and
three CSS-hash/Chrome setup blocks (69 cases do not reach assertions). The two
daemon locale-carriage failures hit the same pre-existing `ENOENT prompt.txt`
before locale assertions. Exact proofs are referenced by `core-results.json` and
`cross/prior-baseline-proof.json`; no unresolved new failure remains. No root
typecheck was run in this sandbox, following the requested package-level gates.

Host commit: `e6b5ff51 refactor(i18n): retain English and Simplified Chinese locales`.

Sandbox accounting (excluding the owner's edit): 92 tracked files, 431 insertions and
69,477 deletions via git diff --stat; one new test adds 113 lines.
Total: 93 files, 544 insertions, 69,477 deletions (net -68,933 lines).

Host verification (2026-10-28): root `pnpm guard` and `pnpm typecheck` PASS;
every modified web (31 files / 411), contracts (4 files / 21) and e2e Vitest
(2 files / 9) test passes. The daemon prompt tests pass; the two
`opend-2765-next-step-locale-carriage` cases fail identically on HEAD `9e2ad047`
(the fake agent never writes its prompt file on this Windows host).


## Batch 6 — runtimes

Deleted:

- 22 runtime definitions; registration, detection/executable/auth/model metadata,
  CLI handoff/setup choices, exclusive resume/diagnostic/analytics DTO branches
  and English/Chinese settings copy. The registry now has four definitions.
- 59 daemon modules (including the 22 definitions), 41 daemon test files and
  12 exclusive fixture/helper files. These include ACP, Pi RPC, DSH services,
  plain/Qoder/Copilot streams, Qwen settings, local profiles, argv prompt budgets
  and unused terminal-login launching. Exclusive tests and fixtures are removed.
- The 13-file DSH workspace package, bootstrap installers/publishers, upstream
  drift check and build/postinstall/CI wiring. Pack cache schemas advance to
  invalidate the removed resource closure; generic cache policy is unchanged.
- 14/18 mock launchers, five/eight formatters and 43/179 manifest entries;
  16 runtime-only icons, three DSH UI/provider/CSS files, one exclusive web test
  and six runtime-only guides. Six e2e and nine tools files are also removed.
  No cached raw recordings existed to delete. Retired-only model-lock wrappers
  and styles are removed rather than left as identity gates.

Kept, with reasons:

- Codex, Claude Code, OpenCode and BYOK/bundled OpenCode; their streams, native
  session recovery, approvals, steering, cancellation, real Claude recordings
  and the run-start analytics choke point. Generic mock agents remain usable in
  tests. All three offline mock protocols/golden payloads remain; the fourth
  launcher is the OpenCode CLI alias.
- BYOK provider/model/media data, including DeepSeek/OpenRouter, and xAI OAuth
  plus read-only Hermes credential borrowing for media. External editor and MCP
  client installation targets are integrations, not hosted agent runtimes.
- Unknown saved IDs resolve to an available kept runtime or the normal no-agent
  state. The web projects that choice in memory; daemon reads preserve the saved
  ID/model and file bytes. No migration, database or data-path change is made.
- Generic historical event rendering, credential redaction and tool timing stay
  where used by core history/diagnostics. Runtime-exclusive protocol contracts
  and producers are removed. The DSH-named stderr fixture stays solely for
  generic credential redaction. Retained fixture identities are not renamed.

New failing cases encountered (baseline/environment cases omitted):

| Case | Decision | Resolution |
| --- | --- | --- |
| Removed runtime/parser/profile/auth/registry/icon/diagnostic oracles, ACP MCP serializer and DSH setup cases | (a) deleted runtimes | Remove exclusive cases/rows; retain Codex/Claude/OpenCode assertions and full-file replay coverage. |
| Already-retired GenUI/deploy CLI matrix, preview selection/comments, design enrichment and deleted catalogue binding | (a) deleted features | Remove only retired cases; use a retained game plugin where a generic project-binding test still needs a resource. |
| Saved Gemini preference normalization and web selection against stale IDs | (b) KEEP saved-config fallback | Preserve the original config; resolve available daemon DTOs in memory, including ordinary test mock DTOs. Kept unavailable runtimes retain normal setup guidance. |
| New headless saved-ID fallback fixture cannot launch after clearing PATH on Windows; token-startup test injects a deleted prompt-file seam | (b) KEEP regression coverage | Use absolute Node in the fake CLI/Windows wrapper; 20 fallback cases pass. Move startup injection to the kept tool-bundle seam; its assertion passes. |

Validation uses the pinned toolchain, focused full files, source-alias scratch
configs and isolated runtime homes/configuration with provider credentials
removed. The importer audit and exact command/reproduction reports are under
ignored .tmp/slimcore/batch6/; no full daemon/web suite or live provider test ran.

| Command/scope | Result |
| --- | --- |
| pnpm guard; pnpm i18n:check | PASS |
| pnpm --filter @openpixo/contracts typecheck | PASS |
| pnpm --filter @openpixo/web typecheck | PASS |
| pnpm --filter @openpixo/daemon exec tsc -p tsconfig.json --noEmit | PASS |
| pnpm --filter @openpixo/daemon exec tsc -p tsconfig.tests.json --noEmit | PASS |
| pnpm exec tsc -p scripts/tsconfig.json --noEmit | PASS |
| e2e/platform/tools-pack/tools-release/tools-serve package typechecks | PASS |
| Package-scoped Vitest full files for modified tests and direct importers | Completed; baseline/environment failures below remain |
| Five affected Playwright files, --list and individual --workers=1 attempts | Listing PASS; execution setup-blocked before product assertions |
| Desktop dynamic-import consumer (22 tests, current contracts source) | PASS |
| Offline mock replay/launcher/manifest checks | PASS; retained golden payloads unchanged |
| pnpm --filter @openpixo/daemon exec tsx src/cli.ts --help; release help | PASS |
| git diff --check | PASS |

Coverage audit: 806 affected test files accounted for: 801 full Vitest files
and five Playwright attempts. No modified test or direct importer is missing.

Remaining failures are reproduced at f225fa80 or explicitly caller-known:
Windows extensionless fake-CLI/process/path/symlink behavior, absent pre-existing
Codex/OpenCode/Claude evidence fixtures, existing web assertions/Chrome setup,
release base-version validation, contracts error expectations, jq absence and
sandbox esbuild/CIM permissions. These have no new (a)/(b) rows. Load-sensitive
cases and a hidden-temp-directory HTML asset failure passed isolated reruns;
the latter also reproduced at baseline. No unresolved new product failure remains.

Manifest change: deleted packages/dsh-runtime/package.json only. The lockfile is
unchanged; no installation was run. Ignored build caches are left for host cleanup.

Host commit: 1f3e91b0 refactor(runtimes): retain certified agent runtimes.

Sandbox accounting for batch 6 before host verification (excluding the owner edit): 379 files, 1184 insertions
and 58905 deletions via git diff --stat (net -57721 lines).

Host verification (2026-10-29): `pnpm install` regenerated `pnpm-lock.yaml`
for the deleted `packages/dsh-runtime` workspace. Its daemon postinstall build
exposed one (b) case: `run-retry-policy.ts` still compared against the deleted
`qoder_stop_sequence` failure detail (TS2367); the source branch and its test
entry were removed. Codex scratch under `e2e/.tmp/` (an E2E layout guard
violation) was moved out of the package. Root `pnpm guard` and `pnpm typecheck`
PASS. Every remaining Vitest failure in touched files also fails on a detached
e6b5ff51 worktree (Codex thread cleanup, connection test under the shell's
`ANTHROPIC_BASE_URL`, MCP config/spawn, project file range, platform index, e2e
scopes) or passes when rerun alone. The three touched Playwright files fail 26
cases on this tree and 28 at e6b5ff51; the extra baseline failures are the
deleted ACP handshake and plain-stdout runtime cases. No new failure remains.

## Batch 7 — documentation

- Align root/directory guidance, the project map and maintained guides with the
  retained core; add ADR 0012 and preserve explicitly historical records.
- Commit accounting comes from Git; source, tests and manifests remain unchanged.
  Final build/runtime smoke is pending. Validation results are recorded below.

- Changed 45 Markdown files: 6 agent guides, 2 ADRs, 8 specifications,
  6 coordination records and 23 other guides/maps/reference documents.
- Keep historical measurements, proposals and ADR bodies explicitly labelled as
  history; removed-directory warnings prevent restoration. ADR 0007's original
  task link remains historical, with archive/current-decision pointers beside it.
- Validation: `pnpm guard` PASS (including upstream-name, product-neutrality and
  plugin preview manifests); `pnpm i18n:check` PASS; the focused E2E-package
  `tests/scripts/{guard,product-neutrality,i18n}.test.ts` run PASS (3 files,
  51 tests); `git diff --check` PASS. Checked current documentation paths and
  relative links; historical/proposed paths are labelled. No new failing cases.
- No source, test or manifest changes; no installation, staging or commit.
  Final builds and isolated runtime smoke remain pending.

## Batch 8 — web copy and onboarding

- Delete the unmounted recommendation flow, project-entry stash/consume,
  About-you attribution, and its exclusively gated first-artifact hint and
  first-prompt/generation/loop helpers. Remove four funnel event names and the
  recommendation/hint click and view payloads; leave stored analytics untouched.
- Delete five unreachable brand/design next-step variants, old deck/subfacet
  branches and the unmounted integrations modal wrapper. Keep runtime setup,
  ordinary project drafts/exports, live GuidePanel, Plan/recovery/toolbox actions
  and installed-plugin metadata labels.
- Delete 1,538 keys from each complete Dict (3,895 → 2,357). Retain computed
  Store, capability, engine, asset, verification, guide and toolbox keys. Every
  retained locale property, including all 42 protected mode/example properties,
  matches the initial host-edited source; persisted session-mode IDs are unchanged.
- The Batch 8 copy working list identified retained design-flavored wording.
  Batch 9 implements the owner's decisions in [the game-copy record](BATCH9-GAME-COPY.md)
  and removes that temporary working list.

- File accounting: 13 source/helper/style files and 9 exclusive test files deleted;
  remaining source changes remove dead branches. No manifests changed, no install,
  staging or commit. No current guide names the deleted funnel modules; historical
  PHASE7-CLOSE command records remain evidence.

Only new failing cases encountered during validation:

| Case | Decision | Change |
| --- | --- | --- |
| AssistantMessage.hidden-extra-ui used brand-extraction-incomplete (typecheck) | (a) Removed variant | Use project-incomplete; retain hidden-extra-UI assertions. |
| styles/entry-materials expected the removed modal overlay stylesheet | (a) Removed wrapper | Drop that stylesheet entry; retain every live overlay assertion. |

Other (a) updates remove exclusive funnel tests, the recommendation-strip case,
retired next-step/cascade fixtures and three locale tests' deleted-feature rows.
There were no (b) source fixes or unresolved new failures.

Validation:

- `pnpm guard`, `pnpm i18n:check`, web typecheck and contracts typecheck PASS.
- Every modified/direct-importer web, contracts and E2E Vitest file ran, including
  source-reading tests. The final 8 modified web files PASS (87 tests); all 14
  i18n files PASS (90 tests); 11 contracts files PASS (89 tests). The 14 retained
  surface test files PASS (233 tests, with affected files rerun after (a) fixes).
- The broader importer runs retain four baseline failures: known preview
  keep-alive, support-channel oracle, NewGameDialog's extra null argument oracle,
  and packaged app-shell's old cloud identity marker. The latter three reproduce
  with f225fa80 source/test overlays; no Batch 8 expectation was relaxed for them.
- Default web test loading hit sandbox esbuild denial; runner loading hit the
  tracked config's __dirname. An equivalent root-scratch config preserves aliases,
  setup, includes and timeouts and resolves the web root explicitly. CI-scope
  tests initially lacked python3, then all 11 PASS using a scratch PATH alias to
  the installed Python; no global configuration changed.
- AST comparison proves all retained English/Chinese properties byte-identical
  to the initial host-edited files. Protected launch-plan blob unchanged;
  `git diff --check` PASS. Commands, whole-file lists, JSON results and baseline
  probes are under the ignored repo-root `.tmp/slimcore/batch8/`.

## Batch 9 — game copy

- Batch 9b: workspace setup reuses the shared production-API project helper; retained media tests select their surfaces directly, and legacy deck metadata uses the neutral HTML cover iframe.
- Deleted six retired pool scenarios, the design-tabs/form case and unused team/design-form setup; retained chat, files, metadata and installed-plugin fixtures are unchanged.
- Validation: e2e typecheck, guard and Playwright `--list` PASS (173 tests / 15 files); no browser tests or snapshot regeneration. Host execution and review of `visual-new-project-modal.png` remain pending.

- Delete Library UI/pickers, route/state/API helpers and its hidden switch;
  remove the independent legacy daemon registry, pairing/tokens, tool grants,
  CLI command and creation code. Move the kept local/GitHub skill installer and
  its test to neutral skill-local-installation names. Existing database tables,
  columns and stored data are untouched; the game asset index is independent.
- Delete all 16 design actions, the toolbox and duplicate resource/standalone
  plugin pickers, plus the missing-artifact next step. Composer +/@ resources,
  plugin previews, Plan, continue, downloads and suggestions remain.
- Keep the new-project panel only for image/video/audio, working-directory
  selection and folder import. Game templates still use NewGameDialog. Remove
  design tabs/controls/ZIP import and retired kind filters/badges/cover logic;
  old metadata falls back to Game. Multiple live game/media filters remain.
- Delete 214 Dict keys; rename seven retained keys and rewrite 20 paired entries.
  The supplied ChatPane starters/continue prompts are exact; all other ChatPane
  starters/icons, 42 protected mode/example properties per locale, persisted mode
  IDs, export/file-format names and installed-plugin facet labels are unchanged.
  Shared settings.library labels/CSS remain only for active skill/resource UI.
- [Implemented copy and host checklist](BATCH9-GAME-COPY.md) records counts and
  every extra rewrite, replacing the deleted Batch 8 working list. No standalone
  analytics event name was exclusive; removed Library/toolbox/tab/ZIP payloads
  and helpers while retaining media creation and Plan/continue analytics.

New failing cases, all (a), with no (b) source regression found:

| Case | Retired expectation updated |
| --- | --- |
| HomeHero.plugin-picker / HomeView.mention-files-cap | Design files → Project files. |
| ProjectsPanel.select-mode | Your designs → Your projects. |
| HomeView.media-options | Commercial subject/style → game defaults. |
| ChatComposer.context-pickers | English/Chinese old file labels → Project files/项目文件. |
| home-hero-creation-i18n | Retired Prototype wording → Game/游戏. |

Other (a) updates remove exclusive Library/toolbox/ZIP/design-panel tests and
deck-only cover assertions; retained creation, preview, skills and resource
fixtures are preserved. No manifests changed; no installation, staging or commit.
Deleted 19 production/helper/style files and 12 exclusive tests; separately moved
one kept skill installer and its test. The untracked Batch 8 working list is gone.

Validation:

- Guard, i18n check, web/contracts typechecks and both daemon compiler projects
  PASS. Source pixo help PASS, with Library absent and blank-line formatting kept.
- All 448 affected web files ran (zero coverage gaps): 3,805 cases PASS; three
  known baseline assertions fail (preview keep-alive, extra-null game-create
  oracle, support channels). Two f225fa80 baseline suite failures block 31 cases:
  the stale CSS-module hash probe and raw Chrome CDP transport. No new failure.
- Contracts: all 13 affected files / 113 tests PASS. E2E: all six affected files
  ran; 72 cases PASS, the baseline cloud identity-marker case fails, and namespace
  startup is blocked by the sandbox contracts/esbuild ancestor-directory denial.
- Daemon: 21 focused route/auth/CLI/DB/skills/asset files ran; all eight auth tests
  PASS with a diagnostic 60s hook budget. Remaining failures are known symlink
  EPERM or reproduced with pre-batch HEAD source overlays (CSS fixture under a
  dot-path scratch root, SQLite cleanup EBUSY and four fake-CLI startup cases).
  The 115 server importers were inventoried; the full daemon suite was not run.
- Exact-copy/AST checks PASS for all supplied pairs, the five ChatPane starters,
  original starter icons/other entries and all protected properties. New doc links
  and diff whitespace PASS; owner launch-plan blob unchanged. Playwright was not
  run; the 15-file host checklist is in the linked change record.

Commands, complete whole-file scope, JSON results and baseline probes remain in
the ignored repo-root `.tmp/slimcore/batch9/`.
Tracked `git diff --stat`, excluding the owner edit, covers 138 files and 17,925
deleted lines. Three untracked files are the renamed skill installer/test and
the implemented-copy record; 141 changed paths comprise 73 source, 46 tests and
22 Markdown documents.

Host verification (2026-10-29, batch 8): the host also rewrote every `chat.mode.*`
value for game development (the `design` mode is labelled Build / 构建; the ids
are unchanged) and updated the ComposerModePicker and SessionModeToggle copy
assertions to match. Root guard and typecheck PASS. `vitest related` over every
changed web source and the touched contracts tests leave only cases that also
fail at a864177f (preview keep-alive, EntryNavRail workspace switcher, NewGameDialog,
contracts error-code and failure-detail) or pass alone (two ProjectView restore
cases, contracts package runtime). No new failure remains.

Host verification (2026-10-29, batch 9 + 9b): root guard and typecheck PASS.
`vitest related` over every changed web, daemon and contracts source plus the
changed tests: the only new failure was `UpdateDialog`, which still asserted the
retired updater copy; its assertion now uses the rewritten text and passes. Every
other web failure also fails at 5b4e4205 or passes alone. The 48 failing daemon
files (mostly fake-agent timeouts) fail the same way at 5b4e4205; the moved
`containsSymlink` cases and `skills-delete` need Windows symlink privilege (EPERM).
The 15 Playwright files ran on both trees (5b4e4205: 89 pass / 76 fail; batch 9:
99 pass / 61 fail). By test title only three failures were new: the projects
sub-tab case still clicked "Your designs" (now "Your projects", passes), and two
Claude cases whose daemon stalls on project load; run alone, those two and the
prompt-too-long case fail identically at 5b4e4205. `visual-entry` (its own
`playwright.visual.config.ts`) has the same two failures on both trees. Its
new-project screenshot showed the media template/model pickers unstyled: the
shared `.ds-picker*` rules were lost with `workspace/connectors.css` in batch 1b.
The still-used rules now live in `styles/workspace/pickers.css`, imported at the
old position; the recaptured modal and the open template list render correctly.
