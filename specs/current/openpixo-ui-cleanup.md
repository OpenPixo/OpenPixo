# OpenPixo UI cleanup: workspace shell and visual language

Status: implemented for the project workspace shell on 2026-11-03 (worktree
`ui-workspace-shell`). This file is the shared visual language for the other UI
sessions in the same overhaul (sign-in/first-run, settings, inline assets and run
status, new-project wizard, right-side generation panel, chat image
generation). When you build a new surface, use the tokens and rules below
instead of inventing local numbers.

User direction, 2026-11-03: the project page ("代码页面") is confusing and
cluttered, does not start from what the user is doing, and does not feel like a
polished app. Target feel: as calm as the Codex desktop app or Claude Code, with
game-specific affordances (run, verify, playtest, engine, assets) where a game
developer expects them.

## 1. What was on screen before

Captured at 1440x900 and 960x760 on a fresh sample project (Phaser platformer):

| # | Chrome | Problem |
|---|---|---|
| 1 | A 44px top row holding only a Home glyph (and an empty account host) | Spends a full row on one button that the sidebar brand already provides. Home had already removed this row; the project page had not. |
| 2 | Two different sidebars: Home used `EntryNavRail` (New game, Search, Home, My games, Workshop, Recent, quests, account dock); a project used `ProjectSidebar` (brand, Recent, then Workshop / Models and providers / Keyboard shortcuts as loose rows) | Entering a project changed the whole left column. New game and Search vanished; settings moved. |
| 3 | A project switcher dropdown (`my-game ⌄`) docked above the chat | Third list of projects (sidebar tree, dropdown, Home). It is the inherited upstream browser-tab strip in disguise. |
| 4 | "Collapse chat" icon in the chat column | The only layout control, and it hid the conversation rather than the side panel. There was no way to give the conversation the full width. |
| 5 | Right panel header: pinned `文件` tab, `+`, then `历史快照`, engine badge, `验证`, `试玩`, `运行` | At 960px the header overflowed: the pinned tab was cut off and the run controls were hidden. |
| 6 | A second row inside that pinned tab: `文件 / 素材 / 生成 / 调参 / 扩展` | `文件` appeared twice, one row apart, meaning two different things. |
| 7 | Inconsistent heights: 44px chrome, 40px rail header, 44px panel tabs, 52px sub-tab row; sidebar buttons at 36px, panel controls at 28–32px | Rows did not line up across columns. |

Inherited upstream leftovers that are still mounted but no longer visible
(kept because shortcuts and tests use them): the workspace tab strip
(`WorkspaceTabsBar`, still owns Ctrl+T / Ctrl+W / Ctrl+Tab and the project
delete dialog) and the floating account-actions host (updater rocket).

## 2. Target layout

```
┌────────────┬──────────────────────────────────┬───────────────────────────┐
│ Sidebar    │ Conversation header (48px)       │ Panel header (48px)       │
│ 244px      │  project › session   [⟲] [▯]     │  [Project][file tabs] [+] │
│ (52px      │                                  │  … engine ⟲ 验证 试玩 ▶ ⤢  │
│ compact)   ├──────────────────────────────────┼───────────────────────────┤
│            │                                  │ Files · Assets · Generate │
│ New game   │  messages                        │ · Tuning · Extensions     │
│ Search     │  (centered, max 760px when the   │                           │
│ Home       │   panel is hidden)               │  panel body (owned by the │
│ My games   │                                  │  right-panel session)     │
│ Workshop   │                                  │                           │
│ Recent     │  composer                        │                           │
│  ▸ project │                                  │                           │
│    session │                                  │                           │
│ account ⚙ ?│                                  │                           │
└────────────┴──────────────────────────────────┴───────────────────────────┘
```

- **Left: one sidebar everywhere.** Home and a project render the same
  `EntryNavRail`. In a project no destination is highlighted; the project and
  session rows in Recent are. New game opens the same dialog Home opens; Search
  opens the same project palette (Ctrl/Cmd+K). Ctrl/Cmd+B collapses it to the
  52px compact rail. Inside a project, below 1080px the rail starts compact
  and opens over the workbench (the workbench needs both columns); Home keeps
  its full rail.
- **Center: the conversation.** It owns the flexible width. Its header names
  where you are (project name, then the session title) and carries only the
  session history menu and the side-panel toggle.
- **Right: a collapsible panel** for the game workspace (files, assets,
  generation, tuning, extensions) and opened files. The panel toggle hides it and
  gives the conversation the whole width; the conversation then centres in a
  760px column. The panel's own maximise control hides the conversation instead
  (the previous "focus" mode), for a large game preview. The hidden/shown
  choice persists (`openpixo.project.panelHidden`); maximise lasts for the
  visit.
- **No top chrome row** on Home or in a project. The window title bar is native
  on Windows; a 12px drag strip remains for frameless hosts.

## 3. Header action sets

Conversation header, left to right:

