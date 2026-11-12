# Phase 5 — identifiers, CSS, and filenames

> Historical naming checkpoint. Library module and test references below describe the recorded commits; [slim-core Batch 9](SLIM-CORE.md#batch-9--game-copy) later removes the global registry.

Owner-authorized execution on `codex/opendesign-base`, from `8fc76fd680138ae685374bed691adf7576bda076` through code commit `b5fb9677`. No aliases, compatibility exports, CSS fallback selectors, or migrations were added. Phase 6 prose, UI/i18n values, upstream URLs and external API names remain. The migration source moved to [remove-upstream-traces.md](../../specs/current/remove-upstream-traces.md).

Guard and repository typecheck passed before every implementation commit. All seven requested builds, CLI help, the imported-game E2E and a fresh recorded mock conversation pass. NSIS build: **PASS**. Final visual comparison: eight images with zero perceptible differences and zero computed-style differences; seven byte-identical, four subthreshold rasterization pixels in Settings dark.

## Ordered commits

| Commit | Subject | Changed files | Validation |
|---|---|---:|---|
| `9f7c622b` | refactor!: delete upstream contribution skill | 24 | guard + typecheck PASS; focused evidence in ledger |
| `b0be85fc` | refactor!: delete upstream Helm deployment charts | 31 | guard + typecheck PASS; focused evidence in ledger |
| `c119f9e8` | refactor!: delete upstream landing template | 52 | guard + typecheck PASS; focused evidence in ledger |
| `649bb4ad` | refactor: rename od identifiers to pixo | 245 | guard + typecheck PASS; focused evidence in ledger |
| `b93adb2f` | refactor(web): rename od- CSS classes to pixo- | 124 | guard + typecheck PASS; focused evidence in ledger |
| `b5fb9677` | refactor!: rename od- files and plugin ids | 722 | guard + typecheck PASS; focused evidence in ledger |

All commits use `Claude <claude@local.invalid>`; no co-author metadata, config changes, history rewrites or push. The final documentation checkpoint follows these six commits.

## Counts at each checkpoint

Cells are **text files / matching lines**, using `git grep -I`, excluding `dist`, `docs`, `specs`, and Markdown. CSS counts are bounded class-like candidates, including non-class strings. Paths include all tracked files. The owner's starting counts include binary matches; for example, the lower-case family is 88 files / 215 reported lines without `-I`, versus 44 / 171 text hits. Encoded images/fonts and integrity hashes are not code identifiers.

| Checkpoint | odFoo | OdFoo | OD_FOO | OpenDesign-family text | od- candidates | --od- | Paths |
|---|---:|---:|---:|---:|---:|---:|---:|
| Start | 44 / 171 | 30 / 156 | 22 / 115 | 625 / 3290 | 685 / 2993 | 9 / 39 | 151 |
| delete upstream contribution skill | 44 / 171 | 30 / 156 | 22 / 115 | 622 / 3284 | 679 / 2945 | 9 / 39 | 128 |
| delete upstream Helm deployment charts | 44 / 171 | 30 / 156 | 22 / 115 | 621 / 3283 | 678 / 2944 | 9 / 39 | 97 |
| delete upstream landing template | 44 / 171 | 30 / 156 | 22 / 115 | 619 / 3254 | 677 / 2943 | 9 / 39 | 59 |
| rename od identifiers to pixo | 4 / 5 | 15 / 22 | 0 / 0 | 529 / 1843 | 676 / 2942 | 4 / 34 | 59 |
| rename od- CSS classes to pixo- | 4 / 5 | 15 / 22 | 0 / 0 | 529 / 1843 | 572 / 2061 | 0 / 0 | 59 |
| rename od- files and plugin ids | 4 / 5 | 5 / 7 | 0 / 0 | 529 / 1843 | 54 / 661 | 0 / 0 | 0 |
| Final source | 4 / 5 | 5 / 7 | 0 / 0 | 529 / 1843 | 54 / 661 | 0 / 0 | 0 |

The TypeScript AST audit finds **0 active old identifiers**. The CSS/selector audit finds **0 retained old classes or custom properties**. Remaining text-family matches are classified individually in the final search artifact. See [checkpoint counts](../../.tmp/phase5-work/item-counts.json) and [every remaining search hit, location and reason](../../.tmp/phase5-work/final-search.tsv).

## Deletions

- **delete upstream contribution skill:** 23 deleted files.
- **delete upstream Helm deployment charts:** 31 deleted files.
- **delete upstream landing template:** 39 deleted files.

The contribution skill/command targeted `nexu-io/open-design`; its ignore-file exception was removed. Both Helm trees were unreferenced by retained runtime/build code (only deployment/historical documentation referenced them). The landing template was upstream's own site; its thumbnail, community preset, editorial aliases, special-case tests and landing-only E2E were removed. Generic skill/install/popularity tests now exercise retained templates. Two already-broken tests for the previously deleted landing-deck were removed after baseline reproduction. The critique fixture's fake Qwen launcher was made Windows-compatible. No requested deletion was retained for a non-trivial product dependency.

Deletion inventories: [9f7c622b](../../.tmp/phase5-work/deleted-9f7c622b.txt), [b0be85fc](../../.tmp/phase5-work/deleted-b0be85fc.txt), [c119f9e8](../../.tmp/phase5-work/deleted-c119f9e8.txt).

## Identifier and CSS changes

Source symbols, types, components, props, test helpers, embedded runtimes and constants follow the naming table. This includes `--pixo-os-locale`, `--pixo-repo` and its checkout help text. Locale **keys** changed where required; all 38 locale files retain their original string values. Import basenames moved in the subsequent path commit. External API names and recordings were preserved.

CSS classes/custom properties were classified before replacement across global styles, modules, shared components, selectors, iframe bridges and shipped content. The dynamic edit-guide class prefix was verified explicitly. The import-only cascade entrypoint is unchanged; reverse-name comparison of 26 standalone stylesheets found identical normalized content. No specificity, declaration, animation timing or cascade order was changed. A later SVG filter-ID rename has the same rendered output. [Cascade proof](../../.tmp/phase5-work/css-cascade-proof.json).

The sanitized syntax-quote derivative HTML fixtures received owned styling-hook renames; their README, canonical byte counts and hashes were updated. Their external CLI originals remain unchanged. Fixtures normalize checkout line endings for canonical hashes. These derivatives are not presented as verbatim recordings.

## Renamed paths and derived IDs

61 tracked files moved through 43 `git mv` operations (16 directories, 27 individual files). The original path pattern covered 59; two additional embedded `-od-` basenames moved too. Fourteen bundled plugin IDs, the MCP plugin ID, schema/catalog/template references, imports, screenshot links and the `openpixo-pr` command were updated. Generated carrier/config/resource directories now use `openpixo-config.json`, `openpixo` and `openpixo-web-standalone`; diagnostics and staging/test filename prefixes were updated at both producers and consumers.

The Windows resource-tree and electron-builder schemas are 12; archive recipe 4; NSIS base input-hash and both launcher recipes 3. Existing determinant/non-input witnesses and payload split/materialization tests pass. Six stale tsc outputs for the renamed metadata modules were moved into task scratch before rebuilding. [Stale-output inventory](../../.tmp/phase5-work/stale-dist-moved.json).

| Previous path | Current path |
|---|---|
| `apps/daemon/src/routes/open-design-public-metadata.ts` | `apps/daemon/src/routes/openpixo-public-metadata.ts` |
| `apps/daemon/src/services/open-design-public-metadata.ts` | `apps/daemon/src/services/openpixo-public-metadata.ts` |
| `apps/web/src/components/OdCard.module.css` | `apps/web/src/components/PixoCard.module.css` |
| `apps/web/src/components/OdCard.tsx` | `apps/web/src/components/PixoCard.tsx` |
| `apps/web/tests/components/OdCard.test.tsx` | `apps/web/tests/components/PixoCard.test.tsx` |
| `apps/web/tests/components/chat/od-card-inside-execution-shell.test.tsx` | `apps/web/tests/components/chat/pixo-card-inside-execution-shell.test.tsx` |
| `apps/web/tests/components/chat/opend-2745-raw-od-card-leak.test.tsx` | `apps/web/tests/components/chat/opend-2745-raw-pixo-card-leak.test.tsx` |
| `docs/adr/0005-opendesign-fork.md` | `docs/adr/0005-openpixo-fork.md` |
| `docs/schemas/open-design.marketplace.v1.json` | `docs/schemas/openpixo.marketplace.v1.json` |
| `docs/schemas/open-design.plugin.v1.json` | `docs/schemas/openpixo.plugin.v1.json` |
| `docs/screenshots/current-2026-06/od-app-preview.webp` | `docs/screenshots/current-2026-06/pixo-app-preview.webp` |
| `docs/screenshots/current-2026-06/od-design-dashboard.webp` | `docs/screenshots/current-2026-06/pixo-design-dashboard.webp` |
| `docs/screenshots/current-2026-06/od-design-mobile.webp` | `docs/screenshots/current-2026-06/pixo-design-mobile.webp` |
| `docs/screenshots/current-2026-06/od-design-reverie.webp` | `docs/screenshots/current-2026-06/pixo-design-reverie.webp` |
| `docs/screenshots/current-2026-06/od-home-sidebar.webp` | `docs/screenshots/current-2026-06/pixo-home-sidebar.webp` |
| `docs/screenshots/current-2026-06/od-home.webp` | `docs/screenshots/current-2026-06/pixo-home.webp` |
| `docs/screenshots/deployment/docker/01-open-design-home.png` | `docs/screenshots/deployment/docker/01-openpixo-home.png` |
| `docs/screenshots/deployment/docker/03-open-design-mobile.png` | `docs/screenshots/deployment/docker/03-openpixo-mobile.png` |
| `e2e/ui/ui-audit-od-f01.test.ts` | `e2e/ui/ui-audit-pixo-f01.test.ts` |
| `plugins/_official/examples/od-plugin-contribute-open-design/SKILL.md` | `plugins/_official/examples/pixo-plugin-contribute-openpixo/SKILL.md` |
| `plugins/_official/examples/od-plugin-contribute-open-design/pixo.json` | `plugins/_official/examples/pixo-plugin-contribute-openpixo/pixo.json` |
| `plugins/_official/examples/od-plugin-publish-github/SKILL.md` | `plugins/_official/examples/pixo-plugin-publish-github/SKILL.md` |
| `plugins/_official/examples/od-plugin-publish-github/pixo.json` | `plugins/_official/examples/pixo-plugin-publish-github/pixo.json` |
| `plugins/_official/scenarios/od-code-migration/SKILL.md` | `plugins/_official/scenarios/pixo-code-migration/SKILL.md` |
| `plugins/_official/scenarios/od-code-migration/examples/jquery-to-react.html` | `plugins/_official/scenarios/pixo-code-migration/examples/jquery-to-react.html` |
| `plugins/_official/scenarios/od-code-migration/pixo.json` | `plugins/_official/scenarios/pixo-code-migration/pixo.json` |
| `plugins/_official/scenarios/od-default/SKILL.md` | `plugins/_official/scenarios/pixo-default/SKILL.md` |
| `plugins/_official/scenarios/od-default/pixo.json` | `plugins/_official/scenarios/pixo-default/pixo.json` |
| `plugins/_official/scenarios/od-design-refine/SKILL.md` | `plugins/_official/scenarios/pixo-design-refine/SKILL.md` |
| `plugins/_official/scenarios/od-design-refine/pixo.json` | `plugins/_official/scenarios/pixo-design-refine/pixo.json` |
| `plugins/_official/scenarios/od-media-generation/SKILL.md` | `plugins/_official/scenarios/pixo-media-generation/SKILL.md` |
| `plugins/_official/scenarios/od-media-generation/pixo.json` | `plugins/_official/scenarios/pixo-media-generation/pixo.json` |
| `plugins/_official/scenarios/od-new-generation/SKILL.md` | `plugins/_official/scenarios/pixo-new-generation/SKILL.md` |
| `plugins/_official/scenarios/od-new-generation/examples/saas-landing.html` | `plugins/_official/scenarios/pixo-new-generation/examples/saas-landing.html` |
| `plugins/_official/scenarios/od-new-generation/pixo.json` | `plugins/_official/scenarios/pixo-new-generation/pixo.json` |
| `plugins/_official/scenarios/od-nextjs-export/SKILL.md` | `plugins/_official/scenarios/pixo-nextjs-export/SKILL.md` |
| `plugins/_official/scenarios/od-nextjs-export/pixo.json` | `plugins/_official/scenarios/pixo-nextjs-export/pixo.json` |
| `plugins/_official/scenarios/od-plugin-authoring/SKILL.md` | `plugins/_official/scenarios/pixo-plugin-authoring/SKILL.md` |
| `plugins/_official/scenarios/od-plugin-authoring/pixo.json` | `plugins/_official/scenarios/pixo-plugin-authoring/pixo.json` |
| `plugins/_official/scenarios/od-react-export/SKILL.md` | `plugins/_official/scenarios/pixo-react-export/SKILL.md` |
| `plugins/_official/scenarios/od-react-export/pixo.json` | `plugins/_official/scenarios/pixo-react-export/pixo.json` |
| `plugins/_official/scenarios/od-share-to-community/SKILL.md` | `plugins/_official/scenarios/pixo-share-to-community/SKILL.md` |
| `plugins/_official/scenarios/od-share-to-community/pixo.json` | `plugins/_official/scenarios/pixo-share-to-community/pixo.json` |
| `plugins/_official/scenarios/od-tune-collab/SKILL.md` | `plugins/_official/scenarios/pixo-tune-collab/SKILL.md` |
| `plugins/_official/scenarios/od-tune-collab/examples/hero-tune.html` | `plugins/_official/scenarios/pixo-tune-collab/examples/hero-tune.html` |
| `plugins/_official/scenarios/od-tune-collab/pixo.json` | `plugins/_official/scenarios/pixo-tune-collab/pixo.json` |
| `plugins/_official/scenarios/od-vue-export/SKILL.md` | `plugins/_official/scenarios/pixo-vue-export/SKILL.md` |
| `plugins/_official/scenarios/od-vue-export/pixo.json` | `plugins/_official/scenarios/pixo-vue-export/pixo.json` |
| `plugins/_official/scenarios/od-web-effect-extractor/SKILL.md` | `plugins/_official/scenarios/pixo-web-effect-extractor/SKILL.md` |
| `plugins/_official/scenarios/od-web-effect-extractor/pixo.json` | `plugins/_official/scenarios/pixo-web-effect-extractor/pixo.json` |
| `plugins/open-design/.claude-plugin/plugin.json` | `plugins/openpixo/.claude-plugin/plugin.json` |
| `plugins/open-design/.mcp.json` | `plugins/openpixo/.mcp.json` |
| `plugins/registry/community/open-design-marketplace.json` | `plugins/registry/community/openpixo-marketplace.json` |
| `plugins/registry/official/open-design-marketplace.json` | `plugins/registry/official/openpixo-marketplace.json` |
| `plugins/spec/examples/open-design-marketplace.json` | `plugins/spec/examples/openpixo-marketplace.json` |
| `plugins/spec/templates/open-design.template.json` | `plugins/spec/templates/openpixo.template.json` |
| `skills/web-clone/scripts/od-preview-rewrite.mjs` | `skills/web-clone/scripts/pixo-preview-rewrite.mjs` |
| `specs/change/20260622-open-design-account-avatar/spec.md` | `specs/change/20260622-openpixo-account-avatar/spec.md` |
| `specs/current/remove-opendesign-traces.md` | `specs/current/remove-upstream-traces.md` |
| `specs/od-clipper.md` | `specs/pixo-clipper.md` |
| `tools/pack/resources/linux/open-design.desktop.template` | `tools/pack/resources/linux/openpixo.desktop.template` |

Plugin ID mapping: [full move/reference plan](../../.tmp/phase5-work/path-plan.json). Historical ADR/report bodies and provenance remain; only actual links to renamed paths were adjusted there. Third-party LICENSE files remain unchanged.

## Visual evidence

Headless Chromium used repository-local persistent profiles, 1440×1000 viewport, DPR 1, fixed locale/time/timezone, reduced motion, local-only requests and recorded mock data. Each cycle captured home, an imported-game project, General Settings, and the conversation panel under both light/dark media preferences. **The application forces the light theme in both preferences at the baseline and final commits**; manifests record this rather than claiming a distinct dark palette.

The baseline runs the detached `8fc76fd6` checkout, with its own orchestration namespace. Baseline and current visual daemons use the same isolated fixture data sequentially, never concurrently. The final fresh conversation uses a separate namespace and explicit `PIXO_DATA_DIR`. Runtime isolation follows [the root data-directory contract](../../AGENTS.md#daemon-data-directory-contract).

Initial visual attempts exposed harness readiness races: collapsed navigation, rotating placeholders, delayed General Settings, hover popovers, and selector assumptions. They were corrected by waiting for actual surfaces, using the same fixed unsent draft in both versions, and moving the pointer off interactive content. No screenshot regions were masked. Earlier failed captures/diffs remain in the ledger.

- After CSS: [diff summary](../../.tmp/phase5-visual/after-css-controlled/diff-summary.json) against [8fc76fd6 screenshots](../../.tmp/phase5-visual/before-controlled): eight zero-perceptible diffs, matching computed styles; 10 subthreshold pixels in home light.
- At completion: [final diff summary](../../.tmp/phase5-visual/final-controlled/diff-summary.json) against [8fc76fd6 controlled screenshots](../../.tmp/phase5-visual/before-final): eight zero-perceptible diffs, matching computed styles; four subthreshold pixels in Settings dark. [Final screenshots](../../.tmp/phase5-visual/final-controlled) and [diff images](../../.tmp/phase5-visual/final-controlled/diff).

| Surface | Baseline light | Final light | Baseline dark media | Final dark media |
|---|---|---|---|---|
| home | [before](../../.tmp/phase5-visual/before-final/home-light.png) | [after](../../.tmp/phase5-visual/final-controlled/home-light.png) | [before](../../.tmp/phase5-visual/before-final/home-dark.png) | [after](../../.tmp/phase5-visual/final-controlled/home-dark.png) |
| project | [before](../../.tmp/phase5-visual/before-final/project-light.png) | [after](../../.tmp/phase5-visual/final-controlled/project-light.png) | [before](../../.tmp/phase5-visual/before-final/project-dark.png) | [after](../../.tmp/phase5-visual/final-controlled/project-dark.png) |
| settings | [before](../../.tmp/phase5-visual/before-final/settings-light.png) | [after](../../.tmp/phase5-visual/final-controlled/settings-light.png) | [before](../../.tmp/phase5-visual/before-final/settings-dark.png) | [after](../../.tmp/phase5-visual/final-controlled/settings-dark.png) |
| chat | [before](../../.tmp/phase5-visual/before-final/chat-light.png) | [after](../../.tmp/phase5-visual/final-controlled/chat-light.png) | [before](../../.tmp/phase5-visual/before-final/chat-dark.png) | [after](../../.tmp/phase5-visual/final-controlled/chat-dark.png) |

## Verification results and baseline exceptions

All requested builds passed: daemon, web, desktop, packaged, tools-dev, tools-pack and components. Shared consumed dist outputs were rebuilt through package builds and `pnpm install --config.confirmModulesPurge=false`. The final `pixo --help` passes. Focused tests cover chat/card parsing and rendering, previews/iframe/edit bridges, CSS, contracts, plugins/catalogs/install paths, media prompt files, artifact syntax/cover processing, diagnostics, download, desktop/packaged launchers, cache/resources/installer generation, release/site/fixture services and source guards. The full daemon and web suites were never run.

The imported-game E2E passes (native Codex fixture, approvals, independent sessions, project extensions, asset preservation). Its task-only scratch-root override was restored immediately afterward. [E2E evidence](../../.tmp/phase5-game-e2e). A fresh imported-game mock run succeeds with two tool-use events and receipts proving events stay under the configured data root. [Fresh mock receipt](../../.tmp/phase5-mock-final/evidence.json), [run events](../../.tmp/phase5-mock-final/mock-events.txt), [mock CLI invocations](../../.tmp/phase5-mock-final/mock-invocations.jsonl). The mock adapter forwards only to `mocks/mock-agent.mjs`; no live model/provider tests ran.

Failures are not silently treated as passes:

| Issue | Baseline evidence | Resolution / final result |
|---|---|---|
| Windows directory symlink privilege | `paths-symlink-baseline` fails with the same EPERM at 8fc76fd6 | Known Phase 4 exception; case remains unmodified and excluded explicitly from the 94-pass focused launcher group |
| Stylesheet literal-LF assertions on CRLF checkout | `css-styles-baseline` reproduces the same two tests | Task-only CSS read preload; 84 pass; product source unchanged |
| Motion fixture HTML/Three.js line endings | `paths-motion-baseline`, then `paths-motion-baseline-html-eol` reproduce both assertions | Unmodified vendored source/gzip normalize identically to baseline; task-only EOL read preload gives 27/27 resource checks. [Byte/EOL proof](../../.tmp/phase5-work/vendor-proof.json) |
| GNU tar treats C: as a remote host | `paths-catalog-tar-baseline` reproduces `Cannot connect to C` at 8fc76fd6 | Task-local `TAR_OPTIONS=--force-local` gives 53/53 release/catalog tests; no global config edit |
| Removed landing-deck test expectations | Baseline two failing cases recorded before deletion | Removed with obsolete landing-only tests; retained generic tests pass |
| Stale plugin-runtime dist during CSS validation | Initial runtime import failed after a partial rebuild | Rebuilt all dependency-ordered shared packages, then daemon/web; subsequent visual/mock runs pass |
| Harness command/selector mistakes | Failed attempts retained below | Corrected test paths, tools-dev's Node test runner, ESM loading, readiness selectors, dynamic class prefix and canonical fixture hashes; all affected checks rerun |

Other Phase 4 Windows exceptions were not waived into a pass; only actually encountered cases above apply here. The task-only preloads, tar option and scratch overrides were absent from the NSIS build's normal user environment.

## Packaging

Exact command: `pnpm tools-pack win build --to nsis --namespace p5 --dir .tmp/phase5-pack --cache-dir .tmp/phase5-pack-cache --json`. Normal HOME/USERPROFILE/LOCALAPPDATA; only the pinned local toolchain is prepended to PATH. **Build only**: no installation, uninstall, installed-build launch, protocol/registry write or interaction with Alpha.3.

[NSIS build log](../../.tmp/phase5-work/final-nsis-build.log). [Packaged-output identity/layout proof](../../.tmp/phase5-work/packaged-output-proof.json)

Build completed in 581.561 seconds. Installer: [OpenPixo-p5-setup.exe](../../.tmp/phase5-pack/out/win/namespaces/p5/builder/OpenPixo-p5-setup.exe) (352007017 bytes), SHA-256 `80a96b9855478c57e9af3277003da91be008794d14a7b0a850f1f1bf6a6944ed`. App/config version `0.1.0-alpha.2`, namespace `p5`. [Artifact receipt](../../.tmp/phase5-work/installer-artifact.json). Makensis returned 0 with two template warnings: 6155 (undefined `MUI_PAGE_CUSTOMFUNCTION_LEAVE`) and 6012 (unused `cancel_install` label).

## Final search and deliberate remaining content

Source-code checkpoint `b5fb9677`: AST old identifiers 0; retained old CSS classes 0; old custom properties 0; tracked old-name paths 0. Exact per-hit output and reasons: [TSV](../../.tmp/phase5-work/final-search.tsv) / [JSON](../../.tmp/phase5-work/final-search.json). These include docs/specs and legal/historical material; the narrower count table excludes those. This new report is migration evidence and necessarily quotes old names.

- **odLower:** 11 files / 21 lines; 19 embedded binary/base64 false positive; 2 historical phase report (§2); 12 migration source or phase evidence; 2 documentation/prose left for phase 6; 1 package integrity checksum false positive.
- **odUpper:** 12 files / 25 lines; 2 verbatim external CLI/recorded fixture (§2); 22 embedded binary/base64 false positive; 7 historical phase report (§2); 11 migration source or phase evidence; 1 package integrity checksum false positive.
- **constants:** 7 files / 145 lines; 3 historical ADR body (§2); 169 historical phase report (§2); 15 migration source or phase evidence.
- **brand:** 891 files / 3492 lines; 1792 prose/UI text, external name or string fixture (phase 6); 1553 documentation/prose left for phase 6; 11 required attribution/provenance (§2); 159 comment left for phase 6; 21 verbatim external CLI/recorded fixture (§2); 1 external URL/API name (phase 6); 8 historical ADR body (§2); 48 historical phase report (§2); 186 migration source or phase evidence.
- **css:** 259 files / 1697 lines; 4 external GitHub runner-label API name; not CSS; 18 comment left for phase 6; 16 legacy artifact exclusion rule; not a retained runtime alias or CSS; 235 documentation/prose left for phase 6; 4 log prose left for phase 6; 448 substring in another word (not a CSS class); 2 CSS layer name in sanitized syntax fixture; not a class or custom property; 913 verbatim external CLI/recorded fixture (§2); 18 external URL/API name (phase 6); 2 localStorage value in a template; not a CSS class or property; 351 historical phase report (§2); 234 migration source or phase evidence; 4 Docker volume name in retained deployment fixture; not CSS.
- **variables:** 1 files / 1 lines; 1 historical phase report (§2).

Every remaining class-candidate hit was classified: external runner labels, legacy artifact ignore/exclusion rules, log prose, Docker volume identifiers, the sanitized fixture's CSS layer name, a template's localStorage value, substrings in words such as method/period, external URLs, or protected/historical text. None is a retained product CSS class or variable. Base64 assets and lockfile integrity checksums explain the remaining source-like camel-case hits. No pending/unclassified hits remain in the search artifact.

The preservation proof checks 135 protected files (normalized checkout EOLs) and all 38 locale string-value lists. LICENSE SHA-256 `5af3e43224f112bc45788d510afd3e1c0eec60bbc54e9a95b9171e54d750f4b0`; NOTICE `9657ac9b8cf69d7e0457aafcc9d7f3858d38d2599830ce0a6c274a6a5c061dab`. [Preservation receipt](../../.tmp/phase5-work/preservation-proof.json).

The embedded-script audit parsed 214 scripts from 1,076 retained HTML/Markdown files and found no old identifiers. [Embedded-script audit](../../.tmp/phase5-work/markup-audit.json). Empty command logs indicate no stdout/stderr; exit status remains recorded in the ledger. The documentation checkpoint also corrects the current cache contract's executable filename.

## Write/process boundary

**No Phase 5 boundary violation was observed.** Scratch, browser profiles, isolated orchestration and packaging output/cache stay under task-prefixed repository scratch. Tooling-created OS temporary files and normal package/builder caches use the owner's permitted exceptions. No global install or configuration change occurred. Electron desktop was never launched. Only task-owned namespaces/processes were stopped; Alpha.3 and its OS registration remain untouched. The detached baseline worktree and high-value evidence are retained under ignored task scratch.

## Command ledger

Every build/check/test/runtime invocation, including failures and intermediate attempts, is listed below. Identical labels can have multiple timestamped runs; their append-only logs retain each result. Ordinary file reads/searches are audit work; Git mutations are the six commits above. One discarded inline Node token-audit command failed because PowerShell removed quotes; the file-backed `paths-token-audit` rerun passed. [Machine-readable ledger](../../.tmp/phase5-work/commands.jsonl). Task-only environment qualifications are documented above.

| # | Label | Result | Seconds | Command | Log |
|---:|---|---|---:|---|---|
| 1 | baseline-typecheck | PASS | 13.851 | `pnpm typecheck` | [log](../../.tmp/phase5-work/baseline-typecheck.log) |
| 2 | baseline-guard | PASS | 14.521 | `pnpm guard` | [log](../../.tmp/phase5-work/baseline-guard.log) |
| 3 | baseline-web-build | PASS | 24.497 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase5-work/baseline-web-build.log) |
| 4 | visual-start | PASS | 7.254 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root .tmp/phase5-visual/orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 5 | baseline-runtime | PASS | 10.191 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/baseline-runtime.log) |
| 6 | baseline-capture | FAIL 1 | 33.074 | `node .tmp/phase5-work/capture.ts before` | [log](../../.tmp/phase5-work/baseline-capture.log) |
| 7 | baseline-capture-fixed | PASS | 25.147 | `node .tmp/phase5-work/capture.ts before` | [log](../../.tmp/phase5-work/baseline-capture-fixed.log) |
| 8 | visual-stop | PASS | 12.204 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root .tmp/phase5-visual/orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 9 | baseline-runtime-stop | PASS | 12.417 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/baseline-runtime-stop.log) |
| 10 | delete-contribute-typecheck | PASS | 12.396 | `pnpm typecheck` | [log](../../.tmp/phase5-work/delete-contribute-typecheck.log) |
| 11 | delete-contribute-guard | PASS | 13.344 | `pnpm guard` | [log](../../.tmp/phase5-work/delete-contribute-guard.log) |
| 12 | delete-helm-guard | PASS | 15.95 | `pnpm guard` | [log](../../.tmp/phase5-work/delete-helm-guard.log) |
| 13 | delete-helm-typecheck | PASS | 16.071 | `pnpm typecheck` | [log](../../.tmp/phase5-work/delete-helm-typecheck.log) |
| 14 | landing-baseline-deck | FAIL 1 | 40.633 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-route.test.ts -t "propagates the composed skill mode\|preserves a persisted media skill\|canonicalizes aliased skill"` | [log](../../.tmp/phase5-work/landing-baseline-deck.log) |
| 15 | delete-landing-edit | PASS | 0.256 | `node .tmp/phase5-work/delete-landing.ts` | [log](../../.tmp/phase5-work/delete-landing-edit.log) |
| 16 | delete-landing-daemon-build | PASS | 2.477 | `pnpm --filter @openpixo/daemon build` | [log](../../.tmp/phase5-work/delete-landing-daemon-build.log) |
| 17 | delete-landing-web | FAIL 1 | 9.071 | `pnpm --filter @openpixo/web exec vitest run tests/components/ExamplesTab.test.tsx tests/components/plugins-home-visualScore.test.ts tests/plugins-home/pluginPopularity.test.ts` | [log](../../.tmp/phase5-work/delete-landing-web.log) |
| 18 | delete-landing-guard | PASS | 15.632 | `pnpm guard` | [log](../../.tmp/phase5-work/delete-landing-guard.log) |
| 19 | delete-landing-typecheck | PASS | 16.377 | `pnpm typecheck` | [log](../../.tmp/phase5-work/delete-landing-typecheck.log) |
| 20 | delete-landing-daemon | PASS | 22.521 | `pnpm --filter @openpixo/daemon exec vitest run tests/skill-id-aliases.test.ts tests/project-skill-id-validation.test.ts tests/routes/skill-asset-rewrite.test.ts tests/prompts/discovery-localization-drift.test.ts tests/skills.test.ts` | [log](../../.tmp/phase5-work/delete-landing-daemon.log) |
| 21 | delete-landing-web-fixed | FAIL 1 | 6.309 | `pnpm --filter @openpixo/web exec vitest run tests/components/ExamplesTab.test.tsx tests/components/plugins-home-visualScore.test.ts tests/plugins-home/pluginPopularity.test.ts` | [log](../../.tmp/phase5-work/delete-landing-web-fixed.log) |
| 22 | delete-landing-web-final | PASS | 7.741 | `pnpm --filter @openpixo/web exec vitest run tests/components/ExamplesTab.test.tsx tests/components/plugins-home-visualScore.test.ts tests/plugins-home/pluginPopularity.test.ts` | [log](../../.tmp/phase5-work/delete-landing-web-final.log) |
| 23 | delete-landing-critique | FAIL 1 | 17.238 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-project-skill-critique-label.test.ts` | [log](../../.tmp/phase5-work/delete-landing-critique.log) |
| 24 | delete-landing-chat | FAIL 1 | 22.266 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-route.test.ts -t "canonicalizes aliased skill"` | [log](../../.tmp/phase5-work/delete-landing-chat.log) |
| 25 | delete-landing-critique-baseline | FAIL 1 | 15.125 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-project-skill-critique-label.test.ts` | [log](../../.tmp/phase5-work/delete-landing-critique-baseline.log) |
| 26 | delete-landing-critique-fixed | PASS | 18.572 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-project-skill-critique-label.test.ts` | [log](../../.tmp/phase5-work/delete-landing-critique-fixed.log) |
| 27 | delete-landing-chat-fixed | PASS | 22.821 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-route.test.ts -t "canonicalizes aliased skill"` | [log](../../.tmp/phase5-work/delete-landing-chat-fixed.log) |
| 28 | delete-landing-web-build | PASS | 25.041 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase5-work/delete-landing-web-build.log) |
| 29 | delete-landing-final-typecheck | PASS | 13.098 | `pnpm typecheck` | [log](../../.tmp/phase5-work/delete-landing-final-typecheck.log) |
| 30 | delete-landing-final-guard | PASS | 13.535 | `pnpm guard` | [log](../../.tmp/phase5-work/delete-landing-final-guard.log) |
| 31 | identifiers-edit | PASS | 7.364 | `node .tmp/phase5-work/rename-identifiers.ts --apply` | [log](../../.tmp/phase5-work/identifiers-edit.log) |
| 32 | identifiers-embedded-edit | PASS | 6.799 | `node .tmp/phase5-work/rename-identifiers.ts --apply` | [log](../../.tmp/phase5-work/identifiers-embedded-edit.log) |
| 33 | identifiers-keys-edit | PASS | 7.309 | `node .tmp/phase5-work/rename-identifiers.ts --apply` | [log](../../.tmp/phase5-work/identifiers-keys-edit.log) |
| 34 | identifiers-shared-build | PASS | 1.613 | `pnpm --filter @openpixo/contracts --filter @openpixo/host --filter @openpixo/agui-adapter --filter @openpixo/dsh-runtime --filter @openpixo/sidecar-proto --filter @openpixo/sidecar --filter @openpixo/components run build` | [log](../../.tmp/phase5-work/identifiers-shared-build.log) |
| 35 | identifiers-tools-build | PASS | 1.07 | `pnpm --filter @openpixo/tools-dev --filter @openpixo/tools-pack run build` | [log](../../.tmp/phase5-work/identifiers-tools-build.log) |
| 36 | identifiers-host-tests | PASS | 1.399 | `pnpm --filter @openpixo/host exec vitest run` | [log](../../.tmp/phase5-work/identifiers-host-tests.log) |
| 37 | identifiers-daemon-build | PASS | 3.136 | `pnpm --filter @openpixo/daemon build` | [log](../../.tmp/phase5-work/identifiers-daemon-build.log) |
| 38 | identifiers-contracts-tests | PASS | 3.68 | `pnpm --filter @openpixo/contracts exec vitest run tests/brief.test.ts tests/undesigned-cards.test.ts tests/runtime/deck-protocol.test.ts tests/runtime/deck-stage-fallback.test.ts tests/done-marker.test.ts tests/next-step-marker.test.ts` | [log](../../.tmp/phase5-work/identifiers-contracts-tests.log) |
| 39 | identifiers-typecheck | PASS | 15.019 | `pnpm typecheck` | [log](../../.tmp/phase5-work/identifiers-typecheck.log) |
| 40 | identifiers-guard | PASS | 15.207 | `pnpm guard` | [log](../../.tmp/phase5-work/identifiers-guard.log) |
| 41 | identifiers-dev-focused | PASS | 0.566 | `pnpm --filter @openpixo/tools-dev exec node --import tsx --test tests/config.test.ts tests/diagnostics.test.ts` | [log](../../.tmp/phase5-work/identifiers-dev-focused.log) |
| 42 | identifiers-packaged-focused | PASS | 2.789 | `pnpm --filter @openpixo/packaged exec vitest run tests/protocol.test.ts tests/desktop-url-allowlist.test.ts tests/config.test.ts` | [log](../../.tmp/phase5-work/identifiers-packaged-focused.log) |
| 43 | identifiers-desktop-focused | PASS | 3.28 | `pnpm --filter @openpixo/desktop exec vitest run tests/main/preload-host-boundary.test.ts tests/main/startup-timing.test.ts tests/main/mailto-open.test.ts` | [log](../../.tmp/phase5-work/identifiers-desktop-focused.log) |
| 44 | identifiers-contracts-final | PASS | 3.547 | `pnpm --filter @openpixo/contracts exec vitest run tests/deck-protocol.test.ts tests/deck-stage-fallback.test.ts tests/artifact-focus-marker.test.ts tests/brief.test.ts tests/undesigned-cards.test.ts tests/openpixo-game-prompt.test.ts` | [log](../../.tmp/phase5-work/identifiers-contracts-final.log) |
| 45 | identifiers-pack-focused | PASS | 3.947 | `pnpm --filter @openpixo/tools-pack exec vitest run tests/win-nsis.test.ts tests/win-identity.test.ts tests/linux.test.ts tests/mac.test.ts` | [log](../../.tmp/phase5-work/identifiers-pack-focused.log) |
| 46 | identifiers-web-focused | PASS | 8.387 | `pnpm --filter @openpixo/web exec vitest run tests/host-boundary.test.ts tests/i18n/locales.test.ts tests/state/appearance.test.ts tests/components/OdCard.test.tsx tests/runtime/react-component.test.ts tests/runtime/srcdoc.test.ts tests/runtime/exports.test.ts tests/components/EntryNavRail.updater-after-avatar.test.tsx` | [log](../../.tmp/phase5-work/identifiers-web-focused.log) |
| 47 | identifiers-daemon-focused | PASS | 8.393 | `pnpm --filter @openpixo/daemon exec vitest run tests/memory-verify.test.ts tests/next-step-marker.test.ts tests/done-marker-protocol.test.ts tests/mcp-brief-app.test.ts tests/services/openpixo-network-defaults.test.ts tests/runtimes/executables.test.ts tests/agent-protocol/dsh-profile.test.ts tests/langfuse-env.test.ts` | [log](../../.tmp/phase5-work/identifiers-daemon-focused.log) |
| 48 | identifiers-packaged-build | PASS | 0.693 | `pnpm --filter @openpixo/packaged build` | [log](../../.tmp/phase5-work/identifiers-packaged-build.log) |
| 49 | identifiers-adapters-tests | PASS | 1.22 | `pnpm --filter @openpixo/agui-adapter --filter @openpixo/dsh-runtime exec vitest run` | [log](../../.tmp/phase5-work/identifiers-adapters-tests.log) |
| 50 | identifiers-release-tests | PASS | 4.292 | `pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts tests/prerelease-card-delivery-signal.test.ts` | [log](../../.tmp/phase5-work/identifiers-release-tests.log) |
| 51 | identifiers-web-build | PASS | 24.137 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase5-work/identifiers-web-build.log) |
| 52 | identifiers-preservation | FAIL 1 | 4.282 | `node .tmp/phase5-work/proof.ts` | [log](../../.tmp/phase5-work/identifiers-preservation.log) |
| 53 | identifiers-preservation-fixed | PASS | 4.037 | `node .tmp/phase5-work/proof.ts` | [log](../../.tmp/phase5-work/identifiers-preservation-fixed.log) |
| 54 | css-edit | PASS | 1.022 | `node .tmp/phase5-work/rename-css.ts --apply` | [log](../../.tmp/phase5-work/css-edit.log) |
| 55 | css-shared-build | PASS | 1.047 | `pnpm --filter @openpixo/components --filter @openpixo/contracts run build` | [log](../../.tmp/phase5-work/css-shared-build.log) |
| 56 | css-contracts-tests | PASS | 1.313 | `pnpm --filter @openpixo/contracts exec vitest run tests/deck-stage-fallback.test.ts tests/analytics/client-observability.test.ts` | [log](../../.tmp/phase5-work/css-contracts-tests.log) |
| 57 | css-daemon-build | PASS | 4.267 | `pnpm --filter @openpixo/daemon build` | [log](../../.tmp/phase5-work/css-daemon-build.log) |
| 58 | css-web-tests | PASS | 7.916 | `pnpm --filter @openpixo/web exec vitest run tests/components/Tooltip.test.tsx tests/components/Toast.test.tsx tests/components/SketchEditor.save.test.tsx tests/components/GenUISurfaceRenderer.test.tsx tests/components/SelectField.test.tsx tests/runtime/srcdoc.test.ts tests/runtime/srcdoc-deck-bridge-framework-deck.test.ts tests/runtime/srcdoc-deck-bridge-deck-stage-api.test.ts` | [log](../../.tmp/phase5-work/css-web-tests.log) |
| 59 | css-guard | PASS | 17.039 | `pnpm guard` | [log](../../.tmp/phase5-work/css-guard.log) |
| 60 | css-typecheck | PASS | 18.609 | `pnpm typecheck` | [log](../../.tmp/phase5-work/css-typecheck.log) |
| 61 | css-web-build | PASS | 26.109 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase5-work/css-web-build.log) |
| 62 | visual-start | FAIL 1 | 8.299 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root .tmp/phase5-visual/orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 63 | css-runtime | FAIL 1 | 8.477 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/css-runtime.log) |
| 64 | visual-stop | PASS | 10.637 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root .tmp/phase5-visual/orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 65 | css-runtime-failed-stop | PASS | 10.813 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/css-runtime-failed-stop.log) |
| 66 | css-package-closure-build | PASS | 2.464 | `pnpm -r --filter ./packages/* --if-present run build` | [log](../../.tmp/phase5-work/css-package-closure-build.log) |
| 67 | visual-start | PASS | 8.217 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root .tmp/phase5-visual/orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 68 | css-runtime-rebuilt | PASS | 8.476 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/css-runtime-rebuilt.log) |
| 69 | css-capture | PASS | 25.559 | `node .tmp/phase5-work/capture.ts after-css` | [log](../../.tmp/phase5-work/css-capture.log) |
| 70 | css-diff | FAIL 1 | 0.365 | `node .tmp/phase5-work/diff.ts after-css` | [log](../../.tmp/phase5-work/css-diff.log) |
| 71 | css-diff-fixed | FAIL 1 | 1.375 | `node .tmp/phase5-work/diff.ts after-css` | [log](../../.tmp/phase5-work/css-diff-fixed.log) |
| 72 | visual-base-install | PASS | 53.237 | `pnpm --dir .tmp/phase5-baseline install --offline --config.confirmModulesPurge=false` | [log](../../.tmp/phase5-work/visual-base-install.log) |
| 73 | visual-stop | PASS | 17.685 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 74 | css-runtime-stop | PASS | 17.859 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/css-runtime-stop.log) |
| 75 | visual-base-web-build | PASS | 18.58 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/web build` | [log](../../.tmp/phase5-work/visual-base-web-build.log) |
| 76 | visual-start | PASS | 25.265 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 77 | visual-base-runtime | PASS | 25.48 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-base-runtime.log) |
| 78 | visual-base-capture-stable | PASS | 18.092 | `node .tmp/phase5-work/capture.ts before-stable` | [log](../../.tmp/phase5-work/visual-base-capture-stable.log) |
| 79 | css-component-tests | PASS | 2.029 | `pnpm --filter @openpixo/components exec vitest run tests/Dialog.test.tsx tests/Button.test.tsx` | [log](../../.tmp/phase5-work/css-component-tests.log) |
| 80 | visual-stop | PASS | 17.15 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 81 | visual-base-stop | PASS | 17.338 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-base-stop.log) |
| 82 | visual-start | PASS | 11.242 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 83 | css-runtime-stable | PASS | 11.487 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/css-runtime-stable.log) |
| 84 | css-syntax-fixture | FAIL 1 | 2.238 | `pnpm --filter @openpixo/daemon exec vitest run tests/artifacts/deliverable-syntax-quotes.test.ts` | [log](../../.tmp/phase5-work/css-syntax-fixture.log) |
| 85 | css-styles-tests | FAIL 1 | 5.072 | `pnpm --filter @openpixo/web exec vitest run tests/styles/sketch-help-modal.test.ts tests/styles/settings-polish.test.ts tests/styles/w126-tooltip-design-parity.test.ts tests/components/TooltipLayer.test.tsx tests/components/MarqueeLabel.test.tsx tests/observability/white-screen.test.ts tests/edit-mode/bridge.test.ts` | [log](../../.tmp/phase5-work/css-styles-tests.log) |
| 86 | css-capture-stable | PASS | 26.518 | `node .tmp/phase5-work/capture.ts after-css-stable` | [log](../../.tmp/phase5-work/css-capture-stable.log) |
| 87 | css-diff-stable | FAIL 1 | 1.381 | `node .tmp/phase5-work/diff.ts after-css-stable before-stable` | [log](../../.tmp/phase5-work/css-diff-stable.log) |
| 88 | css-styles-baseline | FAIL 1 | 2.062 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/web exec vitest run tests/styles/sketch-help-modal.test.ts tests/styles/settings-polish.test.ts` | [log](../../.tmp/phase5-work/css-styles-baseline.log) |
| 89 | css-syntax-fixed | PASS | 3.667 | `pnpm --filter @openpixo/daemon exec vitest run tests/artifacts/deliverable-syntax-quotes.test.ts` | [log](../../.tmp/phase5-work/css-syntax-fixed.log) |
| 90 | css-final-typecheck | PASS | 15.157 | `pnpm typecheck` | [log](../../.tmp/phase5-work/css-final-typecheck.log) |
| 91 | css-final-guard | PASS | 15.873 | `pnpm guard` | [log](../../.tmp/phase5-work/css-final-guard.log) |
| 92 | css-styles-eol | PASS | 5.7 | `pnpm --filter @openpixo/web exec vitest run tests/styles/sketch-help-modal.test.ts tests/styles/settings-polish.test.ts tests/styles/w126-tooltip-design-parity.test.ts tests/components/TooltipLayer.test.tsx tests/components/MarqueeLabel.test.tsx tests/observability/white-screen.test.ts tests/edit-mode/bridge.test.ts` | [log](../../.tmp/phase5-work/css-styles-eol.log) |
| 93 | css-web-rebuilt | PASS | 25.384 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase5-work/css-web-rebuilt.log) |
| 94 | visual-stop | PASS | 16.394 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 95 | visual-controlled-stop-main | PASS | 16.57 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-controlled-stop-main.log) |
| 96 | visual-start | PASS | 7.976 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 97 | visual-controlled-start-base | PASS | 8.236 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-controlled-start-base.log) |
| 98 | visual-controlled-capture-base | FAIL 1 | 33.831 | `node .tmp/phase5-work/capture.ts before-controlled` | [log](../../.tmp/phase5-work/visual-controlled-capture-base.log) |
| 99 | css-cascade-proof | PASS | 0.65 | `node .tmp/phase5-work/css-proof.ts` | [log](../../.tmp/phase5-work/css-cascade-proof.log) |
| 100 | visual-stop | PASS | 15.112 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 101 | visual-controlled-stop-base | PASS | 15.288 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-controlled-stop-base.log) |
| 102 | visual-controlled-cycle | FAIL 1 | 74.281 | `node .tmp/phase5-work/visual-cycle.ts` | [log](../../.tmp/phase5-work/visual-controlled-cycle.log) |
| 103 | visual-stop | PASS | 10.302 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 104 | visual-controlled-stop-main | PASS | 10.459 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-controlled-stop-main.log) |
| 105 | visual-start | PASS | 7.8 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 106 | visual-controlled-start-base | PASS | 8.055 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-controlled-start-base.log) |
| 107 | visual-controlled-capture-base | PASS | 18.413 | `node .tmp/phase5-work/capture.ts before-controlled` | [log](../../.tmp/phase5-work/visual-controlled-capture-base.log) |
| 108 | visual-stop | PASS | 14.881 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 109 | visual-controlled-stop-base | PASS | 15.087 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-controlled-stop-base.log) |
| 110 | visual-start | PASS | 7.95 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 111 | visual-controlled-start-main | PASS | 8.181 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/visual-controlled-start-main.log) |
| 112 | visual-controlled-capture-css | PASS | 17.642 | `node .tmp/phase5-work/capture.ts after-css-controlled` | [log](../../.tmp/phase5-work/visual-controlled-capture-css.log) |
| 113 | visual-controlled-diff | FAIL 1 | 1.445 | `node .tmp/phase5-work/diff.ts after-css-controlled before-controlled` | [log](../../.tmp/phase5-work/visual-controlled-diff.log) |
| 114 | visual-controlled-cycle-fixed | FAIL 1 | 79.844 | `node .tmp/phase5-work/visual-cycle.ts` | [log](../../.tmp/phase5-work/visual-controlled-cycle-fixed.log) |
| 115 | visual-stop | PASS | 15.217 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 116 | visual-settings-stop-main | PASS | 15.439 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-settings-stop-main.log) |
| 117 | visual-start | PASS | 8.369 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 118 | visual-settings-start-base | PASS | 8.6 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-settings-start-base.log) |
| 119 | visual-settings-capture-base | FAIL 1 | 33.272 | `node .tmp/phase5-work/capture.ts before-controlled settings` | [log](../../.tmp/phase5-work/visual-settings-capture-base.log) |
| 120 | visual-stop | PASS | 14.783 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 121 | visual-settings-stop-base | PASS | 14.958 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-settings-stop-base.log) |
| 122 | visual-settings-cycle | FAIL 1 | 72.642 | `node .tmp/phase5-work/visual-settings-cycle.ts` | [log](../../.tmp/phase5-work/visual-settings-cycle.log) |
| 123 | visual-stop | PASS | 10.004 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 124 | visual-settings-stop-main | PASS | 10.178 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-settings-stop-main.log) |
| 125 | visual-start | PASS | 8.145 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 126 | visual-settings-start-base | PASS | 8.393 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-settings-start-base.log) |
| 127 | visual-settings-capture-base | PASS | 7.423 | `node .tmp/phase5-work/capture.ts before-controlled settings` | [log](../../.tmp/phase5-work/visual-settings-capture-base.log) |
| 128 | visual-stop | PASS | 14.54 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 129 | visual-settings-stop-base | PASS | 14.732 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-settings-stop-base.log) |
| 130 | visual-start | PASS | 7.995 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 131 | visual-settings-start-main | PASS | 8.21 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/visual-settings-start-main.log) |
| 132 | visual-settings-capture-css | PASS | 6.558 | `node .tmp/phase5-work/capture.ts after-css-controlled settings` | [log](../../.tmp/phase5-work/visual-settings-capture-css.log) |
| 133 | visual-settings-diff | FAIL 1 | 1.354 | `node .tmp/phase5-work/diff.ts after-css-controlled before-controlled` | [log](../../.tmp/phase5-work/visual-settings-diff.log) |
| 134 | visual-settings-cycle-fixed | FAIL 1 | 57.448 | `node .tmp/phase5-work/visual-settings-cycle.ts` | [log](../../.tmp/phase5-work/visual-settings-cycle-fixed.log) |
| 135 | css-preservation | PASS | 4.258 | `node .tmp/phase5-work/proof.ts` | [log](../../.tmp/phase5-work/css-preservation.log) |
| 136 | visual-stop | PASS | 14.223 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 137 | visual-settings-stop-main | PASS | 14.432 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-settings-stop-main.log) |
| 138 | visual-start | PASS | 8.602 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 139 | visual-settings-start-base | PASS | 8.853 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-settings-start-base.log) |
| 140 | visual-settings-capture-base | PASS | 9.824 | `node .tmp/phase5-work/capture.ts before-controlled settings` | [log](../../.tmp/phase5-work/visual-settings-capture-base.log) |
| 141 | visual-stop | PASS | 14.648 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 142 | visual-settings-stop-base | PASS | 14.829 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-settings-stop-base.log) |
| 143 | visual-start | PASS | 8.064 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 144 | visual-settings-start-main | PASS | 8.343 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/visual-settings-start-main.log) |
| 145 | visual-settings-capture-css | PASS | 8.828 | `node .tmp/phase5-work/capture.ts after-css-controlled settings` | [log](../../.tmp/phase5-work/visual-settings-capture-css.log) |
| 146 | visual-settings-diff | PASS | 1.264 | `node .tmp/phase5-work/diff.ts after-css-controlled before-controlled` | [log](../../.tmp/phase5-work/visual-settings-diff.log) |
| 147 | visual-settings-ready | PASS | 66.969 | `node .tmp/phase5-work/visual-settings-cycle.ts` | [log](../../.tmp/phase5-work/visual-settings-ready.log) |
| 148 | visual-stop | PASS | 14.591 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 149 | paths-stop-before-build | PASS | 14.793 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/paths-stop-before-build.log) |
| 150 | paths-move | PASS | 7.832 | `node .tmp/phase5-work/rename-paths.ts --apply` | [log](../../.tmp/phase5-work/paths-move.log) |
| 151 | paths-generated-names | PASS | 1.249 | `node .tmp/phase5-work/file-values.ts --apply` | [log](../../.tmp/phase5-work/paths-generated-names.log) |
| 152 | paths-token-audit | PASS | 0.691 | `node .tmp/phase5-work/path-tokens.ts` | [log](../../.tmp/phase5-work/paths-token-audit.log) |
| 153 | paths-carrier-names | PASS | 0.907 | `node .tmp/phase5-work/generated-paths.ts` | [log](../../.tmp/phase5-work/paths-carrier-names.log) |
| 154 | paths-install | PASS | 13.34 | `pnpm install --config.confirmModulesPurge=false` | [log](../../.tmp/phase5-work/paths-install.log) |
| 155 | paths-guard | PASS | 12.698 | `pnpm guard` | [log](../../.tmp/phase5-work/paths-guard.log) |
| 156 | paths-build-carriers | PASS | 22.978 | `pnpm --filter @openpixo/desktop --filter @openpixo/packaged --filter @openpixo/web --workspace-concurrency=1 run build` | [log](../../.tmp/phase5-work/paths-build-carriers.log) |
| 157 | paths-typecheck | PASS | 13.216 | `pnpm typecheck` | [log](../../.tmp/phase5-work/paths-typecheck.log) |
| 158 | paths-pack-tests | FAIL 1 | 4.293 | `pnpm --filter @openpixo/tools-pack exec vitest run tests/win-builder.test.ts tests/win-resources.test.ts tests/win-custom-installer.test.ts tests/win-manifest.test.ts tests/launcher/windows/payload.test.ts tests/resources/runtime-verification.test.ts tests/resources/resources.test.ts tests/mac.test.ts tests/linux.test.ts` | [log](../../.tmp/phase5-work/paths-pack-tests.log) |
| 159 | paths-web-tests | FAIL 1 | 7.721 | `pnpm --filter @openpixo/web exec vitest run tests/components/PixoCard.test.tsx tests/components/chat/pixo-card-inside-execution-shell.test.tsx tests/components/chat/opend-2745-raw-pixo-card-leak.test.tsx tests/runtime/powered-preview.test.ts tests/runtime/speaker-notes.test.ts tests/edit-mode/source-patches.test.ts tests/edit-mode/bridge.test.ts tests/lib/whats-new.test.ts tests/utils/notifications.test.ts tests/components/ExportDiagnosticsButton.test.tsx` | [log](../../.tmp/phase5-work/paths-web-tests.log) |
| 160 | paths-pack-tests-fixed | PASS | 4.088 | `pnpm --filter @openpixo/tools-pack exec vitest run tests/win-builder.test.ts tests/win-resources.test.ts tests/win-custom-installer.test.ts tests/win-manifest.test.ts tests/launcher/windows/payload.test.ts tests/resources/runtime-verification.test.ts tests/resources/resources.test.ts tests/mac.test.ts tests/linux.test.ts` | [log](../../.tmp/phase5-work/paths-pack-tests-fixed.log) |
| 161 | paths-daemon-tests | PASS | 39.265 | `pnpm --filter @openpixo/daemon exec vitest run tests/plugins-bundled.test.ts tests/plugins-marketplaces.test.ts tests/plugins-scenario-fallback.test.ts tests/plugins-auto-surfaces.test.ts tests/plugin-github-workflow.test.ts tests/http/powered-preview-origin.test.ts tests/runtimes/claude-stream-tool-use-dedupe.test.ts tests/services/openpixo-network-defaults.test.ts tests/diagnostics-export.test.ts tests/cli-startup.test.ts` | [log](../../.tmp/phase5-work/paths-daemon-tests.log) |
| 162 | paths-contracts-tests | FAIL 1 | 0.714 | `pnpm --filter @openpixo/contracts exec vitest run tests/plugins/scenario-defaults.test.ts tests/plugins/manifest.test.ts tests/plugins/marketplace.test.ts tests/runtime/preview-isolation.test.ts` | [log](../../.tmp/phase5-work/paths-contracts-tests.log) |
| 163 | paths-plugin-runtime-tests | PASS | 1.309 | `pnpm --filter @openpixo/plugin-runtime exec vitest run tests/parsers.test.ts tests/validate.test.ts tests/scenario-pipeline.test.ts tests/pipeline-fallback.test.ts tests/adapter-agent-skill.test.ts` | [log](../../.tmp/phase5-work/paths-plugin-runtime-tests.log) |
| 164 | paths-download-tests | PASS | 2.035 | `pnpm --filter @openpixo/download exec vitest run tests/index.test.ts` | [log](../../.tmp/phase5-work/paths-download-tests.log) |
| 165 | paths-web-tests-fixed | PASS | 7.257 | `pnpm --filter @openpixo/web exec vitest run tests/components/PixoCard.test.tsx tests/components/chat/pixo-card-inside-execution-shell.test.tsx tests/components/chat/opend-2745-raw-pixo-card-leak.test.tsx tests/runtime/powered-preview.test.ts tests/runtime/speaker-notes.test.ts tests/edit-mode/source-patches.test.ts tests/edit-mode/bridge.test.ts tests/lib/whats-new.test.ts tests/utils/notifications.test.ts` | [log](../../.tmp/phase5-work/paths-web-tests-fixed.log) |
| 166 | paths-contracts-tests-fixed | PASS | 1.198 | `pnpm --filter @openpixo/contracts exec vitest run tests/scenario-defaults.test.ts tests/plugins-manifest.test.ts tests/store-marketplace.test.ts tests/plugin-url.test.ts` | [log](../../.tmp/phase5-work/paths-contracts-tests-fixed.log) |
| 167 | paths-preservation | PASS | 4.712 | `node .tmp/phase5-work/proof.ts` | [log](../../.tmp/phase5-work/paths-preservation.log) |
| 168 | paths-serve-tests | PASS | 5.718 | `pnpm --filter @openpixo/tools-serve exec vitest run tests/updater-fixture.test.ts tests/release-metadata-publish.test.ts tests/dsh-bootstrap-publish.test.ts` | [log](../../.tmp/phase5-work/paths-serve-tests.log) |
| 169 | paths-css-remaining | PASS | 0.725 | `node .tmp/phase5-work/css-remaining.ts` | [log](../../.tmp/phase5-work/paths-css-remaining.log) |
| 170 | paths-audit | PASS | 7.569 | `node .tmp/phase5-work/final-audit.ts` | [log](../../.tmp/phase5-work/paths-audit.log) |
| 171 | paths-release-tests | FAIL 1 | 89.773 | `pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts tests/catalog-export.test.ts tests/catalog-pack.test.ts tests/catalog-publish.test.ts tests/prerelease-fallback-notice-cli.test.ts` | [log](../../.tmp/phase5-work/paths-release-tests.log) |
| 172 | paths-stale-dist | PASS | 0.093 | `node .tmp/phase5-work/stale-dist.ts` | [log](../../.tmp/phase5-work/paths-stale-dist.log) |
| 173 | paths-catalog-pack-baseline | FAIL 1 | 11.038 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/tools-release exec vitest run tests/catalog-pack.test.ts -t "writes checksums"` | [log](../../.tmp/phase5-work/paths-catalog-pack-baseline.log) |
| 174 | visual-start | PASS | 8.244 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 175 | visual-final-start | PASS | 8.501 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/visual-final-start.log) |
| 176 | mock-final-start | PASS | 8.697 | `pnpm tools-dev start web --prod --namespace phase5mock --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-mock-final\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/mock-final-start.log) |
| 177 | mock-final-runtime | PASS | 11.702 | `node .tmp/phase5-work/visual-runtime.ts start --fresh` | [log](../../.tmp/phase5-work/mock-final-runtime.log) |
| 178 | game-workspace-e2e | PASS | 55.078 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/openpixo/game-workspace.test.ts` | [log](../../.tmp/phase5-work/game-workspace-e2e.log) |
| 179 | paths-game-e2e | PASS | 55.247 | `node .tmp/phase5-work/game-e2e.ts` | [log](../../.tmp/phase5-work/paths-game-e2e.log) |
| 180 | paths-release-tests-local-tar | PASS | 3.495 | `pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts tests/catalog-export.test.ts tests/catalog-pack.test.ts tests/catalog-publish.test.ts tests/prerelease-fallback-notice-cli.test.ts --testTimeout=20000` | [log](../../.tmp/phase5-work/paths-release-tests-local-tar.log) |
| 181 | paths-catalog-tar-baseline | FAIL 1 | 10.913 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/tools-release exec vitest run tests/catalog-pack.test.ts -t "writes checksums" --testTimeout=20000` | [log](../../.tmp/phase5-work/paths-catalog-tar-baseline.log) |
| 182 | visual-final-capture | PASS | 25.729 | `node .tmp/phase5-work/capture.ts final` | [log](../../.tmp/phase5-work/visual-final-capture.log) |
| 183 | paths-item-counts | PASS | 6.177 | `node .tmp/phase5-work/item-counts.ts` | [log](../../.tmp/phase5-work/paths-item-counts.log) |
| 184 | visual-final-diff | FAIL 1 | 1.269 | `node .tmp/phase5-work/diff.ts final before-controlled` | [log](../../.tmp/phase5-work/visual-final-diff.log) |
| 185 | paths-packaged-tests | FAIL 1 | 1.41 | `pnpm --filter @openpixo/packaged exec vitest run tests/config.test.ts tests/launcher-runtime.test.ts tests/runtime-dirs.test.ts tests/headless.test.ts` | [log](../../.tmp/phase5-work/paths-packaged-tests.log) |
| 186 | paths-e2e-resources | FAIL 1 | 2.091 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/server-identifier-scope.test.ts tests/plugin-example-iframe-shell.test.ts tests/plugins/motion-template-package.test.ts tests/scripts/guard.test.ts tests/scripts/check-plugin-preview-manifest.test.ts tests/scripts/check-html-plugin-preview-contracts.test.ts` | [log](../../.tmp/phase5-work/paths-e2e-resources.log) |
| 187 | paths-motion-baseline | FAIL 1 | 1.29 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/plugins/motion-template-package.test.ts -t motion-future` | [log](../../.tmp/phase5-work/paths-motion-baseline.log) |
| 188 | paths-symlink-baseline | FAIL 1 | 1.25 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/packaged exec vitest run tests/launcher-runtime.test.ts -t "symlinked root"` | [log](../../.tmp/phase5-work/paths-symlink-baseline.log) |
| 189 | paths-packaged-focused | PASS | 2.05 | `pnpm --filter @openpixo/packaged exec vitest run tests/config.test.ts tests/launcher-runtime.test.ts tests/headless-runtime.test.ts tests/paths.test.ts tests/sidecars.test.ts -t "^(?!.*symlinked root)"` | [log](../../.tmp/phase5-work/paths-packaged-focused.log) |
| 190 | visual-final-capture-pointer | PASS | 27.56 | `node .tmp/phase5-work/capture.ts final-pointer` | [log](../../.tmp/phase5-work/visual-final-capture-pointer.log) |
| 191 | visual-final-diff-pointer | FAIL 1 | 1.273 | `node .tmp/phase5-work/diff.ts final-pointer before-controlled` | [log](../../.tmp/phase5-work/visual-final-diff-pointer.log) |
| 192 | paths-motion-baseline-html-eol | FAIL 1 | 1.424 | `pnpm --dir .tmp/phase5-baseline --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/plugins/motion-template-package.test.ts -t motion-future` | [log](../../.tmp/phase5-work/paths-motion-baseline-html-eol.log) |
| 193 | paths-e2e-resources-eol | FAIL 1 | 2.042 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/server-identifier-scope.test.ts tests/plugin-example-iframe-shell.test.ts tests/plugins/motion-template-package.test.ts tests/scripts/guard.test.ts tests/scripts/check-plugin-preview-manifest.test.ts tests/scripts/check-html-plugin-preview-contracts.test.ts` | [log](../../.tmp/phase5-work/paths-e2e-resources-eol.log) |
| 194 | mock-final-stop | PASS | 14.864 | `pnpm tools-dev stop web --namespace phase5mock --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-mock-final\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/mock-final-stop.log) |
| 195 | mock-final-stop-owned | PASS | 15.039 | `node .tmp/phase5-work/visual-runtime.ts stop --fresh` | [log](../../.tmp/phase5-work/mock-final-stop-owned.log) |
| 196 | visual-stop | PASS | 14.848 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 197 | visual-final-stop-main | PASS | 15.022 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-final-stop-main.log) |
| 198 | visual-start | PASS | 7.716 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev start web --prod --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 199 | visual-final-start-base | PASS | 7.971 | `node .tmp/phase5-work/visual-runtime.ts start --baseline` | [log](../../.tmp/phase5-work/visual-final-start-base.log) |
| 200 | paths-vendor-proof | PASS | 0.159 | `node .tmp/phase5-work/vendor-proof.ts` | [log](../../.tmp/phase5-work/paths-vendor-proof.log) |
| 201 | paths-e2e-resources-available | PASS | 2.325 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/server-identifier-scope.test.ts tests/plugin-example-iframe-shell.test.ts tests/plugins/motion-template-package.test.ts tests/scripts/guard.test.ts tests/scripts/check-plugin-preview-manifest.test.ts tests/scripts/check-html-plugin-preview-contracts.test.ts -t ^(?!.*motion-future)` | [log](../../.tmp/phase5-work/paths-e2e-resources-available.log) |
| 202 | final-build-non-web | PASS | 4.369 | `pnpm --filter @openpixo/daemon --filter @openpixo/desktop --filter @openpixo/packaged --filter @openpixo/tools-dev --filter @openpixo/tools-pack --filter @openpixo/components --workspace-concurrency=1 run build` | [log](../../.tmp/phase5-work/final-build-non-web.log) |
| 203 | visual-final-capture-base | PASS | 29.385 | `node .tmp/phase5-work/capture.ts before-final` | [log](../../.tmp/phase5-work/visual-final-capture-base.log) |
| 204 | paths-vendor-proof-fixed | PASS | 0.13 | `node .tmp/phase5-work/vendor-proof.ts` | [log](../../.tmp/phase5-work/paths-vendor-proof-fixed.log) |
| 205 | paths-e2e-resources-eol-fixed | PASS | 1.95 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/server-identifier-scope.test.ts tests/plugin-example-iframe-shell.test.ts tests/plugins/motion-template-package.test.ts tests/scripts/guard.test.ts tests/scripts/check-plugin-preview-manifest.test.ts tests/scripts/check-html-plugin-preview-contracts.test.ts` | [log](../../.tmp/phase5-work/paths-e2e-resources-eol-fixed.log) |
| 206 | visual-stop | PASS | 13.955 | `pnpm --dir C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-baseline tools-dev stop web --namespace phase5base --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\baseline-orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 207 | visual-final-stop-base | PASS | 14.119 | `node .tmp/phase5-work/visual-runtime.ts stop --baseline` | [log](../../.tmp/phase5-work/visual-final-stop-base.log) |
| 208 | visual-start | PASS | 7.513 | `pnpm tools-dev start web --prod --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-start.log) |
| 209 | visual-final-start-controlled | PASS | 7.758 | `node .tmp/phase5-work/visual-runtime.ts start` | [log](../../.tmp/phase5-work/visual-final-start-controlled.log) |
| 210 | paths-tools-dev-tests | FAIL 1 | 0.463 | `pnpm --filter @openpixo/tools-dev exec vitest run tests/local-env.test.ts tests/diagnostics.test.ts` | [log](../../.tmp/phase5-work/paths-tools-dev-tests.log) |
| 211 | paths-desktop-preview | PASS | 1.653 | `pnpm --filter @openpixo/desktop exec vitest run tests/main/preview-navigation-failure.test.ts tests/main/artifact-first-viewport-capture.test.ts tests/main/artifact-export-image-height.test.ts tests/main/artifact-document-load-bound.test.ts` | [log](../../.tmp/phase5-work/paths-desktop-preview.log) |
| 212 | paths-native-parser | PASS | 1.732 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/scripts/native-parser.test.ts` | [log](../../.tmp/phase5-work/paths-native-parser.log) |
| 213 | visual-final-capture-controlled | PASS | 28.487 | `node .tmp/phase5-work/capture.ts final-controlled` | [log](../../.tmp/phase5-work/visual-final-capture-controlled.log) |
| 214 | visual-final-diff-controlled | PASS | 1.324 | `node .tmp/phase5-work/diff.ts final-controlled before-final` | [log](../../.tmp/phase5-work/visual-final-diff-controlled.log) |
| 215 | paths-daemon-boundaries | PASS | 26.507 | `pnpm --filter @openpixo/daemon exec vitest run tests/chat-artifacts-video-cover.test.ts tests/mcp-brief-app.test.ts tests/media-generate-prompt-file.test.ts tests/runtimes/prompt-file.test.ts tests/artifacts/deliverable-syntax-safe-fix.test.ts` | [log](../../.tmp/phase5-work/paths-daemon-boundaries.log) |
| 216 | paths-tools-dev-node-tests | PASS | 0.538 | `pnpm --filter @openpixo/tools-dev exec node --import tsx --test tests/local-env.test.ts tests/diagnostics.test.ts` | [log](../../.tmp/phase5-work/paths-tools-dev-node-tests.log) |
| 217 | visual-stop | PASS | 14.853 | `pnpm tools-dev stop web --namespace phase5visual --tools-dev-root C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase5-visual\orchestration --no-env-file --json` | [log](../../.tmp/phase5-work/visual-stop.log) |
| 218 | visual-final-stop-controlled | PASS | 15.022 | `node .tmp/phase5-work/visual-runtime.ts stop` | [log](../../.tmp/phase5-work/visual-final-stop-controlled.log) |
| 219 | visual-final-cycle | PASS | 119.782 | `node .tmp/phase5-work/visual-final-cycle.ts` | [log](../../.tmp/phase5-work/visual-final-cycle.log) |
| 220 | paths-final-guard | PASS | 14.063 | `pnpm guard` | [log](../../.tmp/phase5-work/paths-final-guard.log) |
| 221 | paths-final-typecheck | PASS | 14.806 | `pnpm typecheck` | [log](../../.tmp/phase5-work/paths-final-typecheck.log) |
| 222 | final-cli-help | PASS | 0.412 | `node apps/daemon/bin/pixo.mjs --help` | [log](../../.tmp/phase5-work/final-cli-help.log) |
| 223 | paths-web-preview-boundaries | PASS | 53.485 | `pnpm --filter @openpixo/web exec vitest run tests/components/FileViewer.test.tsx tests/runtime/srcdoc.test.ts tests/components/FileViewer.manual-edit.test.tsx tests/components/LibraryAssetMeta.test.tsx` | [log](../../.tmp/phase5-work/paths-web-preview-boundaries.log) |
| 224 | final-build-web | PASS | 24.172 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase5-work/final-build-web.log) |
| 225 | final-source-audit | PASS | 8.758 | `node .tmp/phase5-work/final-audit.ts` | [log](../../.tmp/phase5-work/final-source-audit.log) |
| 226 | final-markup-audit | PASS | 0.693 | `node .tmp/phase5-work/markup-audit.ts` | [log](../../.tmp/phase5-work/final-markup-audit.log) |
| 227 | final-preservation | PASS | 4.438 | `node .tmp/phase5-work/proof.ts` | [log](../../.tmp/phase5-work/final-preservation.log) |
| 228 | final-packaged-output-proof | PASS | 0.092 | `node .tmp/phase5-work/packaged-proof.ts` | [log](../../.tmp/phase5-work/final-packaged-output-proof.log) |
| 229 | report-links | FAIL 1 | 0.092 | `node .tmp/phase5-work/report-check.ts` | [log](../../.tmp/phase5-work/report-links.log) |
| 230 | report-links-fixed | PASS | 0.122 | `node .tmp/phase5-work/report-check.ts` | [log](../../.tmp/phase5-work/report-links-fixed.log) |
| 231 | final-typecheck | PASS | 14.264 | `pnpm typecheck` | [log](../../.tmp/phase5-work/final-typecheck.log) |
| 232 | final-guard | PASS | 14.83 | `pnpm guard` | [log](../../.tmp/phase5-work/final-guard.log) |
| 233 | final-nsis-build | PASS | 581.561 | `pnpm tools-pack win build --to nsis --namespace p5 --dir .tmp/phase5-pack --cache-dir .tmp/phase5-pack-cache --json` | [log](../../.tmp/phase5-work/final-nsis-build.log) |
| 234 | final-artifact-proof | PASS | 0.384 | `node .tmp/phase5-work/packaged-proof.ts` | [log](../../.tmp/phase5-work/final-artifact-proof.log) |
| 235 | final-search-with-report | PASS | 16.332 | `node .tmp/phase5-work/final-audit.ts` | [log](../../.tmp/phase5-work/final-search-with-report.log) |
| 236 | final-report-links | PASS | 0.14 | `node .tmp/phase5-work/report-check.ts` | [log](../../.tmp/phase5-work/final-report-links.log) |
| 237 | final-lifecycle-proof | PASS | 0.105 | `node .tmp/phase5-work/lifecycle-proof.ts` | [log](../../.tmp/phase5-work/final-lifecycle-proof.log) |
| 238 | final-lifecycle-canonical | PASS | 0.086 | `node .tmp/phase5-work/lifecycle-proof.ts` | [log](../../.tmp/phase5-work/final-lifecycle-canonical.log) |
