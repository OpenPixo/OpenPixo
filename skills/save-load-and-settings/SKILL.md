---
name: save-load-and-settings
en_name: Save evolution and persistent settings
zh_name: 存档演进与持久化设置
description: Extend an existing Godot 4, Unity 6 or Phaser 3 save system with migrations, recovery and independent settings; not for initial save-slot setup or cloud integration.
zh_description: 为 Godot 4、Unity 6 或 Phaser 3 的现有存档系统加入迁移、恢复和独立设置；不用于初始存档槽搭建或云存档接入。
triggers:
  - migrate game save
  - corrupt save recovery
  - persistent game settings
  - save version compatibility
  - 存档迁移
  - 存档损坏恢复
  - 持久化游戏设置
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
  example_prompt: Upgrade the existing save format without losing old progress, keep volume settings when starting a new game, and add migration fixtures.
  example_prompt_i18n:
    zh-CN: 升级现有存档格式且不丢失旧进度，开始新游戏时保留音量设置，并加入迁移样例。
---

# Save evolution and persistent settings

Extend an existing Godot 4, Unity 6 or Phaser 3 save owner for migration, recovery or settings persistence.
Project conventions, installed versions, architecture and explicit user choices take precedence.
For initial slots or checkpoints, reuse the project's existing recipe or manager rather than adding a competing owner.
A small schema fix needs the affected fixtures, not a new persistence framework.

## Quick path

1. Find the current slot paths or keys, payload version and code that loads and writes saves. Check what New Game does.
2. Copy representative old saves into test fixtures with invented data; keep the player's originals intact.
3. Define the needed load outcomes below and make migrations pure, ordered data transformations.
4. Validate before touching live state; preserve old bytes before replacing a migrated save.
5. Run focused codec and storage fixtures, then `pixo game verify --steps check,build --json`; inspect logs and skipped steps.
6. Use `pixo game run <projectId> --json` for save → quit or reload → Continue and settings-retention checks. `pixo game run` does not support Unity: quit and relaunch a player build instead.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
These are game save paths; follow the project's storage convention rather than OpenPixo daemon data paths.

## Choose a load outcome before writing

| Input or state | Outcome | Write policy |
| --- | --- | --- |
| Missing slot | Offer New Game | Create only when a real save is requested |
| Current valid payload | Load | Normal writes allowed |
| Supported older version | Migrate stepwise, then validate | Preserve old bytes before saving the new form |
| Truncated JSON or invalid fields | Corrupt; offer validated backup or recovery | Preserve damaged bytes; defaults must not silently erase progress |
| Version newer than this game | Unsupported future version | Preserve bytes; use a separate new run if requested |
| Storage denied or read error | Session-only or unavailable | Show persistence failure and retry; avoid false “Saved” feedback |

Separate progression from settings. New Game resets progression; Reset Settings and Delete Save are separate operations.
Use a stable slot key across versions; the payload version drives migration so old progress remains discoverable.

## Phaser 3 with TypeScript: a strict pure codec

This canvas-independent example migrates v1 into v2. Substitute the game's checkpoint registry and bounds.

```ts
type Save = { version: 2; progress: { checkpoint_id: string; coins: number } };
type Decoded = { status: 'ok' | 'migrated'; data: Save }
  | { status: 'corrupt' | 'future' };
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function decode(raw: unknown): Decoded {
  if (!record(raw) || typeof raw.version !== 'number'
      || !Number.isSafeInteger(raw.version) || raw.version < 1) {
    return { status: 'corrupt' };
  }
  if (raw.version > 2) return { status: 'future' };
  const migrated = raw.version === 1;
  const progress: unknown = migrated
    ? { checkpoint_id: raw.checkpoint, coins: raw.coins } : raw.progress;
  if (!record(progress) || typeof progress.checkpoint_id !== 'string'
      || !['start', 'bridge', 'exit'].includes(progress.checkpoint_id)
      || typeof progress.coins !== 'number' || !Number.isSafeInteger(progress.coins)
      || progress.coins < 0 || progress.coins > 1_000_000) {
    return { status: 'corrupt' };
  }
  return { status: migrated ? 'migrated' : 'ok', data: {
    version: 2, progress: { checkpoint_id: progress.checkpoint_id, coins: progress.coins },
  } };
}
```

