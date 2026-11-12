---
name: performance-profiling
en_name: Game performance profiling
zh_name: 游戏性能分析
description: Investigate measured slowdown, stutter, memory growth or build weight in Godot 4, Unity 6 or Phaser 3; use for performance evidence, not general refactoring.
en_description: Measure Godot 4, Unity 6 or Phaser 3 performance problems and compare a targeted optimization; not a general refactoring workflow.
zh_description: 针对 Godot 4、Unity 6 或 Phaser 3 的实测卡顿、内存增长或构建体积问题定位瓶颈并对比优化结果；不用于一般重构。
triggers:
  - game performance
  - frame time spike
  - Godot profiler
  - Unity Profiler
  - Phaser profiling
  - spatial partitioning
  - time slicing
  - 游戏性能分析
  - 掉帧排查
  - 分帧处理
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# Game performance profiling

Measure a slowdown, memory growth or build-weight problem in Godot 4, Unity 6 or Phaser 3.
The project's conventions, installed version, architecture and explicit user choices take precedence.
Use only the branches needed for the symptom; a small fix can keep its measurements in the handoff instead of creating a report or stress scene.

## Quick path

1. Read the engine profile and reproduce the affected route with a fixed seed, resolution and actor count.
2. Record a baseline in the relevant profiler; separate cold loading from warm gameplay.
3. Use the table below to locate the expensive subsystem, then change one measured cause.
4. Repeat the same workload; add runs when variance makes the result uncertain.
5. Run `pixo game verify --steps check,build --json` and replay the affected gameplay. Inspect logs and any skipped steps.

Commands use the task's `PIXO_PROJECT_ID`; otherwise add `--project <id>`.

## Choose evidence for the symptom

| Symptom | Measure first | Candidate change after attribution |
| --- | --- | --- |
| Hitches when spawning | CPU trace and allocations at spawn | Reduce initialization; pool only if spawning or allocation pressure warrants it |
| Cost rises with bodies | Physics time, active bodies, collision masks | Narrow masks or simplify shapes without changing required contacts |
| Script cost grows with actor count squared | Time in targeting, separation or proximity loops; pair checks per frame | Query the engine broadphase, or bucket actors in a uniform grid (see below) |
| Periodic spike from batched work | Frame intervals around the spike and the call that owns it | Time-slice the batch under a per-frame allowance (see below) |
| Cost rises with screen coverage | GPU and rendering time, overdraw, material switches | Reduce redundant passes and transparent layers; preserve visual intent |
| Memory grows across restarts | Retained nodes and scenes, listeners, resources | Release the owner that retains them |
| Slow cold start or large build | Largest files, transfer bytes, decode and import time | Resize or compress reviewed derivatives at their actual display size |

A 60 FPS budget is about 16.7 ms for the whole frame; use the project's target.
Before optimizing, note what rendering, physics and script already spend, and give deferrable work an explicit allowance (for example 2 ms) instead of whatever is left.
Record median and p95 frame intervals and the worst hitch. Include device, browser, renderer, build mode and profiler state.
Keep editor, instrumented and release-player results separate; compare like with like.
For a noisy result, use several runs (for example three) and report the spread.

## Godot 4 anchors

Use Debugger → Profiler for script and physics cost. Use monitors for objects, memory and rendering.
Visual Profiler availability depends on the renderer; Compatibility does not provide every GPU metric.
Measure an exported build too when editor overhead changes the symptom.

Sample counters at low frequency in a temporary diagnostic, then disable logging for the final comparison:

```gdscript
var sample := {
    "process_ms": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
    "physics_ms": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
    "draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
    "nodes": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
    "static_bytes": Performance.get_monitor(Performance.MEMORY_STATIC)
}
```

These counters do not form an additive breakdown of total frame time.
Some monitors are debug-only or update slowly; release-mode zeroes may mean unavailable data, not zero cost.
Compare node and resource counts after complete level restarts; GDScript memory growth is not automatically a GC pause.
For example, narrow pickup masks only after measuring irrelevant contacts, then verify scoring and enemy contacts still work.

## Unity 6 anchors

Attach the Profiler to a Development Build with Autoconnect Profiler on. Play Mode numbers include the Editor, so report them separately. Use Deep Profile only to name a call, because it inflates script cost; for timings, wrap suspects in `ProfilerMarker`.

| Question | Tool |
| --- | --- |
| Which system owns the frame | Profiler CPU Usage, Hierarchy view. `Gfx.WaitForPresent` and `WaitForTargetFPS` are waiting, not work |
| What allocates | The `GC.Alloc` column on the worst frames |
| Why so many draw calls | Frame Debugger, plus the batching reason it reports |
| What is retained | Memory Profiler package (`com.unity.memoryprofiler`): compare snapshots after identical restarts |
| Median and p95 across a capture | Profile Analyzer package |
| Build weight | `BuildReport.packedAssets` in the build script, or the size report in `Editor.log` |

For counters in a test scene or a Development Build:

```csharp
using Unity.Profiling;
using UnityEngine;

public sealed class FrameSampler : MonoBehaviour
{
    private ProfilerRecorder mainThread, gcBytes, drawCalls;

    private void OnEnable()
    {
        mainThread = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 15);
        gcBytes = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame");
        drawCalls = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");
    }

    private void OnDisable()
    {
        mainThread.Dispose();
        gcBytes.Dispose();
        drawCalls.Dispose();
    }

    public string Sample() =>
        $"main={mainThread.LastValue * 1e-6:F2}ms gc={gcBytes.LastValue}B draws={drawCalls.LastValue}";
}
```

