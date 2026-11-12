# Zero-token tuning

OpenPixo's **Tune / 调参** tab discovers `src/tuning.json` and root `tuning.json`.
Each key maps to an object with a literal number, boolean or string `value`.
For numbers you can provide `min`, `max` and `step`; `label`, `group` and
`description` are optional:

```json
{
  "playerSpeed": { "value": 240, "min": 0, "max": 720, "step": 10,
    "label": "Move speed", "group": "Player" }
}
```

Use valid JSON. `tuning.ts` loads it through Vite's raw import and checks numeric
settings. Import `tuning` into game code and use the setting in the actual
movement or game rule. Add new keys to the loader as you extend the game.

Start **Run game** once. **Apply and refresh playtest** in Tune saves pending
values and reloads that running game in the panel. No agent call or additional
game process is started. Reset restores the panel's initially loaded values.
If another editor changes a file, reload parameters before writing again.

`pixo game tuning list --json` lists ids and file hashes. Use
`pixo game tuning set <id> <value> --json` to edit one; outside a project run,
add `--project <projectId>`. `--file-hash <sha256>` preserves a previously read
revision for automation.

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
