---
name: steam-release
en_name: Steam release preparation
zh_name: Steam 发售准备
description: Prepare or validate the requested Steamworks integration, store assets, demo, Next Fest event or depot and branch build; not an automatic full-release or publishing workflow.
zh_description: 按请求准备或验证 Steamworks 接入、商店素材、试玩版与新品节、depot 和分支构建；不自动扩展为完整发售或发布流程。
triggers:
  - release game on Steam
  - Steamworks setup
  - Steam achievements
  - Steam Cloud saves
  - Steam capsule assets
  - Steam Next Fest
  - Steam depot
  - Steam 发售
  - Steam 试玩版
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
---

# Steam release preparation

Handle the requested Steamworks integration, store asset, demo, event or depot task.
Project conventions, installed engine, SDK and wrapper versions, architecture and explicit user choices take precedence.
Use only the relevant branch; a capsule correction does not require a release folder, full manifest or achievements implementation.
Reuse existing release authorization for uploads or promotions; preparation alone does not authorize external publication.

## Quick path

1. Identify the requested surface and real App IDs for the base game and demo. Identify the branch, depot or asset involved.
2. Read the applicable current Steamworks page below and the project's installed integration and build files.
3. Update the runtime, configuration or artifact needed for the request. Use the real app identity and keep secrets out of examples.
4. For code or build work, run `pixo game verify --steps check,build --json`; for art, inspect `pixo asset info <path> --json`.
5. Perform the relevant tests below on a clean client or in Steam when available; distinguish local evidence from untested service behavior.
6. Hand off the requested artifact and concrete blockers; for an authorized upload or promotion, verify the target and complete the scoped action.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.

## Choose the scope

