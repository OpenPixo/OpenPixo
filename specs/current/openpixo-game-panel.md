# OpenPixo game-first side panel

Status: implemented; refined 2026-11-06 (see "Changes since" below). This spec
owns the **inside** of the project side panel. The panel's outer box, its
48px header row and the conversation column stay governed by
`openpixo-ui-cleanup.md` (tokens, colours, motion); where this file changes
the header contents, it replaces §3 "Panel header" of that spec.

## Changes since the 2026-11-03 design

User direction 2026-11-06: too much at once, unclear what you are looking at.

- 资源库 is now called 文件 (Files) on screen. Code keeps the name `library`.
- The snapshot history (⟲) moved from the header to 改动's toolbar. The header is
  the views, ⋯ and maximise, plus the engine chip once an engine is recognised; an
  unrecognised engine shows no chip (engine settings stay in ⋯).
- 游戏's toolbar lost the 验证 split caret; "运行并截图" moved into the 试玩 menu.
- Pressing the current view again returns to its list. A host-driven open (the
  auto-open after a turn) puts only the turn's main artifact on the stack, not every
  file the turn produced: the 文件 tab used to open as a pile of viewers to back out of.
- 改动's list opens with "N files changed, +a −b". An image that was only added or
  only deleted shows one side, not an empty "before" box.

## 1. Why

User direction, 2026-11-03: the right side panel "still not ideal". Review at
1440x900 on a Unity project found:

| # | Today | Problem |
|---|---|---|
| 1 | Default section is 素材, a two-column gallery of large cards with full paths | Not what a developer wants when returning to a project. |
| 2 | 文件 filters 图片 (711) and 素材 browses the same `art/` tree | Two browsers for one folder. |
| 3 | Five sections: 文件 · 素材 · 生成 · 调参 · 扩展 | Different kinds of thing: a core tool, a gallery, a recipe catalogue, an instruction page (Unity has no tunables) and an admin form. |
| 4 | Panel stays put while the agent reads, edits and generates | The user hunts for what changed. |
| 5 | 运行 / 验证 / 试玩 are header buttons that open **modal dialogs**; the web-engine preview is an iframe inside the Run dialog | The game has no home; closing the dialog makes it vanish. |
| 6 | Opening a file adds a header tab beside 项目 and hides the section row | Tabs inside tabs inside a panel. |

Target: the panel shows **the game** and **what the agent changed**, with the
project's files and assets one click away. Same calm as the Codex desktop app's
side pane.

## 2. Decisions (user, 2026-11-03)

1. Direction: game-first panel with three views — 游戏 / 改动 / 资源库.
2. Auto-follow: **badge only.** 改动 shows a count badge while the agent
   works; the panel never switches view on its own.
3. Opened files: **in place, with back.** A file, image or diff replaces the
   current view's body with a ← back control. No file tabs in the header.
4. Web-engine Run plays **inside 游戏**; ⤢ maximises it; "Open in browser"
   stays available.
5. Diffs ship in v1: a new checkpoint file-diff endpoint with its `pixo`
   subcommand (UI/CLI dual-track).

## 3. Layout

```
┌ [游戏] [改动 •3] [资源库]            engine ⟲ ⋯ ⤢ ┐  48px header
├───────────────────────────────────────────────────┤
│  view body (each view owns its own 36px toolbar)  │
└───────────────────────────────────────────────────┘
```

Header, left to right:

1. View switcher: 游戏 · 改动 · 资源库 (segmented control, `--shell-radius`,
   active item `--accent`). 改动 carries the badge from §5.
2. Engine chip (dropped below 520px panel width, as today).
3. Checkpoints (⟲) — existing `ProjectCheckpointHistory`.
4. ⋯ menu: 项目扩展 (the former 扩展 section, as a sheet), terminals and side
   chats (former `+` launcher items), engine settings.
5. Maximise / restore panel.

验证 / 试玩 / 运行 leave the header and live in the 游戏 view toolbar. Header
height stays `--shell-header-height`; no second header row. The view choice
persists per project (`pixo:project-panel-view:<projectId>`, replacing
`pixo:project-workspace-tab:<projectId>`); default is 游戏.

