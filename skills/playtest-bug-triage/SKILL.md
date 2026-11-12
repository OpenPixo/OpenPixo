---
name: playtest-bug-triage
en_name: Playtest bug triage
zh_name: 试玩问题定位与修复
description: Reproduce and fix a specific Godot 4, Unity 6 or Phaser 3 playtest defect using logs, state and input replay; not for feature design or general performance tuning.
en_description: Triage a specific game defect, reproduce its inputs and state, and verify a focused fix; not a general feature or performance workflow.
zh_description: 利用日志、状态与输入回放定位并修复 Godot 4、Unity 6 或 Phaser 3 的具体试玩缺陷；不用于功能设计或一般性能调优。
triggers:
  - playtest bug
  - reproduce game bug
  - game regression
  - 试玩问题
  - 游戏问题复现
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# Playtest bug triage

Reproduce a specific broken behavior, isolate its cause and verify a focused fix in Godot 4, Unity 6 or Phaser 3.
Project conventions, installed versions, architecture and explicit user choices take precedence.
Use existing evidence and tests; a small bug does not require a new report, fixture scene or controller rewrite.
If reproduction remains uncertain, report attempts and add bounded diagnostics instead of claiming a fix.

## Quick path

1. Preserve the report's logs, screenshots and starting save; note expected and actual behavior and reproduction rate.
2. Match engine, build, level, seed, input device, viewport and save state. Use a disposable save copy for destructive cases.
3. Run the failing sequence before editing. For supported browser games, use a preset or the script path below.
4. Isolate one boundary involving state, resources or lifecycle and patch its owner; add a focused regression check when the existing harness can expose it.
5. Repeat the exact failure, a normal path and the nearest boundary; inspect `pixo game verify --steps check,build,run --screenshot --json`.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
Keep credentials and personal data out of copied diagnostics.
On Unity, `verify` runs `check` and `build` only; `pixo game run` and `playtest` return unsupported, so reproduce with the Editor, a player build or the test below.

## Choose priority and evidence

| Observation | Priority and next evidence |
| --- | --- |
| Save loss or destructive corruption | Preserve original bytes; inspect where saves are loaded and written before more destructive reproduction |
| Crash, blocked progress or inability to unpause | Capture first relevant error, stack and preceding transition |
| Duplicate action after restart | Count callbacks and inspect persistent listeners |
| Missing sprite or incorrect sprite position | Check network and resource loading, visibility, and the coordinate spaces of the camera, body and UI |
| Stutter with correct behavior | Gather a performance trace; use performance-profiling if measurement is the main task |
| Unclear report | Investigate available evidence; identify the smallest missing fact that prevents reproduction |

A still image establishes visible state, not the cause. A passed build does not exercise player input.

## Browser replay with current OpenPixo commands

```sh
pixo game playtest --list-presets --json
pixo game playtest --preset runJump --json
pixo game playtest --preset monkey --seed 42 --json
pixo game playtest --script repro.json --duration 3 --json
```

- Choose by bindings: `runJump` uses ArrowRight and Space, `wasd` uses WASD; grid and drag presets assume particular screen locations.
- `--seed` applies only to `random` or `monkey`, in 0..4294967295. It reproduces the input sequence, not the game's RNG or world.
- `--script` and `--preset` are alternatives. Scripts are JSON arrays; waits and gesture durations are milliseconds, CLI `--duration` is seconds (0.1..30).
- Mouse points are capture-viewport CSS coordinates (1280 × 720), not world or canvas coordinates; map the actual game's scaled canvas before choosing points.
- Browser input capture needs the host. Godot supports observation and capture, not scripted input; use `pixo game playtest --preset observe --json` or interactive reproduction there.

Example `repro.json` for hover, hold, release and drag; replace points to match the defect:

```json
[
  {"wait": 250},
  {"move": [640, 360]},
  {"mouseDown": [640, 360]},
  {"wait": 200},
  {"move": [760, 360]},
  {"mouseUp": [760, 360]},
  {"drag": {"from": [500, 500], "to": [640, 320], "durationMs": 300}},
  {"capture": "after-drag"}
]
```

`mouseDown` and `mouseUp` alternate; `click` and `drag` require the button released.
Inspect returned frames, `pageErrors`, console and step logs. Capture completion does not assert that score, collision or progression is correct.

## Engine diagnosis anchors

