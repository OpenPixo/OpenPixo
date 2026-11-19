# Phaser story kit

A visual novel that already plays in the browser: text that types itself out,
choices, variables, several endings, a log, auto play, skip, saving, settings, and
every language in `src/strings.ts`. To make your own story, edit the files in
`story/`. You rarely need to touch the code. The story format is the same as
OpenPixo's Godot story kit, so a story moves between the two unchanged.

```sh
pnpm install
pnpm dev            # play
pnpm run check      # typecheck and check the story
pnpm build          # check, then build into dist/
```

Set your game's name in `src/config.ts` (the title screen shows it) and in
`index.html`.

## Where things are

| What | Where | How to change it |
| --- | --- | --- |
| The story | `story/<language>/*.story` | Edit the text (format below). Files are read in name order and share labels, so split a long story into `01_school.story`, `02_festival.story` |
| The cast | `story/characters.json` | One entry per character id: `name` per language and a `color` for their name |
| Backgrounds | `assets/backgrounds/<name>.png` | `@bg <name>` shows it. `.webp` and `.jpg` work too |
| Characters | `assets/characters/<id>_<expression>.png` | `@show <id> <expression>` shows it, or `<id>.png` when there is no picture for that expression. A tall picture with a transparent background, about as high as the screen |
| Music and sound | `assets/music/<name>.ogg`, `assets/sfx/<name>.ogg` | `@music <name>` loops, `@sfx <name>` plays once. `.mp3` and `.wav` work too |
| Menu and button text | `src/strings.ts` | One entry per string with a value per language |
| Text speeds | `src/tuning.json` | OpenPixo's Tune tab edits these while the game runs (see `src/TUNING.md`) |
| The look | `src/ui.ts`, `src/stage.ts`, `src/scenes/StoryScene.ts` | Colours and fonts, the stage, the text box, choices, log and ending card |
| Keys and buttons | `src/controls.ts` | Enter, Space or A advance (or a click); arrows move; Ctrl or RB held skips; A key or X toggles auto; L, Y or the wheel opens the log; Esc or Start pauses |

Vite bundles every file under `story/` and `assets/` at build time, so a new
picture or chapter needs no code change. Until a picture or sound exists, the
game draws a placeholder (a gradient or a coloured silhouette, labelled with its
name in `pnpm dev`) and stays silent, so the story can be written and played
before any art is made. The title screen loads every picture and sound before
the story starts.

## The story format

```text
# A comment.
== start                      A label. The story begins at "start".
@bg station_night             Background. "@bg none" clears it.
@music night_wind             Music, looping. "@music stop" stops it.
@sfx door                     A sound, once.
@show ren happy left          A character, with an expression and left, center or right.
@show ren                     Same character, keeps where they stand.
@hide ren                     One character leaves. "@hide" clears the stage.
The platform lamp hums.       Narration: any line that is not one of these.
: Note: this is narration.    A leading ":" forces narration.
ren: You missed it.           A line spoken by a character id from characters.json.
@wait 0.5                     A pause, in seconds.
@set met_ren = true           A variable: true, false, a number or "text".
@add trust 1                  Add to a number. "@add trust -1" takes away.
? What do you say?            A choice, with its question (the question is optional).
- Ask about it -> letter      An option and the label it leads to.
- Say sorry -> sorry if trust >= 2    An option only offered when its condition holds.
@if trust >= 2 -> good_end    Go to a label when a condition holds.
@jump dawn                    Go to a label.
@end keeper The Keeper's Stove        An ending: an id, then its title.
```

Conditions are `name` (true when set to something other than false, 0 or ""),
`not name`, comparisons with `==`, `!=`, `>=`, `<=`, `>` and `<`, joined with
`and` and `or`. A label that runs out of lines goes on to the next label in file
order. Text is shown as written; this kit has no markup for bold or colour.

## Languages

Each folder under `story/` is one language, named like the keys in
`src/strings.ts` (`en`, `zh_CN`). The game reads the folder for the language
picked in Settings (or the browser's language), switching mid-scene at the same
line. Every folder must have the same labels and the same commands in the same
order: only the text of lines, questions, options and ending titles changes. To
add a language, copy a folder, translate the text, and add the language to every
string in `src/strings.ts`.

## Check the story

`pnpm run check` (or `pnpm run check:story` for the story alone) exits 1 and
names the file and line of each problem: text it cannot read, a missing label or
character, a condition on a variable nothing sets, a label that is never reached,
a translation that differs from the first language in more than its text, a
choice that can leave the player with no option, or an ending no playthrough
reaches. It lists missing pictures and sounds as notes. Node runs
`scripts/check-story.ts` as it is; the checks are in `src/story/check.ts`.

## What it keeps

Progress is saved in the browser's localStorage after every choice, when the
player quits to the title and when the page closes, and Continue returns to the
same line. Reaching an ending removes the save, so the title screen offers a new
game, and adds the ending to the endings found; the ending card shows how many of
the story's endings the player has found. Change `storageKey` in `src/config.ts`
so two games on one site do not share saves.

`window.storyKit.state()` returns what each screen shows (the line, the speaker,
the choices, the variables, the ending), for playtest scripts. It never changes
the game.