| Request | Prepare or verify | Current source |
| --- | --- | --- |
| SDK and wrapper integration | Installed engine, SDK and wrapper compatibility; launch, callback and offline behavior | [Steamworks API](https://partner.steamgames.com/doc/sdk/api) |
| Achievement | Stable API name, gameplay event, stats readiness and store callback handling | [Achievements](https://partner.steamgames.com/doc/features/achievements) |
| Cloud save | Actual save roots, portable files, account and OS mappings and conflict policy | [Steam Cloud](https://partner.steamgames.com/doc/features/cloud) |
| Store and library artwork | Current templates, composition, localization and gameplay screenshots | [Store assets](https://partner.steamgames.com/doc/store/assets/standard), [library assets](https://partner.steamgames.com/doc/store/assets/libraryassets) |
| Demo or Next Fest | Separate demo identity, content and save boundaries, edition-specific eligibility and deadlines | [Demos](https://partner.steamgames.com/doc/store/application/demos), [Next Fest](https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest) |
| Depot and branch build | VDF mappings, package access, test branch, clean install and upgrade | [SteamPipe uploads](https://partner.steamgames.com/doc/sdk/uploading) |
| Full release | Applicable requirements for accounts, content surveys, reviews and lead time | [Release process](https://partner.steamgames.com/doc/store/releasing) |

## SDK, achievements and cloud anchors

SDK and wrapper details: **verify against current Steamworks docs and the installed wrapper version**.
Do not copy method names from a different GodotSteam or Unity wrapper release.
Pin compatible versions of the engine, wrapper and runtime. Include libraries for each shipped OS and architecture.
Use one owner to initialize the SDK and process callbacks. Launch the installed build from Steam; test the intended behavior when Steam is offline or unavailable.
A development `steam_appid.txt` is excluded from shipping depots per SDK instructions; use the real app identity.

| Integration | Testable rule |
| --- | --- |
| Achievement | Stable configured API name; accepted gameplay event applies once; use the wrapper's supported operations for stats readiness and storing achievements |
| Achievement persistence | Check callbacks and errors, a fresh permitted account, partial and completed progress, restart, offline play and reconnection |
| Cloud strategy | Choose Auto-Cloud file rules or explicit Remote Storage; avoid overlapping independent sync owners |
| Cloud root | Resolve exported-game storage (Godot `user://`, Unity `Application.persistentDataPath`); source-tree paths are not evidence |
| Cloud contents | Portable progress and settings that are intended to sync; exclude caches, logs, credentials and device-specific settings |
| Cloud conflict | Save, exit cleanly and sync on machine A; then load on machine B. Test offline divergence and recoverable conflicts |
| Demo sharing | Explicit compatibility and migration policy before writing full-game progress or sharing cloud configuration |

Use account-scoped roots and mappings appropriate to the current Cloud settings; verify case, quotas and cross-OS compatibility.
Two local windows sharing a file do not establish cloud sync.
Keep schema versions and backups. Give accurate error feedback when Cloud is disabled or fails.

### Unity 6 integration

Keep the installed wrapper. Steamworks.NET mirrors the SDK (`SteamAPI.Init`, `SteamUserStats`), and Facepunch.Steamworks has its own C# API, so calls do not transfer between them.

| Concern | Testable rule |
| --- | --- |
| Lifetime | One `DontDestroyOnLoad` owner initializes once, pumps callbacks in `Update` (which still runs at time scale 0) and shuts down on quit. With domain reload off, a second Play can initialize twice unless statics are reset |
| App identity | `steam_appid.txt` in the project root for the Editor and beside the exe for a local player; excluded from depots |
| Native library | `steam_api64.dll` under `Assets/Plugins` with its `.meta` platform settings, confirmed in a player. Editor success does not show it shipped |
| Scripting backend | Test the backend you ship; IL2CPP can strip wrapper types reached by reflection |
| Cloud root | On Windows `Application.persistentDataPath` is `AppData/LocalLow/<Company>/<Product>`, so Auto-Cloud uses the `WinAppDataLocalLow` root. Renaming Company or Product moves the saves |
| Settings | `PlayerPrefs` live in the Windows registry, so Auto-Cloud cannot see them. Anything meant to sync must be a file |

Stage the whole player output for a depot: the exe, `<Game>_Data/`, `UnityPlayer.dll`, `UnityCrashHandler64.exe`, and `MonoBleedingEdge/` (Mono) or `GameAssembly.dll` (IL2CPP). Exclude `<Game>_BurstDebugInformation_DoNotShip/` and `<Game>_BackUpThisFolder_ButDontShipItInYourProduct/`, and ship a non-development build.

## Store and library assets without stale size assumptions

Store asset sizes: **verify against current Steamworks docs**, portal fields and downloaded templates before export.
The template and portal are authoritative; this skill deliberately does not cache a date-stamped dimension table.

| Asset family | Check in current template or actual placement |
| --- | --- |
| Header, main, small and vertical store capsules | Exact pixel size, title legibility, allowed text and deliberate aspect-specific composition |
| Library capsule and header | Library-specific slot requirements; not interchangeable with store vertical art |
| Library hero + logo | Hero safe area; separate transparent logo with current bounds and placement |
| Screenshots, trailer, icons and event art | Current counts, specifications and content rules; actual gameplay matching the tested build |

Keep editable masters; recompose crops rather than stretch.
Preview localized titles and smallest placements in the portal. Feature claims and content-survey answers must match the game.
Inspect dimensions and origin using `pixo asset info <path> --json` and `pixo asset provenance <path> --json`.

If new art is requested, discover `pixo recipe list --surface image --json` and read `pixo recipe show <id> --json`.
Stage with `pixo recipe run <id> --input key=value --wait --json`; inspect candidates before `pixo recipe adopt <runId> --candidate <candidateId> --json`.
Use the recipe's real input keys and returned paths. Generated art still needs composition, text and current-spec review.

## Demo and event checks, when requested

- Configure a separate demo linked to the base game, including the executable, depots, packages and tester access.
- Test fresh install, content boundary, controls, settings, restart, quit, recovery and a usable route from the end of the demo to the store.
- Exclude inaccessible full-game menus and unintended full-game files; keep the intended save-sharing boundary.
- Verify the selected Next Fest edition's eligibility, prior-participation rule, registration status and exact deadlines and time zones.
- Confirm public store and demo readiness, plus review and resubmission cutoffs using that edition's current instructions.
- Plan feedback, support and optional livestreams only within the requested event scope; decide demo availability after the event.

## Depot build and promotion, when requested

Read existing AppBuild and depot VDFs before editing. Map App ID → depot → package entitlement → target branch.
Stage runtime files only; exclude credentials, development saves and unwanted source.
Use a permitted build account and interactive or approved credential handling. Keep passwords and Steam Guard codes out of generated files and history.

Authorized upload command shape:

```text
steamcmd +login <buildAccount> +run_app_build "<absolute-path-to-app-build.vdf>" +quit
```

Inspect `ContentRoot`, file mappings, exclusions and `SetLive` first.
Current SteamPipe supports `Preview "1"` for logs and manifests without upload; confirm VDF semantics against current docs.
`SetLive` can activate a beta branch after upload, so it belongs in the requested action scope.
Record the build ID and depot manifests. Test a clean Steam install and an upgrade from the previous public build.
Check launch options, redistributables, saves, achievements and Cloud only where used.
Retain a known-good build ID; assess save compatibility before rollback.
Patch notes should name the tested build, player-visible changes, save compatibility, known issues and workarounds.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Sample App ID or unchecked wrapper calls | Real application mapping and installed-version API |
| Reuse remembered capsule sizes | Download current slot templates and check portal requirements |
| Assume upload only transfers bytes | Inspect SetLive; it can also activate a beta branch |
| Developer account can launch, therefore testers can | Test intended package and depot entitlements on a clean client |
| Local build proves overlay behavior, Cloud sync or review approval | Report each separate Steam test and review outcome |
| Roll back binaries without checking save schema | Preserve progress; verify compatibility and recovery |

## Done when

- [ ] Requested files, configuration and mapping between app, depot and branch are concrete; unnecessary release work was skipped.
- [ ] Applicable SDK, art and event details are checked against current docs; credentials stay outside deliverables.
- [ ] Relevant Steam-client cases have evidence, or blockers involving accounts, permissions, runtimes or reviews are explicit.
- [ ] Code or build changes: inspect `pixo game verify --steps check,build --json`, including skipped steps; Unity and Steam features need separate checks in the player or Steam client.
- [ ] Art-only changes: verify final files with `pixo asset info <path> --json` and review current template and portal placement; a local check does not mean published or approved.
