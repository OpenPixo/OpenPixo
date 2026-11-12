# Game templates

Each `<id>/template.json` contains `id`, `name`, `engine` (a game engine id from
the shared contracts), and `description`. Its `files/` tree is copied verbatim
into a new, previously nonexistent project directory. The manifest is catalog
metadata and is not copied. Templates never include dependencies or build output.
Optional `nameZhCN` and `descriptionZhCN` fields provide Simplified Chinese catalog
copy; `name` and `description` remain the English fallback for API and CLI clients.

An optional `<id>/cover.webp` (or `cover.png`) is the catalog cover: an original,
in-game-style screenshot at 2:1, kept under about 250 KB. It sits beside `files/`,
so it is never copied into projects. When present, `GET /api/game-templates`
lists it as `coverUrl` (`/api/game-templates/<id>/cover`) and Home uses it
instead of an art-style preview.

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

Set `PIXO_TEST_GODOT` to a Godot executable to have the daemon's template tests play
both starters in the real engine with real input events.

`game-templates/` is intentionally outside the `pnpm-workspace.yaml` package
globs and package tsconfig includes. Install and build copied projects outside
this repository so dependencies and generated JavaScript remain outside the
source tree. Packaged builds ship this directory as a daemon read-only resource.
