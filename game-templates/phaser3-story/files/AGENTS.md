# Project notes

A visual novel made from OpenPixo's Phaser story kit (Phaser 3, TypeScript, Vite).
The engine already works: typed text, choices, variables, endings, log, auto, skip,
saves, settings and two languages. Build the game by writing `story/` and adding
art; change code only for what the story needs. README.md has the full format.

## Where things are

- Story: `story/<language>/*.story`, read in file-name order, labels shared. Starts at `== start`.
- Cast: `story/characters.json` (`name` per language, `color`).
- Art and sound, by name, no code change: `assets/backgrounds/<name>.png`,
  `assets/characters/<id>_<expression>.png` (or `<id>.png`), `assets/music/<name>.ogg`,
  `assets/sfx/<name>.ogg`. Until a file exists the game draws a placeholder.
- Menu and button text: `src/strings.ts`. Game name and storage key: `src/config.ts`.
- Text speeds: `src/tuning.json` (OpenPixo's Tune tab edits it). Colours and fonts: `src/ui.ts`.
- Story engine (pure, shared with the check): `src/story/parser.ts`, `runner.ts`, `check.ts`.
- Screens: `src/scenes/` (Title, Story, Pause, Settings). Keys and buttons: `src/controls.ts`.

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

- `pnpm run check` typechecks and runs the story check (`pnpm run check:story` alone).
  It names file and line for broken labels, unknown characters, variables nothing sets,
  unreachable labels and endings, and translations that drifted. Run it after every edit.
- `pnpm dev` runs the game; `pnpm build` checks and builds into `dist/`.
- Playtest: Enter or a click advances; arrows and Enter pick a choice; Ctrl held skips;
  A toggles auto; L or the wheel opens the log; Esc pauses. `window.storyKit.state()`
  returns what each screen shows (line, speaker, choices, variables, ending).
- Saves, settings and endings found are in localStorage under `src/config.ts` `storageKey`.