| Engine | Boundary | Concrete check |
| --- | --- | --- |
| Godot 4 | Physics or freed objects | `_physics_process`, last `move_and_slide()` contacts, deferred `queue_free()` |
| Godot 4 | Pause trap | Pause-menu input owner may need `Node.PROCESS_MODE_ALWAYS`; gameplay remains pausable |
| Godot 4 | Resource and scene ownership | Remote tree, visible collision shapes, signal connections and imported resources |
| Phaser 3 | Scene restart | Same Scene instance survives; reset per-round state in `init()` or setup |
| Phaser 3 | Persistent listeners | Remove the exact callback and context on `Phaser.Scenes.Events.SHUTDOWN` |
| Phaser 3 | Blank or missing asset | First console exception and failed request before changing preload URLs |
| Unity 6 | Editor passes, player fails | `Player.log` under `%USERPROFILE%\AppData\LocalLow\<Company>\<Product>`, with the last run in `Player-prev.log`; IL2CPP stripping; execution order |
| Unity 6 | Only fails in the Editor, or only on the second Play | With domain reload off in Enter Play Mode Settings, statics and static event subscribers keep the last session's values |
| Unity 6 | Frozen after a menu or level change | `Time.timeScale` is static and survives scene loads; `FixedUpdate` stops at 0 |
| Unity 6 | Null after destroy | `MissingReferenceException` means a destroyed object; `Destroy` takes effect at end of frame, and `?.` skips Unity's destroyed check |
| Unity 6 | Reference lost after a move or merge | Missing Script or empty fields: a lost or regenerated `.meta` changed the GUID |

Log transitions and abnormal values rather than every frame, since logging can change timing.
A Godot trace can include `Engine.get_physics_frames()`, `global_position`, `velocity`, `is_on_floor()` and `get_tree().paused`.
A Unity trace can include `Time.frameCount`, `Time.fixedTime`, `body.position`, `body.linearVelocity` and `Time.timeScale`. Read the first error in `Editor.log` (`%LOCALAPPDATA%\Unity\Editor`) or `Player.log`, since later ones often follow from it.
In Phaser, compare sprite world position to body position and camera transforms instead of assuming screen coordinates.

For a repeatable Unity input case, write a PlayMode test on `InputTestFixture`. The test assembly references `Unity.InputSystem.TestFramework`, and `Packages/manifest.json` needs `"testables": ["com.unity.inputsystem"]`. Run it with the commands in unity-csharp.

```csharp
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;

public sealed class JumpRepro : InputTestFixture
{
    [UnityTest]
    public IEnumerator BufferedPressJumpsOnce()
    {
        var keyboard = InputSystem.AddDevice<Keyboard>();
        // Load the failing scene and state here, then find the actor under test.
        Press(keyboard.spaceKey);
        yield return new WaitForFixedUpdate();
        Release(keyboard.spaceKey);
        yield return new WaitForSeconds(0.5f);
        Assert.Fail("Replace with the assertion for the reported defect.");
    }
}
```

## Worked state rule: one pickup, one reward

First demonstrate duplicate delivery; this is an example, not a claim about the starter project.
A Godot Area2D can receive another callback before deferred deletion, so consume synchronously:

```gdscript
var taken: bool = false

func _on_body_entered(body: Node2D) -> void:
    if taken or not body.is_in_group(&"player"):
        return
    taken = true
    set_deferred(&"monitoring", false)
    collected.emit(value) # Existing signal/score owner.
    queue_free()
```

Phaser Arcade equivalent, after narrowing the overlap object to the actual pickup type:

```ts
if (!coin.active) return;
coin.disableBody(true, true); // Consume before awarding.
score += 1;
```

Unity Physics 2D equivalent. Two colliders on the player can both fire Enter in one step, and `Destroy` waits for end of frame:

```csharp
private bool taken;

private void OnTriggerEnter2D(Collider2D other)
{
    if (taken || !other.CompareTag("Player")) return;
    taken = true;
    gameObject.SetActive(false); // Consume before awarding.
    Collected?.Invoke(value);    // Existing event and score owner.
}
```

Regression: duplicate delivery awards once; another coin still works; restart restores the intended state.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Change physics rate to hide a race | Repair the violated state rule; rate changes alter gameplay |
| Broad `removeAllListeners()` on a shared emitter | Detach only the owned callback and context |
| Use a random preset as the exact reported case | Record and replay the failing input and game state explicitly |
| Claim fixed when the case never reproduced | State uncertainty and the diagnostic evidence |
| Treat a missing tool or export preset as a gameplay failure or pass | Report the unavailable check separately |

## Done when

- [ ] A pre-fix failing observation and post-fix outcome cover the same case.
- [ ] A normal route and relevant boundary pass; original saves and useful evidence remain intact.
- [ ] Repeat the applicable `pixo game playtest --script repro.json --duration 3 --json`, Unity test or interactive route; inspect state as well as frames.
- [ ] Report cause, changed owner, evidence and remaining uncertainty; remove noisy temporary diagnostics.
- [ ] Stop only a runtime you started: `pixo game stop <projectId> --json`.
- [ ] Inspect `pixo game verify --steps check,build,run --screenshot --json`; read logs and identify steps that were skipped or unavailable.