- Catch `localStorage.getItem` failures separately from JSON and codec errors; “unavailable” and “corrupt” are different outcomes.
- A null storage result means missing; malformed nested data cannot be repaired by a shallow defaults merge.
- Catch `setItem` too. Use a separate settings key, for example `<game-id>:settings`; do not clear all localStorage for New Game.
- Browser storage is origin-scoped and may be temporary or blocked in private or embedded contexts.
- Save at meaningful checkpoints with bounded debounce. Page exit and visibility events are not a reliable sole save trigger.

## Godot 4 storage anchors

Use `user://` for exported-game saves; `res://` is normally read-only there.
Decode JSON as Variant, require a Dictionary, validate the numeric version and all nested fields before applying it.
JSON numbers may parse as floats: require finite, integral values and bounds before casting counts or version to int.
Resolve checkpoint IDs through the real level registry; implement explicit mappings for removed IDs.

Example read adapter for an existing strict `decode_save(Variant)` codec implementing the outcomes above:

```gdscript
func read_slot(path: String) -> Dictionary:
    if not FileAccess.file_exists(path):
        return {"status": "missing"}
    var file := FileAccess.open(path, FileAccess.READ)
    if file == null:
        return {"status": "unavailable", "error": FileAccess.get_open_error()}
    var parser := JSON.new()
    if parser.parse(file.get_as_text()) != OK:
        return {"status": "corrupt", "error": parser.get_error_message()}
    return decode_save(parser.data)
```

Use plain data for player-controlled files; object-bearing deserialization can instantiate unintended objects.
For settings, `ConfigFile.load("user://settings.cfg")`, `get_value("audio", "music", 0.7)`, `set_value` and `save` are Godot 4 APIs.
Distinguish `ERR_FILE_NOT_FOUND` from unreadable or corrupt settings. Validate finite volume within the allowed range and allowlisted locale, window and binding values.
On unreadable settings, keep session defaults and preserve bytes before an explicit reset; check the Error returned by saving before showing success.

## Unity 6 storage anchors

Save under `Application.persistentDataPath`; `Assets`, `Resources` and `StreamingAssets` are not a save location. That path is built from Company Name and Product Name in Player Settings, so renaming either hides every existing save unless you migrate the folder.

This pure codec has no scene dependency, so an EditMode test can run the fixtures below. Substitute the game's checkpoint registry and bounds.

```csharp
using System;
using System.IO;
using UnityEngine;

[Serializable] public sealed class SaveHead { public int version; }
[Serializable] public sealed class SaveV1 { public string checkpoint; public int coins; }
[Serializable] public sealed class Progress { public string checkpoint_id; public int coins; }
[Serializable] public sealed class SaveV2 { public int version = 2; public Progress progress = new Progress(); }

public enum SaveStatus { Missing, Ok, Migrated, Corrupt, Future, Unavailable }

public static class SaveCodec
{
    public static SaveStatus Decode(string json, out SaveV2 data)
    {
        data = null;
        try
        {
            var head = JsonUtility.FromJson<SaveHead>(json);
            if (head == null || head.version < 1) return SaveStatus.Corrupt;
            if (head.version > 2) return SaveStatus.Future;
            var migrated = head.version == 1;
            SaveV2 decoded;
            if (migrated)
            {
                var old = JsonUtility.FromJson<SaveV1>(json);
                decoded = new SaveV2 { progress = new Progress { checkpoint_id = old.checkpoint, coins = old.coins } };
            }
            else decoded = JsonUtility.FromJson<SaveV2>(json);
            if (!IsValid(decoded)) return SaveStatus.Corrupt;
            data = decoded;
            return migrated ? SaveStatus.Migrated : SaveStatus.Ok;
        }
        catch (ArgumentException) { return SaveStatus.Corrupt; } // Malformed or truncated JSON.
    }

    public static SaveStatus ReadSlot(string path, out SaveV2 data)
    {
        data = null;
        try
        {
            return File.Exists(path) ? Decode(File.ReadAllText(path), out data) : SaveStatus.Missing;
        }
        catch (IOException) { return SaveStatus.Unavailable; }
        catch (UnauthorizedAccessException) { return SaveStatus.Unavailable; }
    }

    private static bool IsValid(SaveV2 save) =>
        save.progress != null && save.progress.coins >= 0 && save.progress.coins <= 1_000_000
        && Array.IndexOf(new[] { "start", "bridge", "exit" }, save.progress.checkpoint_id) >= 0;
}
```