In-place navigation: each view keeps a small stack. Opening a file pushes
a viewer onto the current view's stack; the view toolbar shows `← <file name>`
plus the file actions (existing file-actions portal). Switching views keeps
each view's stack, so 改动 → diff → 游戏 → 改动 returns to the diff. Esc or ←
pops. Terminals and side chats open the same way from ⋯ (pushed onto the
current view's stack).

Where an open lands:

- From inside a view (a 资源库 row, a 改动 row, a 游戏 log link): that view's
  stack.
- From the conversation (file links, artifact cards, inline assets, "open in
  panel"): the 资源库 stack, switching the panel to 资源库 and showing the
  panel if hidden. The user clicked, so this does not conflict with
  decision 2; it keeps a running game in 游戏 from being covered.

## 4. 游戏 view

```
toolbar: [▶ 运行 | ■ 停止]  [验证]  [试玩 ▾preset]          status text
┌───────────────────────────────────────────────┐
│ stage                                         │
│  · web engine running  → live iframe          │
│  · otherwise           → latest screenshot    │
│  · nothing yet         → empty state + Run    │
└───────────────────────────────────────────────┘
上次验证  ✓ 检查  ✓ 构建  ✓ 运行   · 3 分钟前      (expand → step logs)
上次试玩  preset · seed · ✓/✗ · frames            (expand → frames)
▸ 调参     only when /game/tuning reports parameters
▸ 日志     run log tail, install log
```

- **Stage.** When `GameRunStatus.status === 'running'` and the URL passes
  the existing `previewUrl` loopback check, the stage renders the iframe with
  the current sandbox flags. Otherwise it shows the newest screenshot from
  `/game/verify/latest` or the last playtest. Native engines (Unity, Godot,
  desktop) run in their own window; the stage says so and keeps the last
  screenshot.
- **Run / Verify / Playtest** keep their behaviour and daemon calls; only
  their container changes from `Dialog` to inline sections. Dependency
  install, missing-tool guidance and error details render inline under the
  toolbar, not in a dialog. Playtest's script editor opens as a sheet from
  试玩 ▾ (it is the one form large enough to need one).
- **Starter requests** (`starterRunRequest` → `startRequest` nonces for
  verify / run-game) switch the panel to 游戏 and start the action. This is
  user-initiated, so it does not conflict with decision 2.
- **Tuning** is the existing `TuningPanel`, mounted inside a disclosure. When
  the engine reports no parameters, the disclosure is absent (no instruction
  page). Each parameter is one line: label, control, then icon actions
  (reset to default, scene override badge, open in code).
- **Split.** The view itself never scrolls. While 调参 or 日志 is open, a
  divider (`role="separator"`) between the stage and the bottom area sets
  their heights by drag or keyboard; double-click or Enter resets it. The
  bottom area scrolls inside itself. Bounds and storage live in
  `components/panel/game-split.ts`; the height is remembered per viewer.
- ⤢ maximise with a live web game gives the stage the full workbench width.

## 5. 改动 view

```
toolbar: [本轮 | 本会话]                       [撤销这一轮]
images   ▢ ▢ ▢ ▢ →        (generated this turn / session)
files    M scripts/player.gd        +12 −3
         A art/game/bg/dusk.png
         D scenes/old.tscn
```

- **Source of truth.** Files come from the project's checkpoints:
  `ProjectCheckpoint.runChanges` (frozen at run completion) for the selected
  run; 本会话 unions the checkpoints with the active `conversationId`. While
  a run is still going, the list shows the run's in-progress changes from the
  checkpoint `currentChanges` call and refreshes on the run's file events.
  Images come from the same rule as the chat gallery
  (`runtime/chat/turn-assets.ts`); do not invent a second detection rule.
- **Badge.** Count of changed paths in the active run that the user has not
  opened in 改动 since they appeared. Cleared when the user opens 改动.
  Never moves the panel.
- **Row click** pushes a diff viewer (text) or a before/after viewer
  (image) in place. Binary non-image files open the current file.
- **撤销这一轮** calls the existing checkpoint restore with its confirmation;
  shown only when the selected run has a checkpoint.
- **Every project has a record.** Until 2026-11-06 this was the reason users saw no
  changes at all: a new project had no folder at its first run (the snapshot failed
  with ENOENT), then no Git repository, so 改动 could only ask for "version
  protection"; an imported folder was the same, and a folder inside another repository
  got "not_project_root". A folder that is not its own repository root now keeps its
  checkpoints in a private store under the daemon data root
  (`projects/checkpoint-store.ts`), with the folder as the work tree: nothing is
  written into it, so no opt-in is needed. A store that exists keeps winning, so a run
  that scaffolds a repository mid-way still finds the checkpoint it started from.
  Dependency and engine output stay out of it, and a folder too large to hash on every
  run reports `project_too_large`.
- **OpenPixo's own files are not changes.** The reserved folders (`.file-versions`,
  `.live-artifacts`, at any depth) stay out of every checkpoint, in a store and in the
  project's own repository, so a run never lists them and an undo never rewinds them.
  Older checkpoints still hold them, so what is read back from one is filtered, and an
  undo writes that checkpoint's tree without them. HTML version history is therefore
  append-only across an undo: the undo adds a `restore` version when the file no longer
  matches "current", as a restore from the viewer does.
- **Unavailable checkpoints** (`status: 'unavailable'`: no Git installed, submodules,
  too large): the view explains why; images still show.

### Diff endpoint (new)

- HTTP: `GET /api/projects/:id/checkpoints/:checkpointId/diff?path=<rel>` →
  `ProjectCheckpointFileDiff` in `packages/contracts/src/api/checkpoints.ts`:
  `{ path, status, binary: boolean, hunks: { header: string; lines: { kind: 'context' | 'add' | 'del'; text: string }[] }[], truncated: boolean }`.
  A checkpoint is the project **before** its run (taken at run start), so
  the run's own change is checkpoint → run end state. `finish()` records the
  end tree as `refs/openpixo/checkpoint-results/<id>` (pruned with its
  checkpoint); while the run is still going, or for checkpoints finished
  before that ref existed, the after side is the working tree and the
  response says `target: 'working_tree'`.
- Raw versions for image before/after:
  `GET …/checkpoints/:checkpointId/file?path=<rel>&side=before|after`
  (`nosniff`, sandbox CSP; non-images served as attachments).
- CLI, in the existing `checkpoints-cli.ts` (same endpoints; `<projectId>`
  like every other checkpoint subcommand):
  `pixo project checkpoint diff <projectId> <checkpointId> [--path <rel>] [--json]`
  and `pixo project checkpoint file <projectId> <checkpointId> --path <rel> --side before|after --out <file|->`.
- Size cap and `truncated` so large generated files do not stall the panel.

## 6. 资源库 view

- One browser for files and assets: list or grid toggle, type filter
  (全部 · 图片 · 音频 · 脚本 · 场景 · 其它), path search, breadcrumb. Default
  list; grid is remembered per project.
- Asset actions from `GameAssetsPanel` (素材详情, import, add to chat,
  "generate from") stay available on image rows/cards.
- **生成素材…** button in the toolbar opens the recipe picker
  (`StudioPanel`) as a sheet over the view; the composer entry points and
  `tabRequest: 'generate'` open the same sheet.
- `FilesPanel.tsx` (2,326 lines) is split while being merged: list/grid
  rendering, filters and folder actions become separate modules; behaviour
  owned by tests stays.

## 7. Removed or moved

- The `项目` pinned tab and the second-row section switcher
  (`GameProjectWorkspace` nav) — replaced by the view switcher.
- File, terminal and side-chat header tabs and the `+` launcher — replaced by
  in-place stacks and the ⋯ menu. Ctrl+T / Ctrl+W / Ctrl+Tab project-tab
  shortcuts in `WorkspaceTabsBar` are unaffected.
- 扩展 section → ⋯ › 项目扩展 sheet. 生成 section → 资源库 sheet. 调参 section
  → 游戏 disclosure.
- Run / Verify / Playtest dialogs → 游戏 view (Playtest editor stays a sheet).

## 8. Delivery slices

File ownership is disjoint so slices can run in parallel; slice 1 lands
first because 2–4 mount inside it.

1. **Panel frame.** View switcher, header changes, per-view in-place stack,
   ⋯ menu, persistence key, removal of file tabs. Owns
   `GameProjectWorkspace.*`, the header part of `FileWorkspace.tsx`,
   `ProjectView.tsx` `headerActions` wiring. Until slices 2–4 land, the views
   hold temporary mounts of today's components: 游戏 = the existing
   Verify / Run triggers (still dialogs) plus the tuning disclosure; 改动 = an
   empty mount point; 资源库 = today's file browser and asset gallery behind a
   temporary list/gallery toggle, with 生成素材… opening `StudioPanel` in a
   sheet. Nothing ships until all four slices are merged.
2. **游戏 view.** Inline Run / Verify / Playtest, stage, tuning disclosure.
   Owns `components/game/*`.
3. **改动 view + diff endpoint.** Contract, daemon route, CLI subcommand,
   view and diff viewer. Owns `checkpoints.ts` contract,
   `routes/project-checkpoints.ts`, `projects/checkpoints-cli.ts`, new
   `components/changes/*`.
4. **资源库 view.** Merge of `FilesPanel` and `GameAssetsPanel`, Studio sheet.
   Owns `FilesPanel.tsx`, `GameAssetsPanel.*`, `components/files/*`,
   `components/studio/StudioPanel.tsx` container.

i18n keys for all slices go in `types.ts`, `en.ts` and `zh-CN.ts` together.

## 9. Acceptance

- At 1440x900 and 960x760: one header row, no clipping; 游戏 is the default.
- Phaser sample: 运行 plays inside 游戏; ⤢ maximises; stop works; no dialog.
- Unity project: 游戏 shows the latest verify screenshot and step results; no
  调参 disclosure.
- An agent turn that edits files shows a 改动 badge without moving the panel;
  opening a row shows a diff; 撤销这一轮 restores through the existing
  confirmation.
- `pixo project checkpoint diff … --json` returns the same payload as the UI
  endpoint.
- Opening a file from any view shows ← back; Esc returns; switching views
  keeps each view's stack.
- `pnpm guard`, `pnpm typecheck`, focused web/daemon tests for touched files.
