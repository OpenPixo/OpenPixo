# Project notes

A visual novel made from OpenPixo's Godot story kit (Godot 4, GDScript). The engine
already works: typed text, choices, variables, endings, log, auto, skip, saves,
settings with rebinding, and two languages. Build the game by writing `story/` and
adding art; change code only for what the story needs. README.md has the full format.

## Where things are

- Story: `story/<language>/*.story`, read in file-name order, labels shared. Starts at `== start`.
- Cast: `story/characters.json` (`name` per language, `color`).
- Art and sound, by name, no code change: `art/backgrounds/<name>.png`,
  `art/characters/<id>_<expression>.png` (or `<id>.png`), `audio/music/<name>.ogg`,
  `audio/sfx/<name>.ogg`. Until a file exists the game draws a placeholder.
- Menu and button text: `i18n/strings.csv`. Game name: `config/name` in `project.godot`.
- Text speeds: constants at the top of `game/game.gd`. Look: `game/game.tscn`, `ui/theme.tres`.
- Story engine (names no autoload, so the check can use it): `game/story/parser.gd`,
  `runner.gd`, `library.gd`. Stage drawing: `game/stage.gd`.
- `addons/story_files` packs `.story` files into exports; keep it enabled.

## Story lines

```text
== label            @bg name | none      @show id [expression] [left|center|right]
narration text      @music name | stop   @hide [id]
ren: spoken line    @sfx name            @wait 0.5
? question          @set flag = true     @add trust 1
- option -> label   - option -> label if trust >= 2
@if met and trust >= 2 -> label          @jump label        @end id Ending title
```

Every language folder keeps the same labels and commands in the same order; only text
changes. A label that runs out of lines goes on to the next label in file order.

## Check, run, playtest

- `godot --headless --path . --import --quit` once after copying, then
  `godot --headless --path . --script checks/story_check.gd` after every story edit.
  It names file and line for broken labels, unknown characters, variables nothing sets,
  unreachable labels and endings, and translations that drifted.
- Playtest: Enter, Space, A or a click advances; arrows and Enter pick a choice; Ctrl or
  RB held skips; A key or X toggles auto; L, Y or the wheel opens the log; Esc or Start pauses.
- Saves: `user://save.json` (removed when an ending is reached), endings found:
  `user://endings.json`, settings: `user://settings.cfg`.
