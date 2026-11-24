# Game templates

Each `<id>/template.json` contains `id`, `name`, `engine` (a game engine id from
the shared contracts), and `description`. Its `files/` tree is copied verbatim
into a new, previously nonexistent project directory. The manifest is catalog
metadata and is not copied. `files/` never includes dependencies or build output.
Optional `nameZhCN` and `descriptionZhCN` fields provide Simplified Chinese catalog
copy; `name` and `description` remain the English fallback for API and CLI clients.

An optional `genres` array marks the template as a kit: a starter that already has
one genre's systems built. Its values are new-game genre preset ids (`visual-novel`);
the setup dialog offers and recommends the kit only for those genres, and the agent's
starter list labels it as a kit.

An optional `<id>/cover.webp` (or `cover.png`) is the catalog cover: an original,
in-game-style screenshot at 2:1, kept under about 250 KB. It sits beside `files/`,
so it is never copied into projects. When present, `GET /api/game-templates`
lists it as `coverUrl` (`/api/game-templates/<id>/cover`) and Home uses it
instead of an art-style preview.

An optional `<id>/instant/` holds the packages the game needs at run time, so a game
made to be played right away starts before its own packages are installed. It sits
beside `files/`, so it is never copied into projects. Each package is its upstream's
single ES module file, unchanged, with its licence beside it; `instant/packages.json`
lists it as `{ "<import name>": { "version": "...", "file": "..." } }`, at exactly the
version `files/package.json` asks for. Nothing is built: the daemon serves the project's
own source files (`apps/daemon/src/game/instant-server.ts`) and moves to the normal dev
server when the packages are there. That works for a game of TypeScript modules, `?raw`
imports and `public/` files without a Vite config, and the daemon's tests walk every
import of the sample to keep it so. Only `phaser3-sample-platformer` has one; it costs
the installer about 0.3 MB.

The Vite starters use exact dependency versions and TypeScript only. In a copied
project, run `pnpm install`, then `pnpm dev` to play or `pnpm build` to build.
Phaser uses the arrow keys; Three.js displays a lit, rotating cube.
The `phaser3-sample-platformer` is a complete playable learning sample with local
pixel art and synthesized sounds. It needs no media generation key. Its
`generate-assets.ts` regenerates the six original PNG/WAV files using only Node
built-ins: run `node game-templates/phaser3-sample-platformer/generate-assets.ts`
from the repository root. The generator stays outside `files/`, so it is not
copied into new projects.

Open either Godot starter's `project.godot` in Godot 4 and press F5. No editor plugin
or C# toolchain is needed. Both open on a title screen and ship what a game sold on
Steam needs from its first scene, so a project extends them instead of rewriting them:

- A title screen, a pause menu, and a settings screen with windowed and fullscreen
  modes, volume, language and a way to quit to the desktop.
- Input actions on keyboard and gamepad with rebinding. The menus work on a gamepad
  alone: Godot's default `ui_accept` and `ui_cancel` have no gamepad button, so
  `project.godot` adds them.
- Settings and saves under `user://`, never beside the game files.
- A string table, `i18n/strings.csv`, loaded at startup. Its `.import` file keeps the
  CSV as it is, so an edit needs no import step and the file is exported as written.

They carry no Steamworks code and no App ID; the `steam-release` skill adds those when
a project calls for it. Everything except `project.godot`'s name and `game/` is
identical in both starters, so change them together. Each starter's `README.md`
explains how to extend it. `godot --headless --path . --import --quit` validates
import for either. `--script` runs before autoloads exist, so `--check-only` works
only on a script that does not name one, such as `game/player.gd`.

`godot4-story` is the story kit, a visual novel built on `godot4-2d`: it shares that
starter's menus, settings, saves and string table byte for byte and owns
`project.godot`, `game/`, `story/`, `checks/`, `addons/`, its `README.md`, the
rebindable actions in `autoload/settings.gd` and the story rows of
`i18n/strings.csv`. A story is plain `.story` text per language; its README is the
map, and `checks/story_check.gd` proves every label, translation and ending headless.

`phaser3-story` is the same kit for the browser: the same story format and the same
sample story byte for byte, the plain Phaser starter's exact versions, and its own
title, settings and pause screens. `pnpm run check` typechecks and runs
`scripts/check-story.ts`, which Node 24 runs without an install, so the story check
also runs in `pixo game verify`.

Both kits ship an `AGENTS.md`: the project notes Codex and OpenCode load into an
agent's instructions on their own (see `renderProjectNotesRule`), so an agent starts
with the kit's map instead of reading the project. Keep it under about 60 lines; the
agent updates it as the game grows. The README is the full manual.

Set `PIXO_TEST_GODOT` to a Godot executable to have the daemon's template tests play
both starters in the real engine with real input events.

`game-templates/` is intentionally outside the `pnpm-workspace.yaml` package
globs and package tsconfig includes. Install and build copied projects outside
this repository so dependencies and generated JavaScript remain outside the
source tree. Packaged builds ship this directory as a daemon read-only resource.
