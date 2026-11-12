---
name: game-feel-juice
en_name: Game feel and impact feedback
zh_name: 游戏手感与打击反馈
description: "Tune feedback on existing Godot 4, Unity 6 or Phaser 3 gameplay events: shake, hit-stop, squash, particles or camera smoothing. Use for timing and readability; not changing combat or movement rules without a request."
zh_description: "为 Godot 4、Unity 6 或 Phaser 3 既有玩法事件调节震屏、顿帧、挤压拉伸、粒子或镜头平滑，改善时序与可读性；未经需求不改变战斗或移动规则。"
triggers:
  - game feel
  - game juice
  - hit-stop
  - game screen shake
  - squash and stretch
  - Cinemachine impulse
  - 游戏手感
  - 打击感
  - 游戏震屏
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# Game feel and impact feedback

Preserve the user's intended style and the project's engine and version, camera, pause and event architecture. Tune the requested cue; a coin pop does not require particles, a new singleton or generated media.

## Quick path

1. Find the one-time event: landed, damage accepted or pickup consumed. Keep gameplay rules authoritative.
2. Pick a small measurable starting effect, such as a 120 ms pose return or 45 ms hit-stop; these are tuning examples.
3. Apply visual changes to a presentation child and route camera and time effects through their existing owners.
4. Retain or add an intensity or reduced-motion control for the affected motion; compare enabled, disabled and repeated events.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser, then play the action at normal speed.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. Inspect exposed values with `pixo game tuning list --json` only when source tuning helps the task.

## Choose the layer

| Need | Start with | Keep stable |
| --- | --- | --- |
| Landing or impact weight | Child visual pose and brief dust | Capsule, body, collider and movement distance |
| Damage timing | One owner for bounded stops or slowdowns | Pause, attack authority and network simulation |
| Readable direction or impact | Camera displacement or static cue | Camera base tracking and aim |
| Collection reward | Small pop or ring; reuse the sound and emitter | Pickup count and collision semantics |
| Pixel-art camera | Intentional integer snapping or smooth subpixel policy | Actual display scale; inspect shimmer in motion |

A landing event is an airborne → grounded edge, not every grounded tick. Trigger after authoritative acceptance so blocked hits do not produce successful-hit feedback.

## Godot 4.3: an owned pose tween

This fragment belongs on the existing actor. `Visual` holds only presentation:

```gdscript
@onready var visual: Node2D = $Visual
@onready var rest_scale: Vector2 = visual.scale
@export_range(0.0, 1.0) var feedback_intensity: float = 1.0
var pose_tween: Tween

func landing_feedback() -> void:
	if pose_tween != null and pose_tween.is_valid():
		pose_tween.kill()
	visual.scale = rest_scale * Vector2(1.0 + 0.15 * feedback_intensity, 1.0 - 0.15 * feedback_intensity)
	pose_tween = create_tween().set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	pose_tween.tween_property(visual, "scale", rest_scale, 0.12)
```

Use a pivot at the feet. Kill only the tween owning this property; restore the captured rest transform on interruption. Shake should add a transient offset to the camera owner's current base, then return to zero. Other look-ahead code must not fight it. [Tween 4.3](https://docs.godotengine.org/en/4.3/classes/class_tween.html) uses `create_tween()` rather than a Tween node.

## Hit-stop, only when applicable

Reuse an existing time coordinator. For a small single-player game with no competing time-scale owner, this near-freeze example uses a wall-clock deadline so slowdown cannot prevent its own expiry:

```gdscript
extends Node
var deadline_ms: int = 0
var previous_scale: float = 1.0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS

func request_hit_stop(seconds: float = 0.045) -> void:
	if seconds <= 0.0 or get_tree().paused:
		return
	if deadline_ms == 0:
		previous_scale = Engine.time_scale
		Engine.time_scale = minf(previous_scale, 0.05)
	deadline_ms = maxi(deadline_ms, Time.get_ticks_msec() + int(minf(seconds, 0.10) * 1000.0))

func _process(_delta: float) -> void:
	if deadline_ms > 0 and Time.get_ticks_msec() >= deadline_ms:
		Engine.time_scale = previous_scale
		deadline_ms = 0

func _exit_tree() -> void:
	if deadline_ms > 0:
		Engine.time_scale = previous_scale
```

