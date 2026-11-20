# Godot story kit

A visual novel that already plays: text that types itself out, choices,
variables, several endings, a log, auto play, skip, saving, and every language
in the string table. To make your own story, edit the files in `story/`. You
rarely need to touch the code.

Open `project.godot` in Godot 4 and press F5. Set your game's name as
`config/name` in `project.godot` first: the title screen shows it, and Godot names
the folder for this game's saves after it.

## Where things are

| What | Where | How to change it |
| --- | --- | --- |
| The story | `story/<language>/*.story` | Edit the text (format below). Files are read in name order and share labels, so split a long story into `01_school.story`, `02_festival.story` |
| The cast | `story/characters.json` | One entry per character id: `name` per language and a `color` for their name |
| Backgrounds | `art/backgrounds/<name>.png` | `@bg <name>` shows it. `.webp` and `.jpg` work too |
| Characters | `art/characters/<id>_<expression>.png` | `@show <id> <expression>` shows it, or `<id>.png` when there is no picture for that expression. A tall picture with a transparent background, about as high as the screen |
| Music and sound | `audio/music/<name>.ogg`, `audio/sfx/<name>.ogg` | `@music <name>` loops, `@sfx <name>` plays once |
| Menus and button text | `ui/`, `i18n/strings.csv` | As in the plain Godot starter: every player-facing string is a row in the table |
| The look | `game/game.tscn`, `ui/theme.tres` | Text box, choices, log and ending card |
| Typing and auto speed | `game/game.gd`, constants at the top | |
| Input | `project.godot`, `[input]` | `advance` (Enter, Space, A, left click), `story_log` (L, Y, wheel up), `story_auto` (A key, X), `story_skip` (hold Ctrl or RB) and `pause`. All can be rebound in Settings |

Until a picture or a sound exists, the game draws a placeholder (a gradient or a
coloured silhouette, labelled with its name in debug builds) and stays silent,
so the story can be written and played before any art is made.

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
order. Text may use BBCode such as `[b]bold[/b]` and `[i]italics[/i]`.

## Languages

Each folder under `story/` is one language, named like the columns of
`i18n/strings.csv` (`en`, `zh_CN`). The game reads the folder for the language
picked in Settings, switching mid-scene at the same line. Every folder must have
the same labels and the same commands in the same order: only the text of lines,
questions, options and ending titles changes. To add a language, copy a folder,
translate the text, and add the same column to `i18n/strings.csv`.

## Check the story

```sh
godot --headless --path . --import --quit        # once, after copying the project
godot --headless --path . --script checks/story_check.gd
```

It exits 1 and names the file and line of each problem: text it cannot read, a
missing label or character, a condition on a variable nothing sets, a label that
is never reached, a translation that differs from the first language in more than
its text, a choice that can leave the player with no option, or an ending no
playthrough reaches. It lists missing pictures and sounds as notes. Run it after
every story edit.

## What it keeps

Progress is saved to `user://save.json` after every choice and when the player
quits or closes the window, and Continue returns to the same line. Reaching an
ending removes the save, so the title screen offers a new game, and adds the
ending to `user://endings.json`; the ending card shows how many of the story's
endings the player has found. Settings are in `user://settings.cfg`.

## Exporting

Godot only exports files it knows as resources, so `addons/story_files` adds the
`.story` files to every export. Keep it enabled under `[editor_plugins]` in
`project.godot`.

Before you sell in Chinese, Japanese or Korean, add a font with those characters
to `ui/theme.tres`. Until then, the text relies on fonts installed on the player's
machine, and a machine without them shows empty boxes.

`game/story/` holds the parser, the runner and the file lookup. They name no
autoload, so `checks/story_check.gd` can use them from a `--script` run; keep it
that way. A Movie Maker capture (`--write-movie`) skips the title screen, so it
records the story from the start.
