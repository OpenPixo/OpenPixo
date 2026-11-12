# tools/pack

Follow the root `AGENTS.md` and `tools/AGENTS.md` first. This tool owns the repo-external packaged build/start/stop/logs command surface.

Read `tools/pack/CACHE.md` before changing any build-cache node key, adding a cache node, or changing what a cached node reads or writes. It is the source of truth for the build-graph cache under `--cache-dir`: determinant rules, materialization-time parameters, the signing boundary, and confidence grading.

## Owns

- Local packaging orchestration for packaged OpenPixo artifacts.
- mac build/install/start/stop/logs/uninstall/cleanup smoke commands.
- Windows NSIS build/install/start/stop/logs/uninstall/cleanup/list/reset smoke commands.
- Windows registry observation/cleanup must go through `reg.exe` and stay scoped to entries matching the namespace install/uninstaller paths.
- Windows lifecycle logs must expose NSIS automation logs/markers/timings in addition to app runtime logs.
- Linux AppImage build/install/start/stop/logs/uninstall/cleanup smoke commands.
- Linux headless (no-Electron) install/start/stop via `--headless` flag on `install`, `start`, and `stop`.
- Linux containerized builds via `electronuserland/builder` Docker image for distro-agnostic glibc compat.
- Consuming sidecar/process/path primitives from `@openpixo/sidecar-proto`, `@openpixo/sidecar`, and `@openpixo/platform`.

## Does not own

- Product business logic.
- Sidecar protocol definitions.
- A second process identity model.
- Product/business update runtime integration.

## Rules

- Keep cross-platform source responsibilities in named directories such as `cache/`, `config/`, `launcher/`, `resources/`, `updates/`, and `versioning/`; keep platform-owned behavior below `mac/` or `win/`. Mirror those responsibilities in `tests/` when a test set has the same ownership. A new root-level `src/*.ts` file is intentionally treated as unclassified by CI and pays the conservative Windows payload fallback until it is placed in an owned source unit.
- Tests import source modules through the test-only `@/*` alias. Tests that intentionally inspect source text use the same alias with Vitest's `?raw` suffix; do not reintroduce directory-depth-dependent `../src/` imports or file URLs.
- Do not hand-build stamp argv, IPC paths, or process matching; use `@openpixo/sidecar` launch/discovery/invoke/stop atomics.
- Do not use port numbers in data/log/runtime/cache path decisions. Namespace decides paths; ports are only transient transports.
- Public release artifacts must use channel-specific app identity: stable uses `OpenPixo`, beta uses `OpenPixo Beta`, prerelease uses `OpenPixo Prerelease`, and preview uses `OpenPixo Preview`. Local tools-pack installs may still use namespace-scoped install paths only as a developer multi-instance validation convention.
- Do not let namespace-named `.app` installs change data/log/runtime/cache path conventions.
- `--dir` controls tools-pack output/runtime/install validation roots only. It must not be treated as the cache root. The default workspace tools-pack cache is the hot path. `--cache-dir` is a special-case escape hatch for cache isolation or cold-cache validation, not a routine QA/build parameter.
- Use `--portable` for public/release artifacts so packaged config does not bake local tools-pack runtime roots from the build machine.
- Pack resource files used by electron-builder belong under `tools/pack/resources/`; do not point pack logic at Downloads, web public assets, docs assets, or other app-owned resource paths.
- For ordinary Windows NSIS smoke tests, use short namespaces such as `rg`, `smoke`, or `nsis-a`. NSIS extracts deeply nested Next.js standalone files under the namespace-scoped install directory; long namespaces can push installed paths past the traditional Windows 260-character limit even when builder `win-unpacked` output is correct. During merge regression, namespace `regression-merge-nsis` produced an installed path length of 264 characters and missed `next/dist/server/route-matcher-providers/helpers/cached-route-matcher-provider.js` in the installed directory, while the same NSIS smoke passed with namespace `rg`. Use long namespaces only when intentionally testing installer path-length behavior.

## Packaged auto-update architecture and harness

Read this section before changing packaged auto-update behavior. The updater crosses package, desktop, web UI, release-feed, and installer surfaces, so bugs often hide between otherwise-green package tests.

### Architecture map

