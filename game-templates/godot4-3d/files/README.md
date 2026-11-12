# Godot starter

Open `project.godot` in Godot 4 and press F5. The game starts on the title
screen. Set your game's name as `config/name` in `project.godot` first: the title
screen shows it, and Godot names the folder for this game's saves after it.

| What | Where | How to extend it |
| --- | --- | --- |
| The game | `game/game.tscn` | Replace it with your game and keep the `PauseMenu` node |
| Menus | `ui/` | `ui/theme.tres` sets their look |
| Text | `i18n/strings.csv` | Add a row per string and a column per language. Set a control's text to the key, or call `tr("KEY")` in a script. Never write player-facing text straight into a scene or script |
| Input | `project.godot`, `[input]` | Add an action with a key and a gamepad binding, add it to `REBINDABLE` in `autoload/settings.gd`, and add its `ACTION_<NAME>` string |
| Settings | `autoload/settings.gd` | Stored in `user://settings.cfg` |
| Progress | `autoload/save_game.gd` | Stored in `user://save.json`. Nodes in the `saved` group implement `save_state()`, as `game/game.gd` does |
| Volume | `default_bus_layout.tres` | Play music on the `Music` bus and sound effects on `SFX`, or the sliders will not affect them |

Before you sell in Chinese, Japanese or Korean, add a font with those characters
to `ui/theme.tres`. Until then, the text relies on fonts installed on the player's
machine, and a machine without them shows empty boxes.

`--script` runs before autoloads exist, so a script that names `Strings`, `Settings`
or `SaveGame` does not compile there. `game/game.gd` keeps that out of `player.gd`.
Keep the same split for rules you check with a `SceneTree` script.

A Movie Maker capture (`--write-movie`) skips the title screen, so it records the
game. It starts a new game each time and ignores the saved window mode.
