# Phase 3 — workspace package scope

Date: 2026-10-27 (Asia/Tokyo). Base: `d283e40c`.
Branch: `codex/opendesign-base`. Decision: [ADR 0009](../adr/0009-package-scope-openpixo.md).

## Implementation

- All 27 workspace manifests use `@openpixo/*`; the root package is `openpixo`.
  Package suffixes and versions are preserved. There are no aliases or
  compatibility re-exports. `pnpm install --config.confirmModulesPurge=false`
  regenerated the lockfile and workspace links.
- Imports, mocks, aliases, exports, runtime resolution, Next transpilation,
  packaging package lists, terminal fixture assembly and package filters use
  the new scope. CI's root exclusion is `!openpixo`.
- Runtime resolution includes daemon CLI/package lookup, verified source
  checkout discovery, tools-pack identity discovery, packaged sidecar exports,
  desktop delegation, prebundle entries and split node_modules path segments.
- Build-cache schemas and key semantics are unchanged. Existing manifest,
  lockfile, package-source, build-command and after-pack-hook inputs cover the
  rename. The tarball witness now changes each package's manifest name and
  confirms invalidation; generated output remains a non-input.
- CI scopes configuration and its Python planner have no old scope literals;
  neither needed a change. Their validators pass without changing routing,
  confidence or omission policy.

## Commits

| Commit | Subject |
| --- | --- |
| `66d8afe1` | `refactor!: rename workspace packages to @openpixo` |
| `36bae568` | `refactor(build): align CI and packaging with @openpixo` |

The documentation commit `e5505037` records current names, the ADR and
historical exceptions. A follow-up commit corrects the current-state component
package name in `docs/references.md` and records the final verification below.

## Validation at the documentation checkpoint

Guard and repository typecheck passed before each implementation commit.
All six requested app/tool builds passed. Focused checks passed for CLI
startup (10), server paths (14), tools-dev diagnostics/client (10), DSH
protocol (12), package/cache/resource boundaries (84; two platform skips),
CI/planner/postinstall (43), packaged boundaries (77; one platform skip),
daemon discovery (13) and packaged entry generation (8).

The game-workspace E2E passed in the first run. A subsequent interrupted run
left a successful recorded-conversation report but no command completion;
it is not counted as a completed combined validation. A fresh final run is
required. NSIS construction and packaged package-resolution verification
remain pending at this checkpoint.

Command logs and the machine-readable command ledger are under
`.tmp/phase3-scope/`. No full daemon/web suite or live model/provider test ran.

## Corrected attempts and scratch handling

- The first tools-dev invocation incorrectly selected Vitest; this package
  uses Node's test runner. The corrected focused command passes.
- Early packaging checks lacked Corepack on PATH. A repository-local shim
  invokes the pinned pnpm. Its first implementation lost stdout; corrected
  shims pass both direct version probes and the CI/postinstall tests.
- The daemon discovery test exposed the remaining root-package identity
  comparison. It went red (3/13 failures) after updating its root fixture,
  then green (13/13) after changing the production check.
- The first mock helper treated `run --help` as a conversation, so its
  single-invocation assertion failed after a successful product run. The
  helper now answers capability probes separately.
- The initial scratch redirection missed transpiled quote styles and used
  the harness's default scratch parent. Only this task's two completed
  namespaces were moved into `.tmp/phase3-e2e-initial/`. The corrected preload
  places subsequent suite roots under `.tmp/phase3-e2e/`.
- Automatic approval review rejected recursive generated-dist removal with
  “blocked by policy”. The safer reversible action moved 23 generated output
  directories into `.tmp/phase3-stale-dist/`; packages were rebuilt into empty
  active output directories. The archived output is ignored and unconsumed.

## Preserved boundaries

LICENSE, NOTICE, references provenance, ADR 0005 and the historical body of
ADR 0006, external CLI recordings and upstream repository URLs are preserved.
The ACP inflight recording retains two old import strings inside verbatim
external tool output. The cleanup plan retains migration-source names and
future guard requirements. ADR 0009 retains the old scope in its decision.
These are evidence, not executable references or aliases.

Environment variables, manifest fields/export targets, persisted state,
protocol identifiers, CSS and ordinary OpenDesign prose remain outside this
phase. Daemon data ownership follows the root `AGENTS.md` contract. No push,
global installation/configuration change, or operation on the installed
Alpha.3 instance was performed.

## Final verification

After the documentation commit, guard, typecheck, the six requested builds,
`node apps/daemon/bin/pixo.mjs --help`, the focused suites above, and a fresh
combined run of `e2e/tests/openpixo/game-workspace.test.ts` plus one mock
conversation on an imported game in an isolated namespace all passed.

The first two NSIS attempts failed for environment reasons: one inside the
redirected scratch tool home, where electron-builder's NSIS cache was not
visible (`makensis is required`). The app payload had already built. A rerun
in the normal user environment (`pnpm tools-pack win build --to nsis
--namespace p3 --dir .tmp/phase3-pack --cache-dir .tmp/phase3-pack-cache`,
build only) succeeded: a 373,432,335-byte installer, nothing installed or
launched. The unpacked app's `node_modules` contains only `@openpixo/*`
workspace packages, and the extracted prebundled daemon contains no
`@open-design/` string and resolves `@openpixo/daemon/package.json`.

The final `rg -n "@open-design/"` (excluding `node_modules`, `.git`, `.cache`,
`.tmp`, `dist`) returns 9 lines in 4 files, all listed under "Preserved
boundaries": ADR 0006 (historical body), ADR 0009 (the decision), the cleanup
plan (5 lines) and `apps/daemon/tests/fixtures/w123-acp-inflight-frames.json`
(verbatim tool output, 2 lines), plus this report quoting the search.