Merge overlapping requests and bound cumulative stop time for repeated hits. Bullet time and replays need reason-based coordination instead of this independent owner. [Engine.time_scale 4.3](https://docs.godotengine.org/en/4.3/classes/class_engine.html) does not change audio playback speed; choose audio and menu timing deliberately. Global time scaling is unsuitable for freezing only one online peer's simulation.

## Phaser 3 anchors

- `this.cameras.main.shake(90, 0.002 * intensity)` uses milliseconds and viewport-relative intensity, unlike Godot's pixel offset. Bypass new shake requests at zero, and cancel or reset an active effect if the setting changes mid-shake.
- Keep physics on the unscaled body; tween a separate visual. Scaling an Arcade sprite can alter its derived body dimensions.
- Phaser **3.60+** creates an emitter directly. Create once, reuse with `explode` and clean up with the scene:

```ts
const emitter = this.add.particles(0, 0, 'coin', {
  emitting: false, lifespan: 180, speed: { min: 25, max: 60 },
  scale: { start: 0.18, end: 0 }, alpha: { start: 0.8, end: 0 },
});
emitter.explode(4, x, y); // On an accepted event, when intensity > 0.
```

Check the installed Phaser types; [tagged Phaser 3.90 emitter source](https://github.com/phaserjs/phaser/blob/v3.90.0/src/gameobjects/particles/ParticleEmitterFactory.js) documents the 3.60 signature change.
- Arcade hit-stop can pause physics and gate gameplay updates while an active scene clock expires one merged deadline. Pausing that clock too deadlocks recovery.
- Win, pause, shutdown and restart must cancel owned stop work without accidentally resuming an intentionally paused world.
- A separate HUD scene or camera avoids shaking the HUD; `setScrollFactor(0)` fixes scroll but does not isolate camera shake.

## Unity 6: one owner for time, a child for the pose

Unity has no pause separate from time scale, so a menu and a hit-stop both want `Time.timeScale`. If each saves and restores it, the later restore unpauses the game. Route both through one owner, or extend the one the project has:

```csharp
using UnityEngine;

public sealed class GameClock : MonoBehaviour
{
    private float stopUntil;
    public bool Paused { get; private set; }

    public void SetPaused(bool paused) { Paused = paused; Apply(); }

    public void RequestHitStop(float seconds = 0.045f)
    {
        if (Paused || seconds <= 0f) return;
        stopUntil = Mathf.Max(stopUntil, Time.unscaledTime + Mathf.Min(seconds, 0.10f));
        Apply();
    }

    private void Update()
    {
        if (stopUntil > 0f && Time.unscaledTime >= stopUntil) { stopUntil = 0f; Apply(); }
    }

    private void Apply() => Time.timeScale = Paused ? 0f : stopUntil > 0f ? 0.05f : 1f;

    // timeScale is static: a scene load does not reset it.
    private void OnDestroy() => Time.timeScale = 1f;
}
```

Overlapping requests merge into one deadline. A slow-motion mode becomes another reason inside `Apply`, not a second writer.

- `FixedUpdate` slows with time scale and stops at 0. Set the Rigidbody's Interpolate so a 0.05 stop does not look like a stutter. Audio ignores time scale, so decide what the hit sound does.
- These keep moving during a stop only if told to: Animator `updateMode = UnscaledTime`, particle `main.useUnscaledTime`, and tweens through the library's unscaled option. Coroutines waiting on `WaitForSeconds` freeze at 0; use `WaitForSecondsRealtime` for anything that ends a stop.
- Squash a child `Visual`, never the Rigidbody root: scaling the root scales its colliders. Use a bottom sprite pivot, or the pose slides off the ground. Ease with the project's tween library if installed, otherwise an owned coroutine. Stop the previous one on a repeat, and restore the captured rest scale in `OnDisable`, because a disabled object's coroutine never finishes.
- With Cinemachine, the Brain overwrites the camera transform every frame, so moving it directly does nothing. Use `CinemachineImpulseSource.GenerateImpulse(force)` with a `CinemachineImpulseListener` on the camera, scaled by the intensity setting, and skip the call at zero. Check `manifest.json` first: Cinemachine 3 and later use `Unity.Cinemachine` and `CinemachineCamera`; 2.x uses `Cinemachine` and `CinemachineVirtualCamera`.
- Without Cinemachine, shake a child of the camera rig and write a fresh `localPosition` each `LateUpdate`, returning to zero. A Screen Space - Overlay canvas does not shake with the camera.
- Keep one particle system per effect with Play On Awake off, then move it and call `Emit(4)`. Instantiating a prefab per hit allocates and hitches; `UnityEngine.Pool.ObjectPool<T>` covers effects that need their own objects.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Add shake to last frame's shaken offset | Combine a fresh transient offset with the owned base; accumulation drifts |
| Set time scale to zero and wait on a scaled timer | Use the existing unscaled clock or time coordinator so recovery can occur |
| One resume timer per hit | Merge requests; an older timer must not end a newer stop |
| Create emitters each frame | Reuse a bounded emitter triggered by accepted events |
| Disable all cues for reduced motion | Remove motion while retaining readable static and audio feedback |

## Done when

- [ ] Repeated events, pause during hit-stop and restart during an effect restore intended scale, camera offset and timing.
- [ ] Intensity zero removes affected motion, including an in-progress effect; gameplay remains readable.
- [ ] Relevant verify command above passes; record the chosen duration, amplitude and observed interaction.
- [ ] `pixo game playtest --duration 10 --json` can capture supported Godot or web output, but a still image cannot establish timing or restoration. Unity capture is unsupported: play it in the Editor or a player build.