1. Project name (14px/600, `--text-strong`), separator `›`, session title
   (13px/500, `--text-muted`), both ellipsised.
2. Session history menu (existing control, one icon).
3. Side-panel toggle (`panel-right` icon; tooltip "Hide panel" / "Show panel").

Panel header, left to right:

1. Tabs: the pinned workspace tab (label **Project / 项目**, never "Files"), then
   opened files, terminals and side chats, then `+`.
2. Game actions, right-aligned, in this fixed order: engine chip, checkpoints,
   Verify, Playtest, Run. Run is the right-most game action. These are the only
   project-level actions; do not add more buttons here — new project actions
   go into an existing menu or the composer.
3. File actions portal (only while a file tab is active).
4. Maximise / restore panel.

Below 520px of panel width the engine chip is dropped so tabs and actions keep
one row. When the panel is narrower still, the action group wraps to a second
row instead of overflowing or clipping the tabs.

Inside the pinned Project tab, the second row is the section switcher
`Files · Assets · Generate · Tuning · Extensions` (a quiet segmented control,
36px). Sections never repeat the tab name.

## 4. Tokens

All shell tokens live in `apps/web/src/styles/tokens.css` under the
`--shell-*` prefix. Use them for any container-level layout. Existing scales in
`styles/base.css` (`--spacing-*`, `--font-size-*`) remain the source for
component internals.

| Token | Value | Use |
|---|---|---|
| `--shell-header-height` | 48px | Every column header (conversation, panel, sidebar top row). |
| `--shell-subheader-height` | 36px | Section switchers and toolbars directly under a header. |
| `--shell-sidebar-width` | 244px | Expanded sidebar. |
| `--shell-sidebar-compact-width` | 52px | Collapsed sidebar. |
| `--shell-gutter` | 16px | Horizontal padding of headers and panel bodies. |
| `--shell-gap` | 8px | Gap between header controls. |
| `--shell-control-size` | 28px | Icon buttons in headers (16px glyph). |
| `--shell-conversation-max-width` | 760px | Conversation column when the panel is hidden. |
| `--shell-radius` | 8px | Header controls, tabs, segmented items. Cards use `--radius-xlarge` (12px). |
| `--shell-title-font` | 600 14px/20px | Header title. |
| `--shell-meta-font` | 500 13px/20px | Header secondary text, tabs. |
| `--shell-label-font` | 500 11px/16px mono, 0.08em, uppercase | Section labels (Recent). |

Colour rules (no new colours; use the existing tokens):

- Surfaces: sidebar `--sidebar-bg`; conversation `--bg`; side panel
  `--bg-panel`; headers share their column's surface (no extra fill, no
  shadow). Columns are separated by one `--line` hairline, never by a gap or a
  shadow.
- Text: titles `--text-strong`, body `--text`, secondary `--text-muted`,
  disabled `--text-faint`.
- Violet (`--accent`) is for the one primary action in view and for selection
  (active tab, active section, focus ring). Lime is the brand pixel only.
- Hover: `--sidebar-hover` in the sidebar, `--bg-fill-secondary` elsewhere.

Motion follows the root `AGENTS.md` rules: `--ease-out`, 200ms enter, 140ms
exit. Maximise keeps its animated grid track; hiding the side panel swaps the
track without animation (an `fr` track cannot interpolate); nothing scales
from `scale(0)`.

## 5. What was removed or merged

- Removed: the project route's top chrome row (Home glyph + empty host).
- Removed: the project switcher dropdown above the chat (the sidebar tree is the
  one project list). The strip still mounts invisibly in the zero-height chrome
  for its keyboard shortcuts.
- Merged: `ProjectSidebar` now renders `EntryNavRail`; its loose
  Workshop / Models and providers / Keyboard shortcuts rows are gone (Workshop
  is a destination, settings and help sit in the account row).
- Moved: "collapse chat" became the panel's maximise control; the conversation
  header gained the side-panel toggle.
- Renamed: the pinned panel tab is "Project / 项目" so "Files / 文件" only
  names the file section.
- Compacted: the engine chip shows the engine and version only (confidence
  moved to its tooltip); checkpoints became an icon button.
- Fixed: the sidebar's New game opened the legacy media-project modal. On
  Home and inside a project it now opens the same game dialog as Home's own
  New game button (`requestEntryNewGame` in `entryRailBridge.ts`, taken by
  `HomeDashboard`).

## 6. Boundaries for the other sessions

- Right panel internals (FilesPanel, GameAssetsPanel, StudioPanel and their
  toolbars) belong to the right-panel session. The shell owns the panel's
  header rows and outer box only.
- Chat message rendering, inline assets and run status belong to the chat
  sessions; the shell owns `.split-chat-slot` and the conversation header.
  Pinned chat elements and scroll plumbing follow
  `apps/web/src/components/chat/AGENTS.md` and are not changed here.
- Settings and the new-project dialog keep their own layouts; open them with
  the existing calls (`onOpenSettings`, `requestEntryNewGame`).
