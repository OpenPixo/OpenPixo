# Independent integration review

Date: 2026-10-25 (Asia/Tokyo). Reviewer: `integration_review`.
Baseline: OpenDesign `9724c44142ea0afaee3d207f37901b31c66a44ad`.

Review follows ponytail and code-review-and-quality plus the repository's
ownership and review guides. Application source is read-only for this reviewer.

## Findings and correction review

1. **Resolved P1: Fork sidecar identity collided with upstream.** The private IPC
   key uses the OS principal and the five-field stamp, while the fork initially
   retained the upstream default/release namespaces and source tokens.
   Distinct app IDs and user-data directories do not prevent packaged startup
   from discovering an upstream desktop with the same stamp. Owner:
   `delivery_scope`. Source correction verified: product-owned source values are
   now `openpixo-packaged`, `openpixo-tools-dev`, and `openpixo-tools-pack`;
   the generic sidecar algorithm and five-field shape remain unchanged.
   Recorded final evidence: endpoint isolation **3/3 passed** with identical
   channel/namespace for all three old/fork sources on Windows. Shared dist
   was rebuilt; affected warm-instance/launch checks passed **101 tests** with
   one platform skip. See PACKAGING.md (openpixo-internal: `docs/coordination/PACKAGING.md`).

2. **Resolved P2: Project extension version did not identify executed content.** Catalog
   entries originally stored a captured hash but resolved the current global
   skill/MCP content on every run. The UI also hid their Update action. Owner:
   `upstream_review`. Source correction verified: add/update copies skill packages
   and MCP configs into managed snapshots; runtime resolution no longer falls
   back to the live catalog. Old skill package paths remain available to active
   runs. Mutation-without-update and retained old-path regressions passed;
   final daemon extension/installer/route/CLI checks passed **45/45**, and the
   panel passed **6/6**. Legacy entries without snapshots fail closed until
   explicit Update. See [EXTENSIONS.md](EXTENSIONS.md).

3. **Resolved P2: Fork deep links were rejected at the sidecar codec.** OS registration,
   desktop routing and payload delegation changed to `openpixo://`, while
   `normalizeDesktopShowInput` still accepted only `pixo://`. Owner:
   `delivery_scope`. Source correction verified: the codec now accepts the fork
   scheme, rejects upstream links, and the warm-instance fixture calls the real
   codec. Final proto codec checks passed **20/20**, including upstream-scheme
   rejection; the real-codec warm-instance checks are included in the packaging
   result above. See PACKAGING.md (openpixo-internal: `docs/coordination/PACKAGING.md`).

4. **Resolved P2: Cancel permission could report task success.** The approval's Cancel
   task action initially answered Codex without setting the run cancellation
   state; an interrupted native turn could count as a clean completion. Owner:
   `runtime_core`. Source correction verified: the approval registrar requires
   a cancellation callback and the run registrar supplies the existing
   `design.runs.cancel(run, 'user_stop')` lifecycle. Focused tests assert the
   callback and resulting canceled state. The recorded route regression passed
   **11/11**; the final argv/transport/cancel suite passed **36/36**. The actual
   daemon-start/API regression passed **1/1**, and the production HTTP fixture
   chain also observed cancellation to `canceled`. See [RUNTIME.md](RUNTIME.md)
   and [ACCEPTANCE.md](ACCEPTANCE.md).

Review also raised legacy approval command-vector display and explicit stale
turn rejection with `runtime_core`. The owner checked the installed Codex
schema; source and tests now cover those cases, offered-decision restrictions,
and exact turn-scoped native permission-profile approvals.

## Checked boundaries

- Project extension API uses local-origin and project authorization gates;
  imports reuse bounded skill-copy/archive checks and omit MCP secrets from
  list responses.
- Codex approvals use per-session UUIDs and pending maps; stop/process death
  clear them, and child completion cannot terminate the root run.
- Asset preview reuses the live file inventory/raw routes. External opening
  resolves the project-relative file through the existing symlink-aware path
  validator and argument-vector launch plan.
- Telemetry/content defaults and upstream metadata/feed defaults are disabled;
  explicit independent updater configuration is required.

## Final recorded validation

The reviewer directly read the final owner/QA reports, release manifest,
typecheck log and `.cache/packaging/smoke.json`. The following are accepted
recorded execution evidence, **not tests personally rerun by this reviewer**:

| Boundary | Recorded result |
| --- | --- |
| Final repository checks | `pnpm typecheck`, `pnpm guard`, `git diff --check` passed |
| Imported-game production HTTP fixture | 1/1 passed in 57.99s; fake native Codex transport, approvals, parallel ownership, resume, child projection, extensions |
| Actual browser asset witness | 1/1 passed in 65.02s; live file APIs, decoded thumbnail, audio controls, filter, multiselect references and refresh |
| Windows x64 delivery | NSIS and ZIP built; hashes recorded, ZIP integrity and EXE branding checked, bundled LICENSE/NOTICE match |
| Installed Windows lifecycle | Actual install, rendered installed app, stop, cold restart and uninstall passed; renderer isolated, desktop auth active, analytics/updater disabled |
| Cleanup | No managed processes, installer registry or shortcuts remain; product-wide user data intentionally preserved |

Packaging evidence: PACKAGING.md (openpixo-internal: `docs/coordination/PACKAGING.md`), local
`.cache/packaging/smoke.json`, and
`output/releases/0.1.0-alpha.1/manifest.json`. Cross-layer evidence:
[ACCEPTANCE.md](ACCEPTANCE.md). The reports distinguish the earlier failing
attempts from the final passing source and artifacts.

## Verdict and delivery limits

**Approve the reviewed source corrections for a local unsigned Alpha handoff.**
The four blocking findings are closed by source corrections and recorded
targeted regressions. No additional blocking source finding remains in the
reviewed boundaries.

This is not full live product-release acceptance. The installed smoke records
`actualModelTurnExecuted: false`; the authenticated Codex + actual MCP + skill
batch/subagent task was not executed, nor were live DeepSeek/OpenRouter tasks,
the user's real game project, signing, public artifact/source publication or an
independent update feed verified. The local API fixture's fake Codex events do
not establish real model, MCP-tool or child-agent participation. Those limits
must remain visible in the standalone delivery handoff.