- `apps/desktop/src/main/updater.ts` owns updater state, release metadata parsing, artifact selection, checksum verification, download-store ownership, progress events, and opening the downloaded installer. It is pure main-process logic and is tested under `apps/desktop/tests/main/updater.test.ts`.
- `apps/desktop/src/main/runtime.ts` exposes updater IPC to the renderer through `pixo:update:status|check|download|install|quit` and emits `pixo:update:status-changed`. Keep installer launch separate from process shutdown; quit is an explicit post-installer action.
- `apps/desktop/src/main/index.ts` wires the scheduler and the packaged macOS app-menu update item. The native item mirrors updater state and opens the renderer-owned update dialog; it must not create a second updater or a native result dialog. Windows and Linux menus do not expose update actions.
- `apps/web/src/lib/updater.ts` normalizes host updater snapshots into UI-ready state.
- `apps/web/src/components/UpdaterPopup.tsx` remains the ready-update surface in the left rail. `apps/web/src/components/UpdateDialog.tsx` owns the explicit macOS app-menu check flow. All visible copy and native menu labels must go through `apps/web/src/i18n`.
- `packages/launcher-proto` owns launcher pointer, attempt, and desktop-handoff journal shapes plus payload selection. `runtime.json` together with `attempt.json` is the only payload-version state machine.
- `apps/packaged/src/index.ts` delegates to the selected payload desktop before initializing the outer Electron runtime, then passes packaged `appVersion` and namespace-scoped `updateRoot` into desktop main only when the outer itself must run.
- `apps/daemon/src/sidecar/payload-desktop-handoff.ts` owns the historical-outer bridge. It uses the daemon's `SidecarFactory` client to confirm and shut down the exact outer desktop, then `spawnSidecar` to launch the payload generation while preserving the true previous launcher pointer across the `prepared` → `armed` → `confirmed` journal lifecycle.
- `install.json` continues to identify the physically installed outer executable for recovery. Payload activation or handoff must not rewrite it to a versioned payload executable.
- `tools/serve` owns deterministic local updater fixtures only. It must not contain product updater runtime logic.
- `tools/pack` owns packaged build/install/start/inspect/logs/uninstall/cleanup and the platform installer harness, including Windows NSIS registry observation and cleanup.

### Release metadata shape

The runtime updater has no feed unless one is baked or injected. Public release builds (`win build --release-channel stable|beta`, which requires `--portable` and the exact public version form) bake `https://downloads.openpixo.com/updates/<channel>/latest/metadata.json` from `packages/release` and so ship with the updater on; every other build needs `PIXO_UPDATE_METADATA_URL` to select an independently operated source or a loopback fixture, and that variable also overrides a baked feed. Feeds are written by `tools-release openpixo metadata|publish` (see `openpixo-internal/docs/coordination/PACKAGING.md`, "Public Windows distribution"). For package-launcher updates:

- A valid packaged-launcher context prefers `platforms.<platform>.artifacts.payload`; the platform installer (`dmg` on macOS or `installer` on Windows) remains the recovery/fallback path.
- The artifact must have a checksum, preferably `sha256Url`; the updater verifies bytes before exposing an install action.
- `PIXO_UPDATE_CURRENT_VERSION` may override the packaged version for tests, but user-flow package validation should prefer building the package with the intended `--app-version`.
- Release metadata may include `releaseNote.content`, with a `defaultLocale` and locale descriptors containing `url`, `mediaType`, `sha256`, and `size`. The updater does not currently consume this block; `tools-release` owns its publication and verification independently from updater UI behavior.
- Release metadata may include `control.launcher.version.{min, url}` — the installer-reinstall floor. The updater compares `min` against the **physically installed outer package version** (read at check time from the outer bundle's `openpixo-config.json` via the launcher launch path; `PIXO_UPDATE_INSTALLED_VERSION` overrides it for tests), NOT the running payload version — payload updates never touch the outer bundle, so a broken outer generation must reach the installer path even when its payload is current. When the floor trips (or `min` is set but the outer version is unreadable — conservative), the updater selects the installer artifact and, when no newer release exists, offers a same-version installer reinstall; snapshot field `reinstall` carries `{reason, installedVersion, minVersion, url}` and the web UI presents the optional operator `url` as a jump link with default i18n copy as fallback. Publication: channel policy is managed as one repo-vars pair per channel — `RELEASE_LAUNCHER_VERSION_MIN_<CHANNEL>` + `RELEASE_LAUNCHER_VERSION_MIN_URL_<CHANNEL>` — passed through workflows verbatim (no YAML fallback expressions) and resolved by the shared resolver in `tools/release/src/storage/launcher-version-floor.ts`: a non-stable channel whose own pair is unset falls back to the STABLE pair as a unit, and format/https/floor validation is applied at that single point. `publish-metadata` hard-fails when `min` exceeds the release version — a floor this release cannot satisfy would make the same-version reinstall offer nag forever. `verify-metadata` re-resolves the same channel policy and checks the published block against it; `summary-metadata` surfaces the floor in the step summary.
- Release metadata may include `control.app.version.{min, message, url}` — the minimum usable version, unrelated to the installer floor above. It compares `min` against the **running** version, and a running version below it must update before the app can be used (`components/RequiredUpdateGate.tsx`, snapshot field `required`). It must never strand anyone: `requiredUpdateFromMetadata` (`updater/feed.ts`) stays silent on a missing or malformed field and on a floor the offered release would not clear, and a failed feed read clears the requirement, so an offline launch is never gated. The gate waits for running tasks as a strip, never restarts by itself, and after a failed download offers retry, manual download and keeping going for this session. Publication: `tools-release openpixo metadata --min-version` or `openpixo set-min-version` (see `openpixo-internal/docs/coordination/PACKAGING.md`, "Release runbook"); both refuse a floor above the release.
- A downloaded payload the user did not restart for takes effect on their next launch. `updater/apply-on-quit.ts` moves the launcher pointer while quitting; it deliberately writes no `attempt.json`, because a pre-armed attempt with no delegated launch behind it reads as a failed launch and rolls back. A session that ended without a normal quit falls back to the scheduler's startup path, which is on unless `allowSilentUpdates` is `false` and refuses while a task runs. Both record `autoAppliedKey` in the update store, so a release that did not stick is not auto-applied again; the restart prompt can still choose it.
- A payload desktop derives its namespace base root from its own location (`namespaceBaseRootFromPayloadExecutable`), ahead of its config. A public payload carries no root and a tools-pack install bakes one, so trusting the payload's config would move such an install onto empty data.
- The updater exposes a manual disaster-recovery `clear-cache` action (`pixo:update:clear-cache` IPC, sidecar action `clear-cache`, Settings → About "Clear update cache" row with a two-stage inline confirm). It resets one-shot update state (downloaded release, install freeze) back to `idle`, purges `releases/`, `staging/`, `downloads/`, and `.back/`, removes a stale launcher `attempt.json` plus any non-`confirmed` desktop-handoff journal, and deletes non-retained launcher payload versions. Runtime `active`/`lastSuccessful` versions, explicit `retained` cleanup entries, `install.json`, and a `confirmed` handoff journal are never touched; locked files defer through the existing cleanup.json retry machinery. An installer helper already spawned by a prior install action is not cancelled.
- Release-note source lives at `docs/CHANGELOG/v<full-releaseVersion>/<locale>.md`. All channels use the same publication pipeline, while stable additionally requires `en` and `zh-CN` before platform builds proceed.
- Post-update highlights use `/api/whats-new` and an explicitly configured `PIXO_WHATS_NEW_URL`. No source means no fetch; the checked-in document is the empty retirement object. There is no publisher. See `docs/whats-new.md`.

### Channel identity rules

OpenPixo's public channels are `stable` and `beta` (`PUBLIC_RELEASE_CHANNELS`
in `packages/release`), built in namespaces `release-stable-win` /
`release-beta-win`. Other channel descriptors in `packages/release` are
implementation/test identities, not public release lanes. App identity, protocol, runtime namespace, shortcuts and updater
source must all be independent. Use a unique namespace and task-local build
root for validation; never reuse or alter an installed hands-on instance.

