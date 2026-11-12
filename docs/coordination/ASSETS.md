# OpenPixo project asset workflow

Updated: 2026-10-25 (Asia/Tokyo). Owner: `game_assets`.

## Delivered

- `GameProjectWorkspace` wraps the existing file workspace with compact Files / Assets / Extensions navigation. Assets is the default; the original Files panel and viewers are retained. The Extensions panel is supplied by `upstream_review`.
- `GameAssetsPanel` uses the existing recursive project file inventory and `/raw/` streaming routes. There is no second asset store, copy, or indexing service. Imported folders remain the source of truth.
- Image thumbnails, audio/video controls, name/path and type filters, multi-selection, and direct project-relative chat references are implemented. Audio and unknown file references stay file paths, never base64 copies. Refresh uses the existing project refresh lifecycle; new/derived files arrive through the same file state.
- Unrecognized formats show MIME, size, timestamp, original path tooltip, viewer action, and an external-open action.
- Existing `POST /api/projects/:id/open-in` accepts optional `fileName`. The upstream symlink-aware file resolver verifies the target before the existing known-editor launch plan runs; no command strings or shell interpolation were introduced.
- CLI parity: `pixo project assets <id> [--kind all|image|audio|video|other] [--query <name>] [--json]`; `pixo project open-in <id> --editor <id> --path <relative-file>`.
- Shared filter lives in `packages/contracts/src/api/game-assets.ts`. New `gameAssets.*` i18n keys exist in all 19 dictionaries; English and Chinese are localized.
- `ProjectView` passes the latest active native Codex run ID to the approval UI owned by `runtime_core/approval_ui`.

## Checks

- Contracts filter: 2/2 passed.
- Asset UI interactions: 3/3 passed (image/audio presentation, multiple original paths, filter, derived-file refresh state, removed selections, error feedback, read-only controls).
- Host open safety/regression: 7/7 passed across `host-tools-asset-open`, `host-tools-open-in-route`, and `host-tools-launch-shell`.
- New CLI parity tests: 2/2 passed; selected with `-t 'game asset'`, unrelated tests were skipped intentionally.
- `@openpixo/web typecheck`: passed.
- Daemon typecheck was attempted; no asset diagnostics. Other active slices had temporary `runs.ts` request typing and `project-extensions.ts` optional-field errors; owners notified. Final integrated typecheck belongs to the orchestrator.

All pnpm commands used the workspace-local Node 24 and pnpm 10 toolchain. Windows sandbox realpath restrictions required running checks outside that sandbox.

## Remaining acceptance

The QA agent owns the real tools-dev UI/API fixture acceptance. Native external application launch, a user's actual game, and large-project performance have not been claimed as verified by these focused checks. External open depends on the OS file association or installed editor.

## Curated batch skill

`skills/game-assets-batch/SKILL.md` is a genuine, self-contained utility workflow for selected project image/audio inputs. It reuses detected installed tools or a supplied bundled FFmpeg path, preserves originals with hashes, uses deterministic project-relative derived paths, refuses overwrites, and records per-input results. It adds no runner or dependency.

Portable frontmatter/body passed the bundled skill-creator validator. Repository-specific metadata (`triggers`, localized copy, `pixo.mode`) was validated separately; the real daemon scanner found `game-assets-batch` as `utility` in `game-development`. End-to-end media processing is reserved for the orchestrator's native Codex smoke; this validation does not claim transformed assets exist.
