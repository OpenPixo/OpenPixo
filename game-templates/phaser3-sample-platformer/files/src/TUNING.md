# Zero-token tuning

OpenPixo's **Tune / 调参** workspace tab reads `src/tuning.json` and root
`tuning.json`. Each top-level key is an object with a literal `value`:

```json
{
  "playerSpeed": {
    "value": 220,
    "min": 0,
    "max": 600,
    "step": 10,
    "label": "Move speed",
    "group": "Player"
  }
}
```

Numbers, booleans and strings are supported. Numeric bounds and step, label,
group and description are optional. Use valid JSON. The editor changes only
the selected value token, retaining the rest of the file's formatting.

`tuning.ts` imports the JSON as text through Vite and exports checked numeric
settings. Game code must read those settings; adding JSON alone does not
connect a parameter to gameplay. Add new settings to the exported `tuning`
object, then use them in your scene. This sample uses movement speed, jump
velocity, Arcade gravity, the number of coin positions and sound volume.

Start the game once with **Run game**, then use **Apply and refresh playtest**
in Tune to save changes and reload the running game in the panel. Changing a
slider and refreshing never invokes an agent or starts another game process.
The panel's reset restores its initially loaded values. Source file changes
made elsewhere require reloading parameters before another write.

CLI, inside an OpenPixo project:

```text
pixo game tuning list --json
pixo game tuning set <parameter-id> 260 --json
```

Outside a project run add `--project <projectId>`. Supply `--file-hash <sha256>`
from a previous list result when an automation must preserve that exact revision.

Optional `label_i18n` and `group_i18n` maps localize each parameter and its group
to the UI locale. Keep `label` and `group` as fallbacks for other locales:

```json
{
  "playerSpeed": { "value": 220, "label": "Move speed", "group": "Player",
    "label_i18n": { "zh-CN": "移动速度" }, "group_i18n": { "zh-CN": "角色" } }
}
```

A missing or empty translation falls back to `label`/`group` (and then the
parameter key / `tuning.json` if those fields are absent). Locale maps are
metadata only; saving a value preserves them. Both the UI and
`pixo game tuning list --json` receive the same locale maps. Checkpoint restore
and returning focus to OpenPixo refresh the displayed values automatically.