A counter can read 0 in a release player because it is unavailable there. Record bounded `Time.unscaledDeltaTime` values for frame intervals, and fix VSync (`QualitySettings.vSyncCount`) and `Application.targetFrameRate` between runs. Compare IL2CPP with IL2CPP and Mono with Mono.

Common attributed causes:

- Restart growth: a static event or singleton still holding a destroyed object, or `renderer.material` copies never destroyed. The first `.material` read on a renderer creates its copy.
- Spawn hitches: `Instantiate` on every shot. `UnityEngine.Pool.ObjectPool<T>` retains memory in exchange, so pool only what the trace shows.
- Frame allocations: `FindObjectsByType` or `GetComponent` in a hot loop, string building for UI each frame, and physics queries that return new arrays.
- Physics cost: an all-layers collision matrix. Narrow the matrix before simplifying shapes.
- Lost batching: per-renderer `MaterialPropertyBlock` values on sprites, or many material instances. Confirm in the Frame Debugger.

## Phaser 3 and browser anchors

Use the browser Performance trace to attribute scripting, rendering, long tasks and GC.
Heap snapshots after identical restart cycles help identify retained scenes, timers and external listeners.
Keep the tab foregrounded; warm texture and audio decoding before steady-state sampling.

Phaser's `delta` can be smoothed or capped. For visible hitches, collect bounded wall-clock intervals in the existing Scene:

```ts
private intervals: number[] = [];
private previousAt = 0;

// Call once per update after warm-up; reset both fields before another run.
private sampleFrame(): void {
  if (this.intervals.length >= 1800) return;
  const now = performance.now();
  if (this.previousAt !== 0) this.intervals.push(now - this.previousAt);
  this.previousAt = now;
}
```

Sort a copy numerically; p95 is element `Math.ceil(count * 0.95) - 1`.
Intervals include the wait between updates; they are not the CPU duration of `update()`.
Exclude tab suspension and intentional pauses, while retaining genuine workload hitches.
A restart leak often comes from a persistent emitter: remove the exact scene handler on `Phaser.Scenes.Events.SHUTDOWN`.
Repeat the same restart count; retained scenes and listeners should plateau and one input should trigger once.

## Crowds and batched work

Apply these only after attribution shows the loop or batch is the cost.

- **Neighbor queries.** Prefer the engine's broadphase first: Godot `Area2D` overlaps or `PhysicsDirectSpaceState2D.intersect_shape`, Unity `Physics2D.OverlapCircle` with a `ContactFilter2D` and a preallocated results array, Phaser `physics.overlap` against a group. For script-only checks among similar-sized actors, bucket positions in a uniform grid with cells near the query radius; rebuild or update the buckets once per tick and search only the 3×3 cells around each actor. A quadtree earns its complexity only when actor sizes or densities differ widely.
- **Time slicing.** Path requests, AI refresh, chunk generation and save serialization can run across frames when the result may arrive a few frames late. Queue small items and stop when the frame's allowance is spent; one long item still overruns, so split it first.

```ts
private queue: Array<() => void> = [];
private head = 0;

// Run queued items until this frame's allowance is spent; call once per update.
private drainQueue(budgetMs = 2): void {
  const start = performance.now();
  while (this.head < this.queue.length && performance.now() - start < budgetMs) {
    this.queue[this.head++]();
  }
  if (this.head === this.queue.length) {
    this.queue.length = 0;
    this.head = 0;
  }
}
```

In Godot, the same loop uses `Time.get_ticks_usec()` inside `_process`. In Unity, use `Time.realtimeSinceStartupAsDouble`, because `Time.time` does not advance within a frame. Jobs and Burst suit large arrays once a trace shows the loop is the cost; keep Unity API calls on the main thread. Keep gameplay correct while work is pending (an enemy without a fresh path keeps its last one) and clear the queue on scene restart.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Use average FPS as the only result | Show frame-time distribution and worst hitch; averages hide stutter |
| Treat Godot movie capture's fixed FPS as speed | Profile real interactive rendering; recording dictates its own cadence |
| Add profiler counters together | Counters overlap or measure different scopes |
| Assume cached `transferSize: 0` means a free asset | Compare cold transfer, decoded size and build bytes separately |
| Pool everything or reduce the physics rate immediately | Measure first; pools retain memory and timestep changes alter gameplay |
| Attribute gains after several unrelated changes | Isolate a cause so gains and regressions can be explained |
| Hand-roll a quadtree for a few dozen actors | Measure pair checks first; the broadphase or a uniform grid usually suffices |

## Done when

- [ ] The original workload and units are reproducible; unmeasured metrics are labeled unavailable.
- [ ] Measurements before and after use the same conditions. The change exceeds normal variance, or the result is stated as uncertain.
- [ ] Collision, timing and visual behavior still match the requested game.
- [ ] `pixo game run <projectId> --json` was used when interactive comparison was needed; stop your own session with `pixo game stop <projectId> --json`. Unity comparisons use a Development Build with the Profiler attached.
- [ ] Report actual measurements and functional checks; temporary diagnostics and stress fixtures stay out of normal startup.
- [ ] Inspect logs and identify skipped checks from `pixo game verify --steps check,build --json`.