### Deterministic fixture harness

Use `tools-serve start updater` for fast, deterministic tests and e2e automation where network release state is not the thing under test. Fixture flow:

```bash
pnpm tools-serve start updater --json --channel beta --version 99.0.0-beta.1 --platform win
```

Then launch packaged desktop with:

```bash
PIXO_UPDATE_ENABLED=1
PIXO_UPDATE_METADATA_URL=<fixture metadataUrl>
PIXO_UPDATE_CURRENT_VERSION=99.0.0-beta.0
PIXO_UPDATE_OPEN_DRY_RUN=1
PIXO_UPDATE_AUTO_CHECK=1
```

This harness is appropriate for asserting IPC, popup rendering, progress, checksum/download-store behavior, and dry-run installer opening. It is not a full user-view validation because it replaces the public release feed and uses synthetic artifact bytes.

### High-confidence local user-flow acceptance

A real update flow requires owner-selected independent metadata and artifacts,
verified checksums and matching installer/channel identities. None is hosted by
default. First validate the deterministic harness and metadata contracts.

Build an isolated package with the explicit namespace, app version, output and
cache arguments shown by `pnpm tools-pack win build --help`. Build success,
fixture download/activation and actual installed-app acceptance are separate
results. Installation, OS registration and installed-instance lifecycle require
the relevant owner-authorized task; do not infer them from a build request.

### Validation matrix for updater changes

`docs/testing/updater-lifecycle.md` is the full lifecycle-to-test coverage map (including deliberate manual-only nodes); consult it to find the owning tests for the node you touched, then run the narrow tests plus the repo checks:

```bash
pnpm --filter @openpixo/desktop test -- tests/main/updater.test.ts tests/main/updater-host-boundary.test.ts tests/main/preload-host-boundary.test.ts
pnpm --filter @openpixo/web test -- tests/components/UpdaterPopup.test.tsx tests/lib/updater.test.ts
pnpm --filter @openpixo/tools-serve test
pnpm --filter @openpixo/tools-pack test -- tests/win-identity.test.ts tests/win-app.test.ts tests/win-builder.test.ts
pnpm --filter @openpixo/desktop typecheck
pnpm --filter @openpixo/web typecheck
pnpm --filter @openpixo/tools-pack typecheck
pnpm --filter @openpixo/tools-serve typecheck
git diff --check
pnpm guard
pnpm typecheck
```

Run the high-confidence local user-flow acceptance whenever a change touches real release feed selection, channel identity, Windows registry/install behavior, installer opening, or visible updater UI behavior.
For launcher payload or handoff changes, also run the platform full spec. The full profile must validate exact desktop executable identity, a real PPTX response, a complete stop followed by an installed-outer cold start, and the same checks again after restart. Windows beta full validation must use `release-beta-win`; a beta-like local namespace is not equivalent delivery evidence.
