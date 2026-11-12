# Phase 6 — text, documentation, and upstream feature removal

> Historical naming checkpoint. Library token, command and test references below describe the recorded commits; [slim-core Batch 9](SLIM-CORE.md#batch-9--game-copy) later removes the global registry.

Owner-authorized work starts at `89e5ddf5`. All seven ordered items are complete,
with a separate follow-up correcting a filesystem test fixture. Phase 7 is
outside this change. The final evidence and complete execution ledger follow
the per-item account below.

## Item 1 — contribution and promotion

Removed the bundled contribution action, the community submission scenario,
their UI triggers, HTTP routes, CLI commands, contracts, and tests. Removed
the upstream-only version-yank issue launcher, dormant star/release/Discord
metadata services and endpoints, repository social sharing, and upstream
support-group links. Feedback and privacy destinations use empty product
constants and remain disabled until configured.

Retained `publish-github` / `pixo plugin publish-repo`: it publishes to the
author's own GitHub repository. Retained `pixo share url`, `/api/social-share`,
and the project share grid: FileViewer uses them for the user's deployed
project URL. Repository recommendation fields and the repository share kind
were removed, and the endpoint rejects unsupported kinds.

Validation: root guard and typecheck pass; daemon focused batch 43/43,
contracts 33/33, the seven unaffected web files pass, and the corrected
link/privacy tests pass 27/27. Consumed contracts/plugin-runtime/daemon and
web outputs were rebuilt. Ten stale outputs belonging to deleted TypeScript
modules were moved into task scratch before runtime validation.

The first browser checkpoint covers home, all ten Settings sections, imported
game/chat, FileViewer, plugins, marketplace, store, and the entry-menu component
in both maintained locales. No upstream network request was attempted.
The text assertion still detects existing catalog labels and chat attributes;
those are recorded for item 4. This checkpoint is **not a passing final text
audit**. The entry-menu component is currently unmounted in the product, so its
before/after screenshots use the actual component in a browser harness.

Evidence is under [phase 6 scratch](../../.tmp/phase6-work/) and
[visual captures](../../.tmp/phase6-visual/). The command ledger retains failed
implementation and harness attempts as well as their corrected reruns.

## Item 2 — runtime infrastructure

Removed implicit upstream attribution, telemetry, preview, public-site,
catalog-source, support-email, and crash-report destinations. Bundled catalog
discovery stays local; the obsolete marketplace migration and URL aliases are
gone. Empty public plugin links fall back to the in-app marketplace. Retired
the inherited release highlight by publishing the supported empty document.
Updater and highlight sources have no upstream defaults.

Twelve existing preview files were copied into a shipped template asset
directory. All twelve return HTTP 200 through the existing skill asset route
and match their source SHA-256 hashes. Remote-only video/poster/style previews
were removed, leaving the existing authored iframe or style-card fallbacks.
The [asset change inventory](../../.tmp/phase6-work/runtime-asset-changes.json)
records 408 URL/reference changes across 194 shipped-content files. Optional
manifest URL fields were removed as part of this runtime dependency cleanup.
The upstream-only award configuration and unused container-compose deployment
stub were also deleted. Bootstrap installers use a colocated script or an
explicitly materialized release URL.

Validation: guard/typecheck and consumed daemon/web/desktop/tools builds pass;
web link/style tests 70/70, contract links 8/8, desktop tests 60 passed with one
existing skip, highlight tests 33/33, bootstrap publisher 2/2, and corrected
daemon attribution/preview tests 13/13. Other daemon marketplace/telemetry
tests passed in the first focused batch. Catalog/bootstrap packaging tests
pass 25/25 with child-only `TAR_OPTIONS=--force-local`. Without it GNU tar
misreads Windows drive paths; the same failure was reproduced at `89e5ddf5`.
The final installer build will use the normal environment without that override.

| Checkpoint | Brand files / lines | Organization files / lines | Slug files / lines |
|---|---:|---:|---:|
| Starting commit | 1091 / 4491 | 503 / 2000 | 772 / 3598 |
| Item 1 | 1078 / 4328 | 482 / 1949 | 738 / 3442 |
| Item 2 | 1074 / 4319 | 337 / 1541 | 578 / 3039 |
| Item 3 | 990 / 3510 | 285 / 1205 | 514 / 2465 |
| Item 4 | 728 / 2125 | 284 / 1203 | 499 / 2434 |
| Item 5 | 458 / 1636 | 240 / 1135 | 432 / 2300 |
| Item 6 | 152 / 755 | 157 / 946 | 136 / 1223 |
| Item 7 | 36 / 164 | 108 / 156 | 42 / 154 |

Each item's before count is the preceding row; its after count is its own row.
Counts use tracked text, include documentation, and exclude the lockfile and
generated output. The final lockfile check also has zero matches.

## Item 3 — documentation deletion and classification

[The complete document ledger](PHASE6-DOCUMENTS.tsv) classifies all 545 starting
files under `docs/` and `specs/`, including every deletion and its reason.
Deleted 100 documents and 24 assets referenced only by deleted documents:
unmaintained translations, upstream release notes and announcements, removed
deployment installers, cloud/account/publication guides, deleted design-system,
jury, clipper and presentation specifications, and obsolete release automation.
The Chinese contributing guide remains at its existing indexed path. The release
note directory keeps a rewritten index because retained preparation code reads it.

Fifty-five uncertain plans/reference files remain for naming and link cleanup:
generic plugin/registry work, manual editing, sandboxing, browser/chat reference,
RFCs and change specifications whose retained code still benefits from their
contract. Their ledger rows are marked `uncertain=true`. Protected provenance and
historical records keep their bodies; deleted references are plain text marked
as deleted in this phase. The root documentation index and comment references
were updated; no runtime schema or release-note reader points at deleted content.

Guard/typecheck pass. Scope-planner tests pass 12/12 with a task-only preload
mapping the Windows `python3` app alias to the already installed Python executable.
The unmodified starting commit reproduces the app-alias failure. This changes
neither global PATH/configuration nor CI routing policy.

## Item 4 — UI and localization

Code-built product copy uses `PRODUCT_NAME`; maintained dictionaries and existing
partial translations use OpenPixo. Updated desktop recovery/update/diagnostic
dialogs, plugin bylines, browser/provider errors and accessibility labels.
Removed dormant upstream follow/star/community keys from the type and dictionaries.
No locale gained a key; English/Chinese parity and locale tests pass 14/14.
Visible manifest/frontmatter metadata was updated with this UI checkpoint; model
prompt bodies remain for item 5.

The remaining paper-story promotion example was deleted with its preset, ordering,
test and documentation references. Own-repository plugin publication remains.
The 66-file focused web batch passed 59 files and exposed obsolete expectations
in seven more; their corrected focused reruns pass, including 63 assistant cases.
Thirty failures concerning previously deleted cloud locale keys reproduce at the
starting commit; those obsolete requirements were removed while retained copy
checks remain. Desktop focused tests pass 33/33. Guard, typecheck and consumed
web/desktop/packaged builds pass.

The browser audit passes all 34 English/Chinese surfaces, including ten Settings
sections per locale, imported-game chat, catalogues and the entry-menu component:
zero old-brand matches in text/title/aria-label/placeholder, zero upstream-host
requests and zero page errors. An earlier replay exposed an external recorded
filesystem name in an attribute. The passing audit uses another existing verbatim
recording; no recording bytes or displayed external output were rewritten.

Entry-point screenshots (English; matching Chinese captures are alongside):

- Entry menu: [before](../../.tmp/phase6-visual/before/en/entry-menu-harness.png),
  [after](../../.tmp/phase6-visual/final/en/entry-menu-harness.png).
- Plugin actions: [before](../../.tmp/phase6-visual/before/en/plugin-actions.png),
  [after](../../.tmp/phase6-visual/final/en/plugin-actions.png).
- Chat follow-up sharing: [before](../../.tmp/phase6-visual/before/en/chat-follow-up-share.png),
  [after](../../.tmp/phase6-visual/final/en/chat-follow-up-share.png).
- [Home](../../.tmp/phase6-visual/final/en/home.png) and
  [imported-game conversation](../../.tmp/phase6-visual/final/en/project-chat.png).

The dormant entry/contribution components are rendered from their real source in
a browser harness: the before bundles use `89e5ddf5`, and the after bundles use
the current source. The main application captures use the isolated production
runtime, its task-local profile and its explicit daemon data root.

## Item 5 — prompts and shipped content

Updated naming in both prompt composers and retained skills, plugin examples,
rendering templates, craft and prompt-template content. Removed product-owned
upstream links without inventing a public destination. The Ask-mode introduction
now describes the game workbench instead of the upstream design product.
Deleted the obsolete agent-marketplace seed whose target plugin directory no
longer exists. Custom registry and own-repository publishing instructions remain.

Imported component licenses, author/source records and the HyperFrames attribution
summary remain intact. Their source links identify separate imported components,
not the product repository. Recordings were not edited or re-recorded. No
maintenance notes were added inside exported prompts.

Reviewed every changed prompt hunk before refreshing the scenario snapshot.
Only 19 character counts changed; section lists and gates are unchanged. The
starting commit reproduces its stale-count failure. Prompt/contract focused
checks pass (24 daemon prompt files after the targeted corrections; contracts
78/78). The final seven-file content/stability batch passes 56/56 and the web
authoring prompt passes 10/10. The stale craft-default assertion and CRLF-only
motion extraction failure also reproduce at the starting commit; the tests now
exercise retained declarations and portable extraction. Guard/typecheck and
consumed daemon/contracts/web builds pass.

## Item 6 — diagnostics, help and metadata

Renamed product-owned comments, errors, log prefixes, fixtures, installer resource
paths and remaining serialized names. Package manifests no longer advertise the
upstream author/repository/homepage/issue tracker. Reinstalled with the pinned
toolchain and rebuilt consumed outputs. Synthetic network fixtures use reserved
example hosts or an example GitHub owner; no public product destination was
invented. External CLI recording directories remain untouched.

The desktop Help menu and site generator now use the empty product destinations
and disabled placeholders. The static site copies and four reviewed snapshots
were updated together. Removed an upstream analytics-project default from the
optional popularity script; a project ID must now be supplied explicitly.
Updater/highlight sources remain empty by default and validate explicitly
configured URLs; obsolete brand-specific blocklists were removed.

Deployment credentials now receive the resolved daemon data root from startup,
instead of using an independent home-directory fallback. Project manifests use
the authorized project directory. Managed-download/resource/release tags use
the product's own names without aliases. Terminal contract schemas use URNs,
not fabricated public schema URLs.

Focused checks: daemon 277 pass; desktop 58 pass/1 skip; packaged 182 pass/1 skip
with six prewarm failures reproduced at the starting commit; download 20 pass/1
skip; release identity 6 pass; fixture service 17 pass; packaging 54 pass; site
and release helpers 65 pass. The changed-file web batch passed 1,704 cases;
two stale expectations were corrected and the four-file rerun passes 227.
The localized contract fixture now declares the required license (14 pass).
Seven channel-preparation failures reproduce at the starting commit because
the checkout already has an alpha version rather than a stable release base.
The broader sidecar convergence run exposed Windows process-observation timeouts;
its baseline comparison is recorded in the final ledger.

The initial install failed because a new import displaced an existing file-level
TypeScript directive. Moving the import below the directive fixed it; the
subsequent install and root checks pass. No compiler suppression was added.

Root help and all 41 dispatched/group help requests exit successfully with zero
old-brand matches, including normalized wrapped text. Fixed help-only exit codes
for artifacts/library/tools and made version help return before daemon discovery.
All seven requested application/tool builds pass. Item 6 search counts are
152 files/755 brand lines, 157/946 organization lines, and 136/1,223 slug lines.

## Item 7 — retained documentation and automation

Rewrote English/Chinese onboarding and contribution guides, translation guidance,
privacy/data handling, product terminology, layer guidance and retained technical
documents. Public product destinations remain placeholders. Removed the remaining
cloud-pricing plans, AMR-only latency plan, release announcement, governance rules
and promotional covers. The document ledger records each reason. Retained
uncertain plugin/registry, editing, sandbox, browser and chat references are named
individually there; their unsupported hosting/submission instructions were removed.
The Chinese contribution guide stays at its original indexed path.

Removed the upstream-only recording uploader and unused synthetic continuation/
sharing fixtures. Renamed owned fixture copy and the retained standalone Figma
import manifest. Verbatim recordings, projected external output, corpus origin
metadata, licenses and imported author/source/contact records remain unchanged.
The protected-content audit compares 62 retained files with the starting Git blobs.
Seven raw hashes differ between the two Windows worktree materializations only
because of checkout line endings; all protected Git content hashes match.

CI no longer selects the upstream runner fleet or repository. Validation defaults
to hosted Ubuntu/Windows; optional third-party and explicitly labeled local runners
remain selectable. Writer atoms require a nonempty `PIXO_REPOSITORY` variable
matching the current repository, keeping them off until configured. Bot-token
scope is the current owner/repository. Release helpers require an explicit
repository and bot identity. Convergence protocol naming changes together with
declaration schema 12 and paired fixtures; previous declaration versions are not
accepted. Scope routing, confidence and omission policy are unchanged. No phase 7
old-name guard was added.

The nine-file CI batch passes 118 cases with six existing skips. Its task-only
Windows harness uses the existing Python executable, verified repository-local
jq, case-normalized child environments and a Node launcher for the POSIX fake-gh
fixture. Baseline reproductions retain the original Windows failures. Fixed
portable ESM fixture imports and CRLF output parsing; current-schema tests provide
fake job evidence and authenticate a real local PR merge ref and its parents.

Item 3 changed plain historical references beyond the permitted link-only edits.
Item 7 restored those original bodies; final history/migration diffs contain only
actual link replacements. This boundary overreach is corrected in the final tree.

The final source audit classifies every matching line in
[the tracked TSV](PHASE6-REMAINING-HITS.tsv); the exact text is also retained in
[the full audit artifact](../../.tmp/phase6-work/final-hits.tsv). There are no
unclassified matches. Legal/provenance, historical ADR/coordination, migration
sources, external recorded output and imported-component attribution explain all
remaining matches. No recording was re-recorded and no live provider/model test ran.

## Final delivery

| Item | Commit | Subject | Required root checks before commit |
|---|---|---|---|
| 1 | `f79dbfe5` | feat!: remove upstream contribution and repository promotion | [guard: PASS](../../.tmp/phase6-work/item1-ready-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item1-ready-typecheck.log) |
| 2 | `d7b67969` | fix!: drop runtime dependencies on upstream infrastructure | [guard: PASS](../../.tmp/phase6-work/item2-empty-highlight-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item2-final-typecheck.log) |
| 3 | `561d87f5` | docs!: delete upstream-only documents and orphaned assets | [guard: PASS](../../.tmp/phase6-work/item3-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item3-typecheck.log) |
| 4 | `d0d8e0e2` | refactor(web): use the product name in UI copy and locales | [guard: PASS](../../.tmp/phase6-work/item4-commit-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item4-commit-typecheck.log) |
| 5 | `de1e4588` | refactor: use OpenPixo naming in prompts and shipped content | [guard: PASS](../../.tmp/phase6-work/item5-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item5-typecheck.log) |
| 6 | `b2e964e3` | chore!: finish product naming in diagnostics and tooling | [guard: PASS](../../.tmp/phase6-work/item6-final-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item6-final-typecheck.log) |
| 7 | `07788200` | docs!: align retained documentation and automation with OpenPixo | [guard: PASS](../../.tmp/phase6-work/item7-guard.log); [typecheck: PASS](../../.tmp/phase6-work/item7-typecheck.log) |
| Fixture follow-up | `ac176037` | test(daemon): isolate resolver filesystem fixtures | [guard: PASS](../../.tmp/phase6-work/final-fixture-guard.log); [typecheck: PASS](../../.tmp/phase6-work/final-fixture-typecheck.log) |

[Commit/check timestamps](../../.tmp/phase6-work/commit-check-proof.json) show
green guard/typecheck before every listed commit. Commits use the requested
local author identity, have no co-author trailers, and remain on the owner's
requested branch. Nothing was pushed or rebased. The final documentation commit
contains this completed report and the three evidence indexes.

### Capability decisions

[The feature/surface ledger](../../.tmp/phase6-work/deleted-features.tsv) lists
original removed identifiers, UI entries, CLI forms, endpoints, contracts and
bundled plugin paths. The main decisions are:

| Capability | UI | CLI/API/plugin decision |
|---|---|---|
| Upstream contribution | Removed plugin-card and plugin-folder contribution entries | Removed community PR command, contribution endpoint/action, task-service branch, contract union and bundled contribution plugin |
| Community submission | Removed project/chat/assistant callbacks and follow-up menu entry | Removed community scenario, prompt helper, catalog submission path and paired tests |
| Repository social sharing | Removed settings-menu share section | Removed repository kind/default/argument, recommendation fields and corresponding locale keys |
| Upstream issue-based version yank | Removed submission documentation | Removed yank command and inherited publication target |
| Stars, release and Discord metadata | Removed star/presence hooks, badges, prompts and support groups | Deleted all three metadata routes, services, DTOs, provider readers and mocks |
| Feedback, help, privacy, releases and public site | Disabled product placeholders while destinations are empty | No invented repository/site/email; empty destinations are never opened |
| Inherited remote catalog defaults | Local catalog discovery remains | Removed upstream seeds, aliases, migration and implicit remote origin |
| Other promotion | Removed contributor/badge/star-history links, promotional covers and paper-story example | Deleted award configuration, obsolete uploader and the example's preset/order/tests/docs |
| Own-repository publication | Retained plugin Publish action | Retained `publish-github` and `pixo plugin publish-repo`; they operate on the user's own GitHub repository |
| User project URL sharing | Retained FileViewer sharing and URL share grid | Retained `pixo share url` and `/api/social-share` because deployed user projects use them; repository sharing is gone |

The starting CLI called its community contribution command
`pixo plugin openpixo-pr`. It did not expose the older contribute spelling in
the task description. The command present at the starting commit was removed;
no compatibility alias was introduced.

### Documentation inventory

The final document ledger has 552 entries: all 545 starting files below
`docs/` and `specs/`, three additional root documents, and four new phase
evidence documents. It records 136 deletions: 111 text documents/specifications
(including root announcements/governance and promotional HTML covers) and 25
orphaned image/video/banner assets. It records 367 retained/rewrite entries,
45 protected historical/provenance entries and four new evidence files.
All 55 uncertain retained references are listed with `uncertain=true`.

The final inventory corrects the intermediate ledger's asset rows to reflect
the actual deletions. [Deleted files and individual reasons](../../.tmp/phase6-work/deleted-documents.tsv)
and [inventory totals](../../.tmp/phase6-work/document-final-summary.json) are
available separately. The Chinese contribution guide remains in its indexed
location. Release-note code reads the retained empty directory/index rather
than a deleted release note.

### Runtime fetch inventory

| Former dependency | Final behavior |
|---|---|
| Repository stats, release metadata and support-group lookup | Capability and fetchers deleted |
| Hosted catalog seeds and inherited migration aliases | Repository-local catalog seed; custom registry origins require explicit input |
| Hosted image/video/style previews | Twelve existing files copied locally; remote-only references removed, with retained authored/style-card fallbacks |
| Public site, privacy/docs/issues, support email and crash destinations | Empty product constants and disabled placeholders |
| Attribution/telemetry relay and popularity analytics defaults | No implicit upstream destination or analytics project; explicit operator configuration required |
| Updater and post-update highlights | No upstream/default feed; highlights document is empty, and independently operated URLs must be configured explicitly |
| Agent/bootstrap installers and recording upload | Removed upstream-only installers/uploader; DSH uses a colocated script or explicitly materialized origin |

The [complete URL/reference changes](../../.tmp/phase6-work/runtime-asset-changes.json),
[local copies](../../.tmp/phase6-work/runtime-asset-copies.json) and
[HTTP/hash witnesses](../../.tmp/phase6-work/local-asset-proof.json) give the
per-file detail. Remaining imported author/source links are required attribution
for separate components, rather than implicit product infrastructure.

### Final browser and game checks

The final headless audit passes 34 surfaces across English and Simplified
Chinese: home, all ten Settings sections, imported-game conversation, file
viewer, plugins, marketplace, store and the actual entry-menu component.
Rendered text and title/aria-label/placeholder attributes have zero old-brand
matches. There are zero upstream-host request attempts and zero page errors.
[Final manifest](../../.tmp/phase6-visual/final/manifest.json).

The real component harness renders the deleted plugin/chat entries from the
starting source and the final source, in both locales: two contribution buttons
before and zero after. The repaired menu harness uses each revision's own CSS,
asserts that the full popover is on-screen, and confirms the final public links
have no href. Initial clipped/unstyled harness attempts remain in the ledger.
[Feature proof](../../.tmp/phase6-visual/feature-entry-proof.json),
[final feature proof](../../.tmp/phase6-visual/final-feature-entry-proof.json),
[menu geometry/link proof](../../.tmp/phase6-visual/entry-menu-review-proof.json).
Chinese entry points: [before menu](../../.tmp/phase6-visual/before/zh-CN/entry-menu-harness.png),
[after menu](../../.tmp/phase6-visual/final/zh-CN/entry-menu-harness.png),
[after plugin](../../.tmp/phase6-visual/final/zh-CN/plugin-actions.png),
[after chat sharing](../../.tmp/phase6-visual/final/zh-CN/chat-follow-up-share.png).

The imported-game E2E passes real PNG/WAV byte preservation, path traversal
rejection, native approval accept/cancel/replay protection, parallel independent
sessions, child-agent isolation and project extension lifecycle.
[E2E log](../../.tmp/phase6-work/final-game-workspace-e2e.log).
Its temporary suite-root override was restored byte-for-byte afterwards.

The isolated mock conversation succeeds with one tool event and one generated
artifact. The task-local adapter writes a simple review artifact and replays an
existing raw Claude recording unchanged; this is a mock, with no live provider.
The daemon reports successful syntax validation and completion. The earlier
minimal replay's missing-artifact UI state was replaced by this useful fixture.
[Replay receipt](../../.tmp/phase6-mock-final/evidence.json),
[event stream](../../.tmp/phase6-mock-final/mock-clean-events.txt),
[completed Chinese chat](../../.tmp/phase6-visual/final/zh-CN/project-chat.png).
All profiles, game folders, explicit data roots and orchestration state for
these checks are task-local. All owned visual namespaces and the E2E lifecycle
were stopped; stop receipts report no remaining processes.

### Final build and packaging checks

All seven requested builds pass: daemon, web, desktop, packaged, tools-dev,
tools-pack and components. Root and all 41 dispatched/group help requests pass
with no old-brand text, including normalized wrapped output. Final focused
prompt checks pass 366 daemon cases and 78 contract cases; the final five-file
web group passes 72, including locale parity. Earlier focused groups cover
every touched runtime/contract/plugin/tool boundary; full daemon/web suites
were not run. The nine-file CI group passes 118 with six existing skips.
Final [guard](../../.tmp/phase6-work/final-guard.log) and
[typecheck](../../.tmp/phase6-work/final-typecheck.log) both pass.

The NSIS build passes in 440.966 seconds on its unchanged retry. The first
attempt failed once with a Windows cache-directory rename EPERM. Its precise
cause is unproven; this is recorded as a transient failed attempt, not asserted
to be a reproduced baseline exception. Both attempts use the normal user home,
profile and local-app-data environment, without task preloads or tar options.
Only the pinned toolchain PATH is prepended.

Exact build command:

`pnpm tools-pack win build --to nsis --namespace p6 --portable --dir C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-pack --cache-dir C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-cache --json`

- [Installer](../../.tmp/phase6-pack/out/win/namespaces/p6/builder/OpenPixo-p6-setup.exe):
  356,474,321 bytes; SHA-256 `acbbd2fc249b3d9a6ce30f3e7dff31ae1d741e173e3f53395e667aa3f4f98a50`.
- [Launcher payload](../../.tmp/phase6-pack/out/win/namespaces/p6/payload/OpenPixo-p6-payload.7z):
  341,610,098 bytes; SHA-256 `d20d7b27f59d9a7efff013eaa991857e3528ffba82bfc67436cea15c606ded50`.

The payload was extracted with the repository's 7-Zip helper, without executing
the installer. Both unpacked and extracted trees were scanned including binary
bytes and UTF-16LE text. Each tree has 336 ASCII/UTF-8 matches and seven UTF-16LE
matches. Every match appears in [the packaged hit index](PHASE6-PACKAGED-HITS.tsv)
and [the full contextual ledger](../../.tmp/phase6-work/packaged-hits.tsv).

| Explanation | Matches per tree |
|---|---:|
| Imported-component attribution | 154 |
| Unchanged root license, including eleven workspace-package copies | 12 |
| Required notice/provenance | 4 |
| Unrelated vendor device/model names and generic-name examples | 163 |
| Incidental substrings in certificate/image encoded bytes | 3 |
| Unrelated vendored calendar/locale text in UTF-16LE | 7 |

All 133 matching files have identical hashes between the unpacked app and
extracted payload. There are no unclassified package hits. Namespace/config/
entrypoint and normal-environment evidence is in
[the packaging proof](../../.tmp/phase6-work/packaged-proof.json).
No installer was installed, uninstalled or launched. The installed Alpha.3 and
its protocol/registry entries were untouched. The packaged version remains the
checkout's existing alpha version; no release or distribution was performed.
The later fixture-only commit does not change shipped application output.

### Baseline failures and corrected attempts

| Check | Evidence and disposition |
|---|---|
| GNU tar and Windows drive paths | Starting revision reproduces the failure; focused catalog tests pass with child-only force-local, absent from NSIS |
| Windows python3 alias / POSIX fake-gh fixture | Baseline failure preserved; focused tests use task-local shims for existing Python/jq and a Node fake-gh launcher; no global configuration changed |
| Obsolete cloud locale requirements | Thirty failures reproduce at the starting revision; assertions for deleted keys removed, retained key/parity checks pass |
| Stale prompt counts, craft expectation and CRLF extraction | Reproduced before correction; reviewed character counts and portable retained-behavior assertions pass |
| Packaged prewarm | Six failures reproduce at the starting revision; 182 other packaged cases pass with one existing skip |
| Channel preparation | Seven failures reproduce because the starting checkout already has an alpha version rather than the test's stable base |
| Daemon health shutdown | Windows reports a null signal where the existing test expects SIGKILL; reproduced at the starting revision |
| Sidecar process observation | Broad current run: eleven failures; baseline: seven. Six failures overlap. All five current-only cases pass in isolated current and baseline runs; one baseline-only case passed current. Lifecycle implementation is unchanged apart from diagnostic text/comments |
| Implementation/harness attempts | Missing/stale imports, obsolete expectations, source-count audit refinements, fixture environment setup and screenshot harness failures were corrected; their original failures and passing reruns remain below |

No known new unresolved validation failure remains. Baseline exceptions above
remain failures, not relabeled as passes. The exact commands, exit statuses,
durations, logs and baseline paths are retained in the execution ledger.

### Final tracked-source search

The three final searches have 36 files/164 brand lines, 42/154 slug lines and
109/157 organization-or-host lines. The narrower organization-only search is
108/156. The lockfile has zero matches, so including it leaves these totals
unchanged. Searches exclude generated output, dependencies and task caches.
There are 440 distinct matching lines; the following classes explain every one.

| Permitted class | Distinct matching lines |
|---|---:|
| Root fork-provenance statement | 1 |
| Verbatim recorded external output / immutable corpus metadata | 79 |
| Historical coordination and handoff records | 161 |
| Historical ADR text | 11 |
| Source provenance references | 4 |
| Required license | 1 |
| Required notice | 4 |
| Third-party component attribution/license/contact | 153 |
| Protected migration-source specifications | 26 |

[The remaining-hit TSV](PHASE6-REMAINING-HITS.tsv) records each path, line,
matching searches, permitted class, reason and line hash. The linked full
artifact contains exact line text. The preservation proof confirms all 62
protected Git contents match the starting revision; the seven checkout EOL
differences are identified explicitly. No raw recording bytes were edited and
no daemon-injected recording replacements were needed.

### Boundary disclosures

Two violations occurred during this task:

1. Item 3 annotated some plain historical references beyond the allowed
   link-only changes. Item 7 restored the original bodies and retained only
   actual link repairs. Final historical diffs are limited to those repairs.
2. An inherited resolver test used a fixed POSIX-style path and created two
   empty Windows directories outside the repository:
   `C:\tmp\openpixo-test` and its `relative-data` child. The fixture now uses
   a managed temporary root with cleanup, and its focused check passes.
   The external empty directories were left untouched because further writes
   there are prohibited. [Read-only boundary evidence](../../.tmp/phase6-work/boundary-audit.json).

No global install/configuration change, live model/provider test, Electron
default-profile launch, installed-build operation, push or phase 7 guard work
occurred. Other task scratch stays under the authorized repository prefixes,
apart from the permitted tooling temporary files and normal package/builder
caches. Only task-owned lifecycles were stopped.

## Review corrections

Orchestrator review after `cb68a347` restored the upstream-host guards that
item 6 had removed as brand text. ADR 0005 and root `AGENTS.md` still require
that no build points at an upstream update feed:

- `apps/daemon/src/services/whats-new.ts` and
  `apps/desktop/src/main/updater/config.ts` reject upstream What's-new and
  update-feed hosts again; `tools/pack/src/config/index.ts` refuses to bake an
  upstream `PIXO_UPDATE_METADATA_URL`.
- `tools/release/src/openpixo/common.ts` (`allowedUrl`),
  `tools/release/src/site/cli.ts` (allowed hosts) and
  `tools/release/src/site/html.ts` (`safeLink`) reject upstream hosts again.
- The paired upstream-URL test cases in the daemon, desktop and tools-pack
  tests are restored. Their lines are added to
  [the remaining-hit TSV](PHASE6-REMAINING-HITS.tsv) as `upstream-host-guard`;
  phase 7's old-name check must allow this class.

The legacy upstream-marketplace migration, the store-card brand filter and the
changelog "inherited history" split stay removed: they only handled data or
content that no longer exists. The two empty directories under `C:	mp` created
by the resolver test were removed (the parent directory and its other files were
not touched).

Rerun: guard, typecheck, daemon/web/desktop/tools-pack builds, `pixo --help`
(no old names), the imported-game E2E, and the focused guard tests (daemon 33,
desktop 4, tools-pack 7, release 39) pass. Logs are under `.tmp/phase6-review/`.

## Execution ledger

Every logged validation, editing, build, browser and lifecycle attempt is listed
below, including baseline failures and corrected reruns. PASS/FAIL is the actual
process exit status. Read-only file/Git inspections are not validation commands.
The pinned repository toolchain is used by the task runner.

Exact structured [command journal](../../.tmp/phase6-work/commands.jsonl) and
[TSV command ledger](../../.tmp/phase6-work/verification-ledger.tsv) retain
timestamps and arguments. Some repeated labels append to the same log; their
individual timestamps and exit codes remain separate here.

Recorded attempts: 231; PASS 169; FAIL 62. Failed attempts are explained in the per-item and baseline sections.

| Attempt | Label | Result | Seconds | Exact command | Log |
|---:|---|---|---:|---|---|
| 1 | baseline-typecheck | PASS | 14.196 | `pnpm typecheck` | [log](../../.tmp/phase6-work/baseline-typecheck.log) |
| 2 | baseline-guard | PASS | 12.711 | `pnpm guard` | [log](../../.tmp/phase6-work/baseline-guard.log) |
| 3 | baseline-web-build | PASS | 15.409 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase6-work/baseline-web-build.log) |
| 4 | baseline-visual-start | PASS | 10.963 | `node .tmp/phase6-work/visual-runtime.ts start` | [log](../../.tmp/phase6-work/baseline-visual-start.log) |
| 5 | visual-start | PASS | 8.331 | `pnpm tools-dev start web --prod --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-start.log) |
| 6 | baseline-capture | FAIL | 31.604 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture.log) |
| 7 | baseline-capture-ready | PASS | 11.084 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture-ready.log) |
| 8 | baseline-capture-full | FAIL | 0.311 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture-full.log) |
| 9 | baseline-capture-full-ready | FAIL | 0.38 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture-full-ready.log) |
| 10 | baseline-capture-full-resolved | FAIL | 39.246 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture-full-resolved.log) |
| 11 | baseline-install | PASS | 40.962 | `pnpm --dir .tmp/phase6-baseline install --offline --config.confirmModulesPurge=false` | [log](../../.tmp/phase6-work/baseline-install.log) |
| 12 | item1-edit | FAIL | 0.218 | `node .tmp/phase6-work/item1.ts` | [log](../../.tmp/phase6-work/item1-edit.log) |
| 13 | item1-edit-resolved | PASS | 0.872 | `node .tmp/phase6-work/item1.ts --baseline` | [log](../../.tmp/phase6-work/item1-edit-resolved.log) |
| 14 | item1-followup | PASS | 0.475 | `node .tmp/phase6-work/item1-followup.ts` | [log](../../.tmp/phase6-work/item1-followup.log) |
| 15 | baseline-capture-complete | FAIL | 41.152 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture-complete.log) |
| 16 | item1-typecheck | FAIL | 5.362 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item1-typecheck.log) |
| 17 | item1-typecheck-fixed | FAIL | 6.89 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item1-typecheck-fixed.log) |
| 18 | item1-contracts-build | PASS | 1.076 | `pnpm --filter @openpixo/contracts build` | [log](../../.tmp/phase6-work/item1-contracts-build.log) |
| 19 | baseline-capture-catalog-ready | PASS | 25.304 | `node .tmp/phase6-work/capture.ts before` | [log](../../.tmp/phase6-work/baseline-capture-catalog-ready.log) |
| 20 | item1-remove-metadata | PASS | 0.309 | `node .tmp/phase6-work/item1-metadata.ts` | [log](../../.tmp/phase6-work/item1-remove-metadata.log) |
| 21 | item1-cleanup | PASS | 0.23 | `node .tmp/phase6-work/item1-cleanup.ts` | [log](../../.tmp/phase6-work/item1-cleanup.log) |
| 22 | baseline-visual-stop | PASS | 15.175 | `node .tmp/phase6-work/visual-runtime.ts stop` | [log](../../.tmp/phase6-work/baseline-visual-stop.log) |
| 23 | item1-guard | PASS | 9.32 | `pnpm guard` | [log](../../.tmp/phase6-work/item1-guard.log) |
| 24 | visual-stop | PASS | 14.998 | `pnpm tools-dev stop web --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-stop.log) |
| 25 | item1-build | PASS | 3.403 | `pnpm --filter @openpixo/contracts --filter @openpixo/plugin-runtime --filter @openpixo/daemon --workspace-concurrency=1 run build` | [log](../../.tmp/phase6-work/item1-build.log) |
| 26 | item1-web-tests | FAIL | 14.648 | `pnpm --filter @openpixo/web exec vitest run tests/components/EntrySettingsMenu.language.test.tsx tests/components/NextStepActions.test.tsx tests/components/AssistantMessage.nextStep.test.tsx tests/components/ChatPane.streaming.test.tsx tests/components/pluginFolderActions.test.ts tests/runtime/plugin-source.test.ts tests/state/projects.test.ts tests/i18n/locales.test.ts` | [log](../../.tmp/phase6-work/item1-web-tests.log) |
| 27 | item1-daemon-tests | PASS | 42.807 | `pnpm --filter @openpixo/daemon exec vitest run tests/plugins-headless-run.test.ts tests/plugins-publish.test.ts tests/plugins-bundled-scenarios-roster.test.ts tests/server-bootstrap-regression.test.ts tests/services/openpixo-network-defaults.test.ts tests/routes/social-share.test.ts` | [log](../../.tmp/phase6-work/item1-daemon-tests.log) |
| 28 | item1-typecheck-final | PASS | 16.765 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item1-typecheck-final.log) |
| 29 | item1-review-fixes | PASS | 0.202 | `node .tmp/phase6-work/item1-review-fixes.ts` | [log](../../.tmp/phase6-work/item1-review-fixes.log) |
| 30 | item1-stale-dist | PASS | 0.179 | `node .tmp/phase6-work/stale-dist.ts` | [log](../../.tmp/phase6-work/item1-stale-dist.log) |
| 31 | item1-web-build | PASS | 16.549 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase6-work/item1-web-build.log) |
| 32 | item1-web-focused-fixed | FAIL | 7.98 | `pnpm --filter @openpixo/web exec vitest run tests/runtime/plugin-source.test.ts tests/components/PrivacyConsentModal.test.tsx tests/components/chat/support-dialog-seam.test.tsx tests/components/ProjectView.retry-gating.test.tsx` | [log](../../.tmp/phase6-work/item1-web-focused-fixed.log) |
| 33 | item1-contracts-tests | PASS | 1.244 | `pnpm --filter @openpixo/contracts exec vitest run tests/social-share.test.ts tests/system-prompt.test.ts tests/scenario-defaults.test.ts` | [log](../../.tmp/phase6-work/item1-contracts-tests.log) |
| 34 | item1-web-final | PASS | 5.367 | `pnpm --filter @openpixo/web exec vitest run tests/runtime/plugin-source.test.ts tests/components/PrivacyConsentModal.test.tsx tests/components/chat/support-dialog-seam.test.tsx` | [log](../../.tmp/phase6-work/item1-web-final.log) |
| 35 | item1-ready-guard | PASS | 12.442 | `pnpm guard` | [log](../../.tmp/phase6-work/item1-ready-guard.log) |
| 36 | item1-ready-typecheck | PASS | 13.75 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item1-ready-typecheck.log) |
| 37 | item1-visual-start | PASS | 8.183 | `node .tmp/phase6-work/visual-runtime.ts start` | [log](../../.tmp/phase6-work/item1-visual-start.log) |
| 38 | visual-start | PASS | 7.925 | `pnpm tools-dev start web --prod --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-start.log) |
| 39 | item1-visual-audit | FAIL | 26.507 | `node .tmp/phase6-work/capture.ts after-item1` | [log](../../.tmp/phase6-work/item1-visual-audit.log) |
| 40 | item1-visual-stop | PASS | 14.867 | `node .tmp/phase6-work/visual-runtime.ts stop` | [log](../../.tmp/phase6-work/item1-visual-stop.log) |
| 41 | visual-stop | PASS | 14.63 | `pnpm tools-dev stop web --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-stop.log) |
| 42 | item2-core | PASS | 0.763 | `node .tmp/phase6-work/item2-core.ts` | [log](../../.tmp/phase6-work/item2-core.log) |
| 43 | item2-assets | PASS | 7.512 | `node .tmp/phase6-work/item2-assets.ts` | [log](../../.tmp/phase6-work/item2-assets.log) |
| 44 | item2-shared-build | PASS | 2.86 | `pnpm --filter @openpixo/contracts --filter @openpixo/plugin-runtime --workspace-concurrency=1 run build` | [log](../../.tmp/phase6-work/item2-shared-build.log) |
| 45 | item2-tests-edit | PASS | 0.222 | `node .tmp/phase6-work/item2-tests.ts` | [log](../../.tmp/phase6-work/item2-tests-edit.log) |
| 46 | item2-typecheck | FAIL | 14.415 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item2-typecheck.log) |
| 47 | item2-guard | PASS | 57.725 | `pnpm guard` | [log](../../.tmp/phase6-work/item2-guard.log) |
| 48 | item2-test-updates | PASS | 0.201 | `node .tmp/phase6-work/item2-test-updates.ts` | [log](../../.tmp/phase6-work/item2-test-updates.log) |
| 49 | item2-daemon-focused | FAIL | 12.423 | `pnpm --filter @openpixo/daemon exec vitest run tests/plugin-preview-bakes.test.ts tests/plugins-marketplaces.test.ts tests/integrations/telemetry-relay.test.ts tests/attribution.test.ts tests/runtimes/metadata.test.ts tests/services/openpixo-network-defaults.test.ts` | [log](../../.tmp/phase6-work/item2-daemon-focused.log) |
| 50 | item2-typecheck-fixed | FAIL | 8.84 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item2-typecheck-fixed.log) |
| 51 | item2-release-focused | FAIL | 44.765 | `pnpm --filter @openpixo/tools-release exec vitest run tests/catalog-export.test.ts tests/catalog-pack.test.ts tests/dsh-bootstrap-bundle.test.ts --testTimeout=20000` | [log](../../.tmp/phase6-work/item2-release-focused.log) |
| 52 | item2-final-tests-edit | PASS | 0.215 | `node .tmp/phase6-work/item2-final-tests.ts` | [log](../../.tmp/phase6-work/item2-final-tests-edit.log) |
| 53 | item2-web-tests | FAIL | 29.377 | `pnpm --filter @openpixo/web exec vitest run tests/components/QuestionForm.test.tsx tests/components/QuestionForm.direction-cards-catalog.test.tsx tests/components/QuestionForm.deck-batch.test.tsx tests/components/chat/question-form-answered-surface.test.tsx tests/components/PluginShareMenu.test.tsx tests/first-party-external-link.test.ts` | [log](../../.tmp/phase6-work/item2-web-tests.log) |
| 54 | item2-desktop-tests | PASS | 1.544 | `pnpm --filter @openpixo/desktop exec vitest run tests/main/renderer-crash-loop.test.ts tests/main/mailto-open.test.ts` | [log](../../.tmp/phase6-work/item2-desktop-tests.log) |
| 55 | item2-tar-baseline | FAIL | 11.484 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/tools-release exec vitest run tests/catalog-pack.test.ts -t 'writes checksums' --testTimeout=20000` | [log](../../.tmp/phase6-work/item2-tar-baseline.log) |
| 56 | item2-daemon-fixed | PASS | 1.518 | `pnpm --filter @openpixo/daemon exec vitest run tests/attribution.test.ts tests/plugin-preview-bakes.test.ts` | [log](../../.tmp/phase6-work/item2-daemon-fixed.log) |
| 57 | item2-release-local-tar | PASS | 1.563 | `pnpm --filter @openpixo/tools-release exec vitest run tests/catalog-export.test.ts tests/catalog-pack.test.ts tests/dsh-bootstrap-bundle.test.ts --testTimeout=20000` | [log](../../.tmp/phase6-work/item2-release-local-tar.log) |
| 58 | item2-web-fixed | PASS | 7.574 | `pnpm --filter @openpixo/web exec vitest run tests/first-party-external-link.test.ts tests/components/PluginShareMenu.test.tsx tests/components/QuestionForm.test.tsx tests/components/QuestionForm.direction-cards-catalog.test.tsx tests/components/chat/question-form-answered-surface.test.tsx` | [log](../../.tmp/phase6-work/item2-web-fixed.log) |
| 59 | item2-typecheck-final | PASS | 14.679 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item2-typecheck-final.log) |
| 60 | item2-contract-links | PASS | 1.26 | `pnpm --filter @openpixo/contracts exec vitest run tests/plugin-url.test.ts` | [log](../../.tmp/phase6-work/item2-contract-links.log) |
| 61 | item2-serve-bootstrap | PASS | 2.454 | `pnpm --filter @openpixo/tools-serve exec vitest run tests/dsh-bootstrap-publish.test.ts` | [log](../../.tmp/phase6-work/item2-serve-bootstrap.log) |
| 62 | item2-consumed-build | PASS | 2.68 | `pnpm --filter @openpixo/daemon --filter @openpixo/tools-release --filter @openpixo/tools-pack --filter @openpixo/tools-serve build` | [log](../../.tmp/phase6-work/item2-consumed-build.log) |
| 63 | item2-final-guard | PASS | 16.831 | `pnpm guard` | [log](../../.tmp/phase6-work/item2-final-guard.log) |
| 64 | item2-final-typecheck | PASS | 16.484 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item2-final-typecheck.log) |
| 65 | item2-web-build | PASS | 30.726 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase6-work/item2-web-build.log) |
| 66 | item2-asset-runtime | PASS | 26.048 | `node .tmp/phase6-work/visual-runtime.ts start` | [log](../../.tmp/phase6-work/item2-asset-runtime.log) |
| 67 | visual-start | PASS | 25.607 | `pnpm tools-dev start web --prod --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-start.log) |
| 68 | item2-local-assets | PASS | 1.853 | `node .tmp/phase6-work/asset-proof.ts` | [log](../../.tmp/phase6-work/item2-local-assets.log) |
| 69 | item2-feed-tests | PASS | 0.901 | `pnpm --filter @openpixo/daemon exec vitest run tests/whats-new.test.ts` | [log](../../.tmp/phase6-work/item2-feed-tests.log) |
| 70 | item2-empty-highlight-guard | PASS | 10.807 | `pnpm guard` | [log](../../.tmp/phase6-work/item2-empty-highlight-guard.log) |
| 71 | item2-stop | PASS | 13.081 | `node .tmp/phase6-work/visual-runtime.ts stop` | [log](../../.tmp/phase6-work/item2-stop.log) |
| 72 | visual-stop | PASS | 12.921 | `pnpm tools-dev stop web --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-stop.log) |
| 73 | item3-document-preflight | PASS | 9.399 | `node .tmp/phase6-work/docs-inventory.ts` | [log](../../.tmp/phase6-work/item3-document-preflight.log) |
| 74 | item3-delete-documents | PASS | 9.112 | `node .tmp/phase6-work/docs-delete.ts` | [log](../../.tmp/phase6-work/item3-delete-documents.log) |
| 75 | item3-guard | PASS | 10.186 | `pnpm guard` | [log](../../.tmp/phase6-work/item3-guard.log) |
| 76 | item3-typecheck | PASS | 12.086 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item3-typecheck.log) |
| 77 | item3-scope-tests | FAIL | 2.24 | `pnpm --filter @openpixo/e2e exec vitest run tests/scripts/scopes.test.ts` | [log](../../.tmp/phase6-work/item3-scope-tests.log) |
| 78 | item3-python-baseline | FAIL | 1.013 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/e2e exec vitest run tests/scripts/scopes.test.ts -t 'routes representative PR changes'` | [log](../../.tmp/phase6-work/item3-python-baseline.log) |
| 79 | item3-scope-python | FAIL | 6.327 | `pnpm --filter @openpixo/e2e exec vitest run tests/scripts/scopes.test.ts` | [log](../../.tmp/phase6-work/item3-scope-python.log) |
| 80 | item3-scope-tests-final | PASS | 6.446 | `pnpm --filter @openpixo/e2e exec vitest run tests/scripts/scopes.test.ts` | [log](../../.tmp/phase6-work/item3-scope-tests-final.log) |
| 81 | item3-packaged-scope-fixture | PASS | 3.419 | `pnpm --filter @openpixo/e2e exec vitest run tests/packaged-smoke-workflow.test.ts -t 'skips the critical fallback for pure packaged-leaf changes'` | [log](../../.tmp/phase6-work/item3-packaged-scope-fixture.log) |
| 82 | item3-consumed-build | PASS | 1.994 | `pnpm --filter @openpixo/daemon build` | [log](../../.tmp/phase6-work/item3-consumed-build.log) |
| 83 | item4-edit-ui | PASS | 1.726 | `node .tmp/phase6-work/item4-ui.ts` | [log](../../.tmp/phase6-work/item4-edit-ui.log) |
| 84 | item4-typecheck | PASS | 13.594 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item4-typecheck.log) |
| 85 | item4-locale-tests | PASS | 4.531 | `pnpm --filter @openpixo/web exec vitest run tests/i18n/locales.test.ts` | [log](../../.tmp/phase6-work/item4-locale-tests.log) |
| 86 | item4-close-ui | PASS | 0.92 | `node .tmp/phase6-work/item4-close.ts` | [log](../../.tmp/phase6-work/item4-close-ui.log) |
| 87 | item4-web-focused | FAIL | 6.319 | `pnpm --filter @openpixo/web exec vitest run tests/i18n/locales.test.ts tests/components/PluginDetailView.curated-layout.test.tsx tests/components/PluginDetailView.use-handoff.test.tsx tests/components/NewProjectPanel.test.tsx tests/components/plugins-home-motion-templates.test.ts tests/runtime/exports.test.ts tests/lib/build-clipboard-prompt.test.ts` | [log](../../.tmp/phase6-work/item4-web-focused.log) |
| 88 | item4-guard | PASS | 8.568 | `pnpm guard` | [log](../../.tmp/phase6-work/item4-guard.log) |
| 89 | item4-desktop-focused | PASS | 1.44 | `pnpm --filter @openpixo/desktop exec vitest run tests/main/update-menu.test.ts tests/main/update-preflight.test.ts tests/main/renderer-crash-loop.test.ts tests/main/diagnostics-save-dialog.test.ts` | [log](../../.tmp/phase6-work/item4-desktop-focused.log) |
| 90 | item4-web-layout-fixed | PASS | 4.46 | `pnpm --filter @openpixo/web exec vitest run tests/components/PluginDetailView.curated-layout.test.tsx` | [log](../../.tmp/phase6-work/item4-web-layout-fixed.log) |
| 91 | item4-web-build | PASS | 14.031 | `pnpm --filter @openpixo/web build` | [log](../../.tmp/phase6-work/item4-web-build.log) |
| 92 | item4-start-runtime | PASS | 8.995 | `node .tmp/phase6-work/visual-runtime.ts start` | [log](../../.tmp/phase6-work/item4-start-runtime.log) |
| 93 | visual-start | PASS | 8.73 | `pnpm tools-dev start web --prod --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-start.log) |
| 94 | item4-visible-text | FAIL | 27.514 | `node .tmp/phase6-work/capture.ts after-item4` | [log](../../.tmp/phase6-work/item4-visible-text.log) |
| 95 | item4-clean-replay | PASS | 1.107 | `node .tmp/phase6-work/clean-visual-conversation.ts` | [log](../../.tmp/phase6-work/item4-clean-replay.log) |
| 96 | item4-visible-text-clean | PASS | 27.891 | `node .tmp/phase6-work/capture.ts after-item4-clean` | [log](../../.tmp/phase6-work/item4-visible-text-clean.log) |
| 97 | item4-entry-proof | PASS | 5.051 | `node .tmp/phase6-work/feature-entry-capture.ts` | [log](../../.tmp/phase6-work/item4-entry-proof.log) |
| 98 | item4-all-changed-web-tests | FAIL | 51.178 | `pnpm --filter @openpixo/web exec vitest run tests/analytics-session-replay.test.ts tests/analytics/error-tracking.test.ts tests/artifacts/internal-markers.test.ts tests/artifacts/version-origin.test.ts tests/comments.test.ts tests/community-view.test.tsx tests/components/App.project-create-race.test.tsx tests/components/App.update-dialog.test.tsx tests/components/AssistantMessage.linkClick.test.tsx tests/components/AssistantMessage.test.tsx tests/components/AvatarMenu.test.tsx tests/components/ChatComposer.clear-on-send.test.tsx tests/components/ChatPane.error-card-invalid-api-key.test.tsx tests/components/ChatPane.error-card-ladder.test.tsx tests/components/ChatPane.run-error-copy-from-spec.test.tsx tests/components/ChatPane.streaming.test.tsx tests/components/ConnectorsBrowser.test.tsx tests/components/DesignBrowserPanel.test.tsx tests/components/EntryNavRail.updater-after-avatar.test.tsx tests/components/EntryShell.onboarding.test.tsx tests/components/ExamplesTab.test.tsx tests/components/ExtensionsMarketplace.plugin-detail-entry.test.tsx tests/components/FileViewer.srcdoc-refresh-recovery.test.tsx tests/components/FileViewer.test.tsx tests/components/HandoffButton.fallback-reveal.test.tsx tests/components/HomeView.opend-2849-round4-copy.test.tsx tests/components/HomeView.prefill.test.tsx tests/components/HomeView.web-clone-tracking.test.tsx tests/components/MemorySection.test.tsx tests/components/PluginDetailView.curated-layout.test.tsx tests/components/PluginDetailsModal.dispatch.test.tsx tests/components/PluginsView.test.tsx tests/components/ProjectView.artifact-cover-late-arrival.test.tsx tests/components/ProjectView.comment-release-before-run.test.tsx tests/components/ProjectView.retry-gating.test.tsx tests/components/ProjectView.run-isolation.test.tsx tests/components/ProjectView.run-workspace-identity.test.tsx tests/components/SettingsDialog.execution.test.tsx tests/components/SettingsDialog.test.ts tests/components/SketchEditor.save.test.tsx tests/components/ToolCard.disclosure.test.tsx tests/components/UpdaterPopup.rocket-indicator.test.tsx tests/components/UpdaterPopup.test.tsx tests/components/UserActionCard.test.tsx tests/components/WorkspaceTabsBar.test.tsx tests/components/chat/anchored-menu-shell.test.tsx tests/components/chat/mirror-gallery.test.tsx tests/components/chat/question-form-option-desc-wrap.test.tsx tests/components/chat/s01-s02-s04-error-card-titles.test.tsx tests/components/chat/turn-boundary-spacing.test.tsx tests/components/chat/typography-baseline.test.ts tests/components/home-hero/plugin-authoring-prompt.test.ts tests/components/home-logo-assets.test.ts tests/components/plugins-home-motion-templates.test.ts tests/components/template-preview-escape.test.tsx tests/components/use-everywhere-agent-guide.test.ts tests/components/use-everywhere-copy-guide.test.tsx tests/i18n/opend-2849-round4-copy.test.ts tests/i18n/opend-2849-s26-s31-copy.test.ts tests/lib/updater.test.ts tests/observability/white-screen.test.ts tests/providers/registry.test.ts tests/providers/sse.test.ts tests/runtime/in-project-link.test.ts tests/runtime/markdown.test.tsx tests/runtime/sign-in-title-split.test.ts` | [log](../../.tmp/phase6-work/item4-all-changed-web-tests.log) |
| 99 | item4-final-guard | PASS | 19.24 | `pnpm guard` | [log](../../.tmp/phase6-work/item4-final-guard.log) |
| 100 | item4-final-typecheck | PASS | 21.778 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item4-final-typecheck.log) |
| 101 | item4-consumed-build | PASS | 0.914 | `pnpm --filter @openpixo/packaged --filter @openpixo/desktop build` | [log](../../.tmp/phase6-work/item4-consumed-build.log) |
| 102 | item4-obsolete-i18n-baseline | FAIL | 3.708 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/web exec vitest run tests/i18n/opend-2849-round4-copy.test.ts tests/i18n/opend-2849-s26-s31-copy.test.ts` | [log](../../.tmp/phase6-work/item4-obsolete-i18n-baseline.log) |
| 103 | item4-test-repairs | FAIL | 7.165 | `pnpm --filter @openpixo/web exec vitest run tests/community-view.test.tsx tests/i18n/opend-2849-round4-copy.test.ts tests/i18n/opend-2849-s26-s31-copy.test.ts tests/components/AssistantMessage.test.tsx tests/components/HomeView.web-clone-tracking.test.tsx tests/components/PluginDetailsModal.dispatch.test.tsx tests/components/home-hero/plugin-authoring-prompt.test.ts` | [log](../../.tmp/phase6-work/item4-test-repairs.log) |
| 104 | item4-assistant-fallback | FAIL | 6.744 | `pnpm --filter @openpixo/web exec vitest run tests/components/AssistantMessage.test.tsx` | [log](../../.tmp/phase6-work/item4-assistant-fallback.log) |
| 105 | item4-assistant-final | PASS | 8.39 | `pnpm --filter @openpixo/web exec vitest run tests/components/AssistantMessage.test.tsx` | [log](../../.tmp/phase6-work/item4-assistant-final.log) |
| 106 | item4-commit-typecheck | PASS | 14.267 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item4-commit-typecheck.log) |
| 107 | item4-commit-guard | PASS | 12.838 | `pnpm guard` | [log](../../.tmp/phase6-work/item4-commit-guard.log) |
| 108 | item4-stop-runtime | PASS | 16.501 | `node .tmp/phase6-work/visual-runtime.ts stop` | [log](../../.tmp/phase6-work/item4-stop-runtime.log) |
| 109 | visual-stop | PASS | 16.256 | `pnpm tools-dev stop web --namespace phase6visual --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-visual\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/visual-stop.log) |
| 110 | item5-naming | PASS | 4.231 | `node .tmp/phase6-work/item5-content.ts` | [log](../../.tmp/phase6-work/item5-naming.log) |
| 111 | item5-case-preserving | PASS | 34.858 | `node .tmp/phase6-work/item5-content.ts --from-head` | [log](../../.tmp/phase6-work/item5-case-preserving.log) |
| 112 | item5-daemon-prompts | FAIL | 5.999 | `pnpm --filter @openpixo/daemon exec vitest run tests/prompts tests/official-system-prompt.test.ts tests/system-prompt-template.test.ts tests/critique-panel-prompt.test.ts tests/plugins-bundled-atom-prompts-default.test.ts` | [log](../../.tmp/phase6-work/item5-daemon-prompts.log) |
| 113 | item5-contract-prompts | FAIL | 1.275 | `pnpm --filter @openpixo/contracts exec vitest run tests/system-prompt.test.ts tests/system-prompt-api-mode.test.ts tests/system-prompt-audio-voices.test.ts tests/system-prompt-metadata-block.test.ts tests/system-prompt-web-clone.test.ts tests/official-system-prompt.test.ts tests/openpixo-game-prompt.test.ts tests/plugins-manifest.test.ts` | [log](../../.tmp/phase6-work/item5-contract-prompts.log) |
| 114 | item5-matrix-baseline | FAIL | 1.485 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/daemon exec vitest run tests/prompts/system-prompt-matrix.test.ts` | [log](../../.tmp/phase6-work/item5-matrix-baseline.log) |
| 115 | item5-matrix-refresh | PASS | 1.247 | `pnpm --filter @openpixo/daemon exec vitest run tests/prompts/system-prompt-matrix.test.ts --update` | [log](../../.tmp/phase6-work/item5-matrix-refresh.log) |
| 116 | item5-daemon-prompts-final | FAIL | 7.218 | `pnpm --filter @openpixo/daemon exec vitest run tests/prompts tests/official-system-prompt.test.ts tests/system-prompt-template.test.ts tests/critique-panel-prompt.test.ts tests/plugins-bundled-atom-prompts-default.test.ts tests/prompt-templates.test.ts tests/craft.test.ts tests/plugins-context-craft.test.ts tests/motion-skills-catalog.test.ts` | [log](../../.tmp/phase6-work/item5-daemon-prompts-final.log) |
| 117 | item5-contract-prompts-final | PASS | 1.211 | `pnpm --filter @openpixo/contracts exec vitest run tests/system-prompt.test.ts tests/system-prompt-api-mode.test.ts tests/system-prompt-audio-voices.test.ts tests/system-prompt-metadata-block.test.ts tests/system-prompt-web-clone.test.ts tests/official-system-prompt.test.ts tests/openpixo-game-prompt.test.ts tests/plugins-manifest.test.ts` | [log](../../.tmp/phase6-work/item5-contract-prompts-final.log) |
| 118 | item5-guard | PASS | 12.11 | `pnpm guard` | [log](../../.tmp/phase6-work/item5-guard.log) |
| 119 | item5-motion-baseline | FAIL | 2.093 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/daemon exec vitest run tests/motion-skills-catalog.test.ts -t 'loads pure geometry'` | [log](../../.tmp/phase6-work/item5-motion-baseline.log) |
| 120 | item5-craft-baseline | FAIL | 0.999 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/daemon exec vitest run tests/craft.test.ts -t 'preserves declarations'` | [log](../../.tmp/phase6-work/item5-craft-baseline.log) |
| 121 | item5-motion-final | PASS | 1.12 | `pnpm --filter @openpixo/daemon exec vitest run tests/motion-skills-catalog.test.ts` | [log](../../.tmp/phase6-work/item5-motion-final.log) |
| 122 | item5-focused-final | PASS | 3.25 | `pnpm --filter @openpixo/daemon exec vitest run tests/prompts/game-media-contract.test.ts tests/prompts/host-failure-narration.test.ts tests/prompts/system-prompt-matrix.test.ts tests/craft.test.ts tests/motion-skills-catalog.test.ts tests/skill-catalog.test.ts tests/plugins-bundled-scenarios-roster.test.ts` | [log](../../.tmp/phase6-work/item5-focused-final.log) |
| 123 | item5-typecheck | PASS | 13.523 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item5-typecheck.log) |
| 124 | item5-web-authoring | PASS | 2.123 | `pnpm --filter @openpixo/web exec vitest run tests/components/home-hero/plugin-authoring-prompt.test.ts` | [log](../../.tmp/phase6-work/item5-web-authoring.log) |
| 125 | item5-consumed-build | PASS | 17.924 | `pnpm --filter @openpixo/daemon --filter @openpixo/web build` | [log](../../.tmp/phase6-work/item5-consumed-build.log) |
| 126 | item6-explicit-boundaries | PASS | 0.582 | `node .tmp/phase6-work/item6-pre.ts` | [log](../../.tmp/phase6-work/item6-explicit-boundaries.log) |
| 127 | item6-code-copy | PASS | 22.377 | `node .tmp/phase6-work/item6-code.ts` | [log](../../.tmp/phase6-work/item6-code-copy.log) |
| 128 | item6-install | FAIL | 17.245 | `pnpm install --config.confirmModulesPurge=false` | [log](../../.tmp/phase6-work/item6-install.log) |
| 129 | item6-install-retry | PASS | 15.697 | `pnpm install --config.confirmModulesPurge=false` | [log](../../.tmp/phase6-work/item6-install-retry.log) |
| 130 | item6-typecheck | FAIL | 20.092 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item6-typecheck.log) |
| 131 | item6-guard | PASS | 20.715 | `pnpm guard` | [log](../../.tmp/phase6-work/item6-guard.log) |
| 132 | item6-daemon-focused | PASS | 90.475 | `pnpm --filter @openpixo/daemon exec vitest run tests/deploy.test.ts tests/deploy-routes.test.ts tests/routes/projects.test.ts tests/whats-new.test.ts tests/server-bootstrap-regression.test.ts tests/plugins-marketplaces.test.ts tests/server-paths.test.ts tests/cli-phase2c.test.ts tests/home-expansion.test.ts tests/diagnostics-export.test.ts tests/library-ingest-concurrent-hash-race.test.ts tests/runtimes/agent-runtime-env.test.ts` | [log](../../.tmp/phase6-work/item6-daemon-focused.log) |
| 133 | item6-release-focused | FAIL | 4.746 | `pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts tests/openpixo-release.test.ts tests/channel-prepare.test.ts tests/prerelease-card.test.ts tests/prerelease-card-rerun.test.ts tests/release-metadata.test.ts` | [log](../../.tmp/phase6-work/item6-release-focused.log) |
| 134 | item6-desktop-focused | PASS | 1.582 | `pnpm --filter @openpixo/desktop exec vitest run tests/main/fork-updater-config.test.ts tests/main/mailto-open.test.ts tests/main/export-title-replacement-patterns.test.ts tests/main/updater/payload-running.test.ts tests/main/updater/scheduler.test.ts` | [log](../../.tmp/phase6-work/item6-desktop-focused.log) |
| 135 | item6-release-channel-baseline | FAIL | 5.19 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/tools-release exec vitest run tests/channel-prepare.test.ts` | [log](../../.tmp/phase6-work/item6-release-channel-baseline.log) |
| 136 | item6-site-snapshots | PASS | 2.025 | `pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts -u` | [log](../../.tmp/phase6-work/item6-site-snapshots.log) |
| 137 | item6-pack-focused | PASS | 5.137 | `pnpm --filter @openpixo/tools-pack exec vitest run tests/config/config.test.ts tests/config/update-metadata-url.test.ts tests/resources/runtime-manifest.test.ts tests/win-builder.test.ts tests/win-resources.test.ts tests/win-nsis.test.ts tests/launcher/shared/layout.test.ts tests/mac-identity.test.ts tests/mac-paths.test.ts` | [log](../../.tmp/phase6-work/item6-pack-focused.log) |
| 138 | item6-packaged-focused | FAIL | 2.724 | `pnpm --filter @openpixo/packaged exec vitest run tests/protocol.test.ts tests/source-origins.test.ts tests/sidecars.test.ts tests/config.test.ts tests/paths.test.ts tests/download-attribution.test.ts tests/prewarm.test.ts tests/startup-telemetry.test.ts` | [log](../../.tmp/phase6-work/item6-packaged-focused.log) |
| 139 | item6-typecheck-retry | PASS | 14.393 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item6-typecheck-retry.log) |
| 140 | item6-packaged-prewarm-baseline | FAIL | 1.165 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/packaged exec vitest run tests/prewarm.test.ts` | [log](../../.tmp/phase6-work/item6-packaged-prewarm-baseline.log) |
| 141 | item6-release-identity | PASS | 0.978 | `pnpm --filter @openpixo/release exec vitest run tests/index.test.ts` | [log](../../.tmp/phase6-work/item6-release-identity.log) |
| 142 | item6-serve | PASS | 5.67 | `pnpm --filter @openpixo/tools-serve exec vitest run tests/updater-fixture.test.ts tests/beta-version-reservation.test.ts tests/release-metadata-publish.test.ts` | [log](../../.tmp/phase6-work/item6-serve.log) |
| 143 | item6-download | PASS | 1.912 | `pnpm --filter @openpixo/download exec vitest run tests/index.test.ts` | [log](../../.tmp/phase6-work/item6-download.log) |
| 144 | item6-consumed-build | PASS | 30.447 | `pnpm --filter @openpixo/daemon --filter @openpixo/web --filter @openpixo/desktop --filter @openpixo/packaged --filter @openpixo/tools-dev --filter @openpixo/tools-pack --filter @openpixo/components build` | [log](../../.tmp/phase6-work/item6-consumed-build.log) |
| 145 | item6-adapter-tests | FAIL | 332.771 | `pnpm --filter @openpixo/host --filter @openpixo/sidecar --filter @openpixo/sidecar-proto --filter @openpixo/launcher-proto --filter @openpixo/plugin-runtime --filter @openpixo/agui-adapter --filter @openpixo/dsh-runtime exec vitest run` | [log](../../.tmp/phase6-work/item6-adapter-tests.log) |
| 146 | item6-web-changed | FAIL | 71.774 | `pnpm --filter @openpixo/web exec vitest run tests/artifacts/markdown.test.ts tests/components/App.update-dialog.test.tsx tests/components/AssistantMessage.hidden-extra-ui.test.tsx tests/components/AssistantMessage.linkClick.test.tsx tests/components/AssistantMessage.system-copy-i18n.test.tsx tests/components/AssistantMessage.test.tsx tests/components/ChatComposer.context-pickers.test.tsx tests/components/ChatPane.streaming.test.tsx tests/components/ContextChipHoverCard.test.tsx tests/components/DesignBrowserPanel.test.tsx tests/components/DesignFilesPanel.test.tsx tests/components/EntryNavRail.updater-after-avatar.test.tsx tests/components/EntryShell.onboarding.test.tsx tests/components/ExtensionsMarketplace.plugin-detail-entry.test.tsx tests/components/FileViewer.test.tsx tests/components/FileWorkspace.test.tsx tests/components/HandoffButton.fallback-reveal.test.tsx tests/components/HomeView.context-picker.test.tsx tests/components/HomeView.media-options.test.tsx tests/components/MarketplaceView.test.tsx tests/components/PluginDetailView.curated-layout.test.tsx tests/components/PluginExampleDetail.unavailable-noun.test.tsx tests/components/PluginsView.test.tsx tests/components/ProjectReferenceModal.test.tsx tests/components/ProjectView.artifact-cover-late-arrival.test.tsx tests/components/ProjectView.pendingPrompt.test.tsx tests/components/SettingsDialog.execution.test.tsx tests/components/SettingsDialog.test.ts tests/components/SketchEditor.save.test.tsx tests/components/ToolCard.disclosure.test.tsx tests/components/UpdateDialog.test.tsx tests/components/UpdaterPopup.rocket-indicator.test.tsx tests/components/UpdaterPopup.test.tsx tests/components/WhatsNewPopup.test.tsx tests/components/assistant-message-tool-status.test.tsx tests/components/auto-open-file.test.ts tests/components/chat/mirror-gallery.test.tsx tests/components/examples-tab-preview-dispatch.test.tsx tests/components/examples-tab-retry.test.tsx tests/components/home-hero/plugin-authoring-prompt.test.ts tests/components/preview-modal-error-state.test.tsx tests/components/preview-modal-fullscreen.test.tsx tests/components/preview-modal-unavailable-state.test.tsx tests/components/sketch-model.test.ts tests/edit-mode/source-patches.test.ts tests/lib/updater.test.ts tests/providers/registry.test.ts tests/providers/sse.test.ts tests/runtime/chat/w93-2594-todo-snapshot-replace.test.ts tests/runtime/exports.test.ts tests/runtime/in-project-link.test.ts tests/runtime/srcdoc-bridge-empty-targets.test.ts tests/runtime/srcdoc-deck-bridge-nested-slides.test.ts tests/runtime/srcdoc-palette-css-vars.test.ts tests/runtime/srcdoc-redirect-guard.test.ts tests/runtime/srcdoc.test.ts tests/sidecar-proxy.test.ts` | [log](../../.tmp/phase6-work/item6-web-changed.log) |
| 147 | item6-contracts-focused | FAIL | 3.047 | `pnpm --filter @openpixo/contracts exec vitest run tests/brief.test.ts tests/plugins-manifest.test.ts tests/runtime/html-injection-points.test.ts tests/runtime/preview-isolation.test.ts` | [log](../../.tmp/phase6-work/item6-contracts-focused.log) |
| 148 | item6-release-final | PASS | 1.677 | `pnpm --filter @openpixo/tools-release exec vitest run tests/site.test.ts tests/openpixo-release.test.ts tests/prerelease-card.test.ts tests/prerelease-card-rerun.test.ts tests/prerelease-fallback-notice-cli.test.ts` | [log](../../.tmp/phase6-work/item6-release-final.log) |
| 149 | item6-contracts-retry | PASS | 2.245 | `pnpm --filter @openpixo/contracts exec vitest run tests/brief.test.ts tests/plugins-manifest.test.ts` | [log](../../.tmp/phase6-work/item6-contracts-retry.log) |
| 150 | item6-web-repaired | PASS | 36.615 | `pnpm --filter @openpixo/web exec vitest run tests/components/FileWorkspace.test.tsx tests/components/sketch-model.test.ts tests/components/MarketplaceView.test.tsx tests/components/SettingsDialog.execution.test.tsx` | [log](../../.tmp/phase6-work/item6-web-repaired.log) |
| 151 | item6-daemon-rebuild | PASS | 2.404 | `pnpm --filter @openpixo/daemon build` | [log](../../.tmp/phase6-work/item6-daemon-rebuild.log) |
| 152 | item6-cli-help | FAIL | 13.703 | `node .tmp/phase6-work/cli-help.ts` | [log](../../.tmp/phase6-work/item6-cli-help.log) |
| 153 | item6-sidecar-baseline | FAIL | 302.984 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/sidecar exec vitest run tests/convergence.test.ts` | [log](../../.tmp/phase6-work/item6-sidecar-baseline.log) |
| 154 | item6-final-guard | PASS | 13.632 | `pnpm guard` | [log](../../.tmp/phase6-work/item6-final-guard.log) |
| 155 | item6-final-typecheck | PASS | 15.908 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item6-final-typecheck.log) |
| 156 | item6-cli-final-build | PASS | 2.714 | `pnpm --filter @openpixo/daemon build` | [log](../../.tmp/phase6-work/item6-cli-final-build.log) |
| 157 | item6-cli-help-final | PASS | 13.872 | `node .tmp/phase6-work/cli-help.ts` | [log](../../.tmp/phase6-work/item6-cli-help-final.log) |
| 158 | item6-help-and-logs-tests | FAIL | 30.895 | `pnpm --filter @openpixo/daemon exec vitest run tests/artifacts-cli.test.ts tests/daemon-health.test.ts tests/cli-phase2c.test.ts tests/whats-new.test.ts tests/deploy-routes.test.ts` | [log](../../.tmp/phase6-work/item6-help-and-logs-tests.log) |
| 159 | item6-health-baseline | FAIL | 1.555 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/daemon exec vitest run tests/daemon-health.test.ts` | [log](../../.tmp/phase6-work/item6-health-baseline.log) |
| 160 | item7-document-copy | PASS | 15.996 | `node .tmp/phase6-work/item7-docs.ts` | [log](../../.tmp/phase6-work/item7-document-copy.log) |
| 161 | item7-guides | PASS | 0.199 | `node .tmp/phase6-work/item7-guides.ts` | [log](../../.tmp/phase6-work/item7-guides.log) |
| 162 | item7-ci-copy | PASS | 0.313 | `node .tmp/phase6-work/item7-ci.ts` | [log](../../.tmp/phase6-work/item7-ci-copy.log) |
| 163 | item7-document-close | FAIL | 0.542 | `node .tmp/phase6-work/item7-doc-close.ts` | [log](../../.tmp/phase6-work/item7-document-close.log) |
| 164 | item7-document-close-retry | PASS | 0.75 | `node .tmp/phase6-work/item7-doc-close.ts` | [log](../../.tmp/phase6-work/item7-document-close-retry.log) |
| 165 | item7-author-guides | PASS | 0.073 | `node .tmp/phase6-work/item7-author-guides.ts` | [log](../../.tmp/phase6-work/item7-author-guides.log) |
| 166 | item7-handoff-self-check | PASS | 0.169 | `C:/Python313/python.exe .github/scripts/handoff.py self-check` | [log](../../.tmp/phase6-work/item7-handoff-self-check.log) |
| 167 | item7-convergence-validate | PASS | 2.6 | `C:/Python313/python.exe .github/scripts/convergence.py validate` | [log](../../.tmp/phase6-work/item7-convergence-validate.log) |
| 168 | item7-ci-focused | FAIL | 11.037 | `pnpm --filter @openpixo/e2e exec vitest run tests/actions-cache-workflows.test.ts tests/packaged-smoke-workflow.test.ts tests/scripts/convergence.test.ts tests/scripts/bump-policy.test.ts tests/scripts/resolve-patch-cut.test.ts tests/scripts/handoff.test.ts tests/scripts/rerun-infra-cancel.test.ts tests/scripts/scopes.test.ts tests/scripts/stable-docker.test.ts tests/scripts/smoke-artifacts.test.ts tests/scripts/release-notification.test.ts` | [log](../../.tmp/phase6-work/item7-ci-focused.log) |
| 169 | item7-document-semantics | PASS | 0.467 | `node .tmp/phase6-work/item7-semantic.ts` | [log](../../.tmp/phase6-work/item7-document-semantics.log) |
| 170 | item7-ci-baseline | FAIL | 8.714 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/e2e exec vitest run tests/packaged-smoke-workflow.test.ts tests/scripts/bump-policy.test.ts tests/scripts/resolve-patch-cut.test.ts tests/scripts/stable-docker.test.ts` | [log](../../.tmp/phase6-work/item7-ci-baseline.log) |
| 171 | item7-ci-retry-fixed | FAIL | 11.465 | `pnpm --filter @openpixo/e2e exec vitest run tests/actions-cache-workflows.test.ts tests/packaged-smoke-workflow.test.ts tests/scripts/convergence.test.ts tests/scripts/bump-policy.test.ts tests/scripts/resolve-patch-cut.test.ts tests/scripts/scopes.test.ts tests/scripts/stable-docker.test.ts tests/scripts/smoke-artifacts.test.ts tests/scripts/release-notification.test.ts` | [log](../../.tmp/phase6-work/item7-ci-retry-fixed.log) |
| 172 | item7-fixtures | PASS | 0.195 | `node .tmp/phase6-work/item7-fixtures.ts` | [log](../../.tmp/phase6-work/item7-fixtures.log) |
| 173 | item7-convergence-test-retry | FAIL | 11.186 | `pnpm --filter @openpixo/e2e exec vitest run tests/scripts/convergence.test.ts tests/scripts/bump-policy.test.ts` | [log](../../.tmp/phase6-work/item7-convergence-test-retry.log) |
| 174 | item7-convergence-final | PASS | 11.72 | `pnpm --filter @openpixo/e2e exec vitest run tests/scripts/convergence.test.ts tests/scripts/bump-policy.test.ts tests/scripts/stable-docker.test.ts tests/actions-cache-workflows.test.ts tests/scripts/scopes.test.ts` | [log](../../.tmp/phase6-work/item7-convergence-final.log) |
| 175 | item7-ci-final | PASS | 14.531 | `pnpm --filter @openpixo/e2e exec vitest run tests/actions-cache-workflows.test.ts tests/packaged-smoke-workflow.test.ts tests/scripts/convergence.test.ts tests/scripts/bump-policy.test.ts tests/scripts/resolve-patch-cut.test.ts tests/scripts/scopes.test.ts tests/scripts/stable-docker.test.ts tests/scripts/smoke-artifacts.test.ts tests/scripts/release-notification.test.ts` | [log](../../.tmp/phase6-work/item7-ci-final.log) |
| 176 | item7-historical-links | PASS | 1.572 | `node .tmp/phase6-work/history-links.ts` | [log](../../.tmp/phase6-work/item7-historical-links.log) |
| 177 | item7-preservation-audit | FAIL | 0.264 | `node .tmp/phase6-work/final-audit.ts` | [log](../../.tmp/phase6-work/item7-preservation-audit.log) |
| 178 | item7-preservation-audit-final | FAIL | 0.993 | `node .tmp/phase6-work/final-audit.ts` | [log](../../.tmp/phase6-work/item7-preservation-audit-final.log) |
| 179 | item7-guard | PASS | 10.693 | `pnpm guard` | [log](../../.tmp/phase6-work/item7-guard.log) |
| 180 | item7-typecheck | PASS | 16.055 | `pnpm typecheck` | [log](../../.tmp/phase6-work/item7-typecheck.log) |
| 181 | item7-catalog-focused | FAIL | 3.657 | `pnpm --filter @openpixo/tools-release exec vitest run tests/catalog-export.test.ts tests/catalog-pack.test.ts tests/catalog-publish.test.ts tests/site.test.ts tests/dsh-bootstrap-bundle.test.ts` | [log](../../.tmp/phase6-work/item7-catalog-focused.log) |
| 182 | item7-protected-final | PASS | 2.802 | `node .tmp/phase6-work/final-audit.ts` | [log](../../.tmp/phase6-work/item7-protected-final.log) |
| 183 | item7-consumed-pack-build | PASS | 0.594 | `pnpm --filter @openpixo/tools-pack build` | [log](../../.tmp/phase6-work/item7-consumed-pack-build.log) |
| 184 | item7-catalog-final | PASS | 3.054 | `pnpm --filter @openpixo/tools-release exec vitest run tests/catalog-export.test.ts tests/catalog-pack.test.ts tests/catalog-publish.test.ts tests/site.test.ts tests/dsh-bootstrap-bundle.test.ts` | [log](../../.tmp/phase6-work/item7-catalog-final.log) |
| 185 | final-builds | PASS | 16.047 | `pnpm --filter @openpixo/daemon --filter @openpixo/web --filter @openpixo/desktop --filter @openpixo/packaged --filter @openpixo/tools-dev --filter @openpixo/tools-pack --filter @openpixo/components build` | [log](../../.tmp/phase6-work/final-builds.log) |
| 186 | final-prompts | PASS | 6.208 | `pnpm --filter @openpixo/daemon exec vitest run tests/prompts tests/official-system-prompt.test.ts tests/system-prompt-template.test.ts tests/critique-panel-prompt.test.ts tests/plugins-bundled-atom-prompts-default.test.ts tests/prompt-templates.test.ts tests/craft.test.ts tests/plugins-context-craft.test.ts tests/motion-skills-catalog.test.ts tests/skill-catalog.test.ts tests/plugins-bundled-scenarios-roster.test.ts` | [log](../../.tmp/phase6-work/final-prompts.log) |
| 187 | final-locales | PASS | 13.867 | `pnpm --filter @openpixo/web exec vitest run tests/i18n/locales.test.ts tests/components/home-hero/plugin-authoring-prompt.test.ts tests/components/EntryShell.onboarding.test.tsx tests/components/ProjectView.pendingPrompt.test.tsx tests/components/PluginDetailView.curated-layout.test.tsx` | [log](../../.tmp/phase6-work/final-locales.log) |
| 188 | final-contract-prompts | PASS | 0.983 | `pnpm --filter @openpixo/contracts exec vitest run tests/system-prompt.test.ts tests/system-prompt-api-mode.test.ts tests/system-prompt-audio-voices.test.ts tests/system-prompt-metadata-block.test.ts tests/system-prompt-web-clone.test.ts tests/official-system-prompt.test.ts tests/openpixo-game-prompt.test.ts tests/plugins-manifest.test.ts` | [log](../../.tmp/phase6-work/final-contract-prompts.log) |
| 189 | final-game-workspace-e2e | PASS | 60.761 | `pnpm --filter @openpixo/e2e exec vitest run -c vitest.config.ts tests/openpixo/game-workspace.test.ts` | [log](../../.tmp/phase6-work/final-game-workspace-e2e.log) |
| 190 | final-cli-help | PASS | 14.454 | `node .tmp/phase6-work/cli-help.ts` | [log](../../.tmp/phase6-work/final-cli-help.log) |
| 191 | mock-final-start | PASS | 7.613 | `pnpm tools-dev start web --prod --namespace phase6mock --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-mock-final\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/mock-final-start.log) |
| 192 | final-clean-replay | PASS | 0.786 | `node .tmp/phase6-work/clean-visual-conversation.ts --fresh` | [log](../../.tmp/phase6-work/final-clean-replay.log) |
| 193 | final-visible-text | PASS | 26.455 | `node .tmp/phase6-work/capture.ts final --fresh` | [log](../../.tmp/phase6-work/final-visible-text.log) |
| 194 | final-nsis-build | FAIL | 53.323 | `pnpm tools-pack win build --to nsis --namespace p6 --portable --dir C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-pack --cache-dir C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-cache --json` | [log](../../.tmp/phase6-work/final-nsis-build.log) |
| 195 | final-feature-entries | PASS | 2.821 | `node .tmp/phase6-work/feature-entry-capture.ts --final` | [log](../../.tmp/phase6-work/final-feature-entries.log) |
| 196 | mock-final-stop | PASS | 14.442 | `pnpm tools-dev stop web --namespace phase6mock --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-mock-final\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/mock-final-stop.log) |
| 197 | final-nsis-retry | PASS | 440.966 | `pnpm tools-pack win build --to nsis --namespace p6 --portable --dir C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-pack --cache-dir C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-cache --json` | [log](../../.tmp/phase6-work/final-nsis-retry.log) |
| 198 | final-menu-review | FAIL | 0.524 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review.log) |
| 199 | final-menu-review-fixed | FAIL | 30.603 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-fixed.log) |
| 200 | final-menu-review-complete | FAIL | 30.586 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-complete.log) |
| 201 | final-menu-review-debug | FAIL | 30.609 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-debug.log) |
| 202 | final-menu-review-pass | FAIL | 36.496 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-pass.log) |
| 203 | final-menu-review-resolved | PASS | 2.984 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-resolved.log) |
| 204 | final-menu-review-styled | FAIL | 1.076 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-styled.log) |
| 205 | final-menu-review-visible | PASS | 2.842 | `node .tmp/phase6-work/entry-menu-review.ts` | [log](../../.tmp/phase6-work/final-menu-review-visible.log) |
| 206 | mock-final-start | PASS | 7.1 | `pnpm tools-dev start web --prod --namespace phase6mock --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-mock-final\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/mock-final-start.log) |
| 207 | final-artifact-replay | PASS | 0.722 | `node .tmp/phase6-work/clean-visual-conversation.ts --fresh` | [log](../../.tmp/phase6-work/final-artifact-replay.log) |
| 208 | final-visible-text-artifact | PASS | 25.803 | `node .tmp/phase6-work/capture.ts final --fresh` | [log](../../.tmp/phase6-work/final-visible-text-artifact.log) |
| 209 | mock-final-stop | PASS | 13.694 | `pnpm tools-dev stop web --namespace phase6mock --tools-dev-root 'C:\Users\user\Documents\ChatGPT\OpenPixo\.tmp\phase6-mock-final\orchestration' --no-env-file --json` | [log](../../.tmp/phase6-work/mock-final-stop.log) |
| 210 | final-unpacked-scan | PASS | 3.271 | `node .tmp/phase6-work/package-scan.ts unpacked .tmp/phase6-pack/out/win/namespaces/p6/builder/win-unpacked` | [log](../../.tmp/phase6-work/final-unpacked-scan.log) |
| 211 | final-unpacked-utf16-scan | PASS | 0.809 | `node .tmp/phase6-work/package-scan.ts unpacked-utf16 .tmp/phase6-pack/out/win/namespaces/p6/builder/win-unpacked --utf16` | [log](../../.tmp/phase6-work/final-unpacked-utf16-scan.log) |
| 212 | final-payload-extract | PASS | 19.164 | `tools/pack/resources/win/7zip/7z.exe x C:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-pack/out/win/namespaces/p6/payload/OpenPixo-p6-payload.7z -oC:/Users/user/Documents/ChatGPT/OpenPixo/.tmp/phase6-payload-extracted -y` | [log](../../.tmp/phase6-work/final-payload-extract.log) |
| 213 | final-sidecar-timing | PASS | 75.63 | `pnpm --filter @openpixo/sidecar exec vitest run tests/convergence.test.ts -t 'retries a clean launcher exit\|retries a launcher generation retired\|keeps explicit and fresh restart port\|force-stops an unresponsive target after its declared owner dies\|does not let an earlier stop terminate a replacement'` | [log](../../.tmp/phase6-work/final-sidecar-timing.log) |
| 214 | final-payload-scan | PASS | 0.335 | `node .tmp/phase6-work/package-scan.ts payload .tmp/phase6-payload-extracted` | [log](../../.tmp/phase6-work/final-payload-scan.log) |
| 215 | final-payload-utf16-scan | PASS | 0.555 | `node .tmp/phase6-work/package-scan.ts payload-utf16 .tmp/phase6-payload-extracted --utf16` | [log](../../.tmp/phase6-work/final-payload-utf16-scan.log) |
| 216 | final-sidecar-timing-baseline | PASS | 74.485 | `pnpm --dir .tmp/phase6-baseline --filter @openpixo/sidecar exec vitest run tests/convergence.test.ts -t 'retries a clean launcher exit\|retries a launcher generation retired\|keeps explicit and fresh restart port\|force-stops an unresponsive target after its declared owner dies\|does not let an earlier stop terminate a replacement'` | [log](../../.tmp/phase6-work/final-sidecar-timing-baseline.log) |
| 217 | final-data-resolver-fixture | PASS | 12.235 | `pnpm --filter @openpixo/daemon exec vitest run tests/server-bootstrap-regression.test.ts -t 'requires explicit PIXO_DATA_DIR'` | [log](../../.tmp/phase6-work/final-data-resolver-fixture.log) |
| 218 | final-package-classification | FAIL | 1.282 | `node .tmp/phase6-work/classify-package.ts` | [log](../../.tmp/phase6-work/final-package-classification.log) |
| 219 | final-package-classification-pass | PASS | 1.259 | `node .tmp/phase6-work/classify-package.ts` | [log](../../.tmp/phase6-work/final-package-classification-pass.log) |
| 220 | final-fixture-guard | PASS | 9.748 | `pnpm guard` | [log](../../.tmp/phase6-work/final-fixture-guard.log) |
| 221 | final-fixture-typecheck | PASS | 12.593 | `pnpm typecheck` | [log](../../.tmp/phase6-work/final-fixture-typecheck.log) |
| 222 | final-document-ledger | PASS | 0.16 | `node .tmp/phase6-work/final-doc-ledger.ts` | [log](../../.tmp/phase6-work/final-document-ledger.log) |
| 223 | final-document-ledger-complete | PASS | 0.154 | `node .tmp/phase6-work/final-doc-ledger.ts` | [log](../../.tmp/phase6-work/final-document-ledger-complete.log) |
| 224 | final-commit-checks | PASS | 0.085 | `node .tmp/phase6-work/commit-check-proof.ts` | [log](../../.tmp/phase6-work/final-commit-checks.log) |
| 225 | final-feature-ledger | PASS | 0.111 | `node .tmp/phase6-work/deleted-feature-ledger.ts` | [log](../../.tmp/phase6-work/final-feature-ledger.log) |
| 226 | final-report-assembly | FAIL | 0.091 | `node .tmp/phase6-work/finish-report.ts` | [log](../../.tmp/phase6-work/final-report-assembly.log) |
| 227 | final-report-assembly-pass | PASS | 0.072 | `node .tmp/phase6-work/finish-report.ts` | [log](../../.tmp/phase6-work/final-report-assembly-pass.log) |
| 228 | final-ledger-assembly | PASS | 0.074 | `node .tmp/phase6-work/write-ledger.ts` | [log](../../.tmp/phase6-work/final-ledger-assembly.log) |
| 229 | final-source-audit | PASS | 2.755 | `node .tmp/phase6-work/final-audit.ts` | [log](../../.tmp/phase6-work/final-source-audit.log) |
| 230 | final-typecheck | PASS | 12.318 | `pnpm typecheck` | [log](../../.tmp/phase6-work/final-typecheck.log) |
| 231 | final-guard | PASS | 11.945 | `pnpm guard` | [log](../../.tmp/phase6-work/final-guard.log) |