- `JsonUtility` gives an absent field its default, so a missing `coins` reads as 0 and a missing `version` as 0. Validate every field; a successful parse proves little. It also skips dictionaries, properties and top-level arrays.
- If those limits matter, use `com.unity.nuget.newtonsoft-json` with `TypeNameHandling.None`. `BinaryFormatter` can run attacker-shaped data from a player-controlled file, so never add it. IL2CPP can strip members only reached by reflection; test the save round trip in a player, not just the Editor.
- Write to a temporary sibling, then `File.Replace(temp, path, backup)` when the slot exists and `File.Move` when it does not. Unity's API profile has no `File.Move` overload that overwrites, and `File.Replace` throws if the target is missing.
- `JsonUtility.ToJson` and `Application.persistentDataPath` belong on the main thread. Snapshot the JSON string and path there, then write on a background thread if the file is large enough to hitch.
- Save at checkpoints and on `OnApplicationPause(true)` for mobile. A killed process gets no quit callback.
- In the Editor, changes to a ScriptableObject during Play Mode stay on disk and a player resets them. Progress kept there looks persistent until the first build.

Settings can live in `PlayerPrefs`, which suits small values and is plain text (the registry on Windows). Call `PlayerPrefs.Save()` after a change. Never use `PlayerPrefs.DeleteAll()` for New Game: it erases volume and bindings too.
Apply saved volume in `Start` or later, because `AudioMixer.SetFloat` is documented for `Start` onward. It returns false on an unknown exposed name, so check it. Convert with `Mathf.Log10(Mathf.Max(gain, 0.0001f)) * 20f` after rejecting a non-finite value with `float.IsFinite`.
Store rebinding through `actions.SaveBindingOverridesAsJson()`, and keep it separate from progress.

## Write ordering and focused fixtures

Reuse the manager's strategy for temporary files and backups. Check the result of every write, flush and replacement.
Rename and replacement behavior varies by platform; test the actual adapter rather than assuming an atomic overwrite.
Queue one write at a time and snapshot immutable data so an older completion cannot overwrite newer progress.

| Fixture or action | Expected evidence |
| --- | --- |
| v1 checkpoint bridge, coins 12 | v2 values retained; original input object unchanged |
| Valid current payload, decoded twice | Same valid progress; no repeated migration |
| Truncated JSON, negative or nonintegral coins, unknown checkpoint | Corrupt outcome; no live-state mutation or automatic overwrite |
| Version 99 | Future outcome; original bytes unchanged |
| Denied write or exhausted quota | Continue in memory; failure feedback and usable retry |
| New Game after changing volume | Progress resets, volume persists |
| Backup recovery | Last validated checkpoint restored and explained to the player |

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Save defaults after any failed load | Preserve original bytes and choose explicit recovery |
| Rename the storage key for every schema version | Keep discovery stable; version the payload or explicitly migrate old keys |
| Store node references, Unity instance IDs or arbitrary scene paths | Store validated stable IDs and plain data |
| “File exists” or one screenshot proves persistence | Decode fixtures and complete a restart round trip |
| Show “Saved” when a write was only queued | Confirm the adapter's success result |

## Done when

- [ ] Applicable fixtures for old, current, missing, corrupt, future and unavailable saves behave as specified.
- [ ] Original bytes survive failed loads; migrated data is validated before live-state changes.
- [ ] Saving, reloading, Continue, New Game and settings retention work with honest failure feedback.
- [ ] Use `pixo game run <projectId> --json` for the persistence round trip, or a relaunched player build on Unity; report actual results and unresolved storage limitations.
- [ ] Inspect `pixo game verify --steps check,build --json`; name skipped checks separately from fixture coverage.
