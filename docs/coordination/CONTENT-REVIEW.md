# OpenPixo module map and content review

Updated: 2026-10-25 (Asia/Tokyo).

The user requested a breakdown of the running project and updates to inherited OpenDesign content. The subsequent explicit rebuild request has now made these changes available in the installed local `0.1.0-alpha.3`, which is left open for review. Historical Alpha.2 source/artifacts and prior acceptance evidence are preserved separately; see packaging (openpixo-internal: `docs/coordination/PACKAGING.md`) for the current install evidence.

## Current scope after user feedback

- Keep the shared OpenPixo name. Defer public account/repository work until the dedicated account is ready; product repository, feedback and release destinations are empty placeholders.
- Settings/rail source, feedback and release entries show pending state and do not navigate. Repository sharing waits for a configured destination; project sharing keeps working without a dangling repository label. All 19 dictionaries retain existing keys and interpolation tokens, with one localized pending-state key added.
- Continue ordinary local service/file/memory/MCP/update copy. Integration-guide and project-MCP direction discussions are deferred; this pass does not expand the existing guide draft.
- About describes the game workbench. Future OpenPixo services and inherited cloud providers are both in scope; no extra source-ownership disclaimer is added.
- List local Codex first, then other installed local CLIs, then the hosted option. Keep its usual OpenDesign name without the extra Cloud/source badge; sign-up appears after explicit hosted selection.
- Keep the shared name for source desktop windows and splash copy.

Latest verification: 25 focused web files / 585 tests, two contracts share tests and four desktop splash tests passed. Root `pnpm guard`, repository-wide `pnpm typecheck` and whitespace checks passed. The isolated desktop preview showed Codex, OpenCode, then OpenDesign with no source badge or sign-up promotion for the active Codex selection. Screenshots for this pass are under `.cache/verification/opx-adjustments/`.

The current About preview showed the game-workbench description and a disabled release link with the pending tooltip. The preview was stopped through `tools-dev stop` for `opx-copy`; desktop, web and daemon reported no remaining PIDs. The existing installed hands-on instance and release artifacts were outside this pass.

## Initial implementation and historical verification

- Project map (openpixo-internal: `docs/PROJECT-MAP.zh-CN.md`): six product modules, corresponding engineering ownership, and a classified list of remaining inherited content.
- Public identity and repository/release/feedback links have one pure source in `packages/contracts/src/product.ts`. The CLI binary is `pixo` (ADR 0008). Existing package names, request kinds, persisted keys, and host protocols stay compatible.
- Settings and rail support links point to OpenPixo. Those surfaces no longer promote upstream social accounts, email support, or a team edition.
- Ordinary product copy and sharing use OpenPixo. The technical guide now explains local game projects, Codex, real files/assets, and the two MCP directions, with English/Chinese content and compatible locale keys.
- About describes the game workbench, onboarding-reset copy describes agent/provider setup, and privacy copy reflects default-disabled optional telemetry without claiming an OpenPixo receiving service.
- Codex appears first in local model settings. The upstream hosted option retains its actual OpenDesign Cloud identity, with a hosted-source label; the sign-up promotion only appears for an explicit hosted selection.
- Source desktop startup and default window titles use the same public product name.

The homepage still offers inherited design scenarios and galleries. The module map records those as a later navigation/content pass, alongside deeper content packs and the desktop crash-recovery page. License/source attribution is intentionally retained.

## Verification

- Shared contracts build and focused social-share tests: passed, 2 cases.
- Web menus, guide/copy flow, update/what’s-new surfaces, game entry, GitHub badge, homepage creation copy, and the locale folder: 451 distinct cases passed across the focused run and corrected-file rerun. Two old display-name expectations and the renamed snippet label were updated. A pre-existing 17-locale homepage `{word}` mismatch was confirmed against HEAD and aligned with the game headline.
- Desktop splash tests: 9 passed. The existing source-comparison test now normalizes CRLF before comparing shader contents; it previously failed on this Windows checkout without a product shader change.
- `pnpm guard`, repository-wide `pnpm typecheck`, and `git diff --check`: passed.
- Settings execution/selection, hosted-login race, MCP install, and About regression file: all 153 passed. The hosted-login race now starts through the explicitly selected provider card and defers the mocked login result until after the newer local selection is saved.

The isolated `tools-dev` preview used namespace `opx-copy`, explicit isolated storage, and no automatic env-file loading. No first-run Test/Continue or model task was invoked. Normal local UI preferences were prepared in that isolated profile to inspect home/Settings without consuming model usage; this is presentation verification, not first-run or provider acceptance.

The initial preview confirmed the OpenPixo title and the then-configured support destinations. It also showed the extra OpenDesign Cloud/source label that the latest feedback above supersedes. Historical screenshots: `.cache/verification/opx-copy/home-zh.png` and `settings-zh.png`. Development About still reports the inherited workspace package version; installed/product version evidence remains the Alpha.2 manifest’s responsibility.

No model/provider task, public upload, commit, installation, or package replacement was performed for this content review. Preserve the pre-existing working-tree documentation/E2E edits.

Cleanup completed through `tools-dev stop --namespace opx-copy`: desktop, web, and daemon all stopped with empty `remainingPids`. The installed hands-on instance was outside this namespace and was not targeted.
