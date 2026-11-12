---
name: enemy-ai-state-machines
en_name: Enemy AI state machines
zh_name: 敌人 AI 状态机
description: "Implement or debug enemy behavior in Godot 4, Unity 6 or Phaser 3. Cover transitions between patrol, chase, attack and flee, and attack timing. Not a general application state-machine or mandatory AI architecture replacement."
zh_description: "在 Godot 4、Unity 6 或 Phaser 3 中实现或调试敌人的巡逻、追击、攻击、逃跑转换与攻击时序；不用于通用应用状态机，也不强制替换既有 AI 架构。"
triggers:
  - enemy AI state machine
  - patrol and chase
  - enemy attack windup
  - enemy behavior
  - steering behaviors
  - hitbox and hurtbox
  - 敌人 AI
  - 敌人状态机
  - 巡逻追击
  - 受击判定框
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# Enemy AI state machines

Keep the user's behavior rules and the project's engine and version, combat and AI architecture. An existing behavior tree or component system can own these transitions; a small fix does not require replacing it with an FSM.

## Quick path

1. Inspect perception, movement, damage authority, pause and target lifetime for the affected enemy.
2. Note the relevant transition's condition, entry and exit effects and interruption rule; use a table for new behavior.
3. Give each enemy its own state, timers and one transition owner. Choose one authority for the strike instant.
4. Add temporary state and timer logging where it resolves uncertainty; test one enemy, then two and a restart.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser; inspect logs and play the transition cases.

Add `--project <id>` to verify outside a run with `PIXO_PROJECT_ID`. `pixo game run <projectId> --json` starts supported interactive gameplay; on Unity, play in the Editor or a player build.

## Transition decisions

Example pixel distances and times are starting values, not universal rules.

| From → to | Example condition | Entry and exit decision |
| --- | --- | --- |
| Patrol → chase | Eligible target within 140 px and visible | Remember target; use the existing movement route |
| Chase → patrol or search | Target lost or beyond 220 px | Wider exit radius avoids boundary chatter |
| Chase → attack | Target within 32 px | Stop locomotion; reset windup and strike-consumed flag |
| Attack → chase | Recovery finished at 0.55 s | One strike attempt after 0.20 s, with eligibility and range checked at strike time |
| Living → flee | Low health with nearby threat | Decide whether this cancels an unfinished strike |
| Any → dead or disabled | Combat owner reports death | Cancel remaining attack work and movement |

Use the game's units and measured reach. Distance-only perception sees through walls; add the existing sight query when occlusion matters. Direct chase fits a safe corridor; gaps, stairs and floors need routes or navigation links.

## Godot 4.3: attack timing without duplicate strikes

Focused methods on an existing enemy. Call `tick_attack` once per physics tick only while ATTACK is active. The combat owner connects the signal and validates line of sight, invulnerability and damage; this fragment does not implement the rest of the enemy.

```gdscript
signal strike_requested(target: Node2D)
enum State { PATROL, CHASE, ATTACK, FLEE }
@export var target: Node2D
var state: State = State.PATROL
var elapsed: float = 0.0
var struck: bool = false

func transition(next: State) -> void:
	if next == state:
		return
	state = next
	elapsed = 0.0
	struck = false

func tick_attack(delta: float) -> void:
	elapsed += delta
	velocity.x = 0.0 # On the existing CharacterBody2D.
	if not is_instance_valid(target):
		transition(State.PATROL)
		return
	if elapsed >= 0.20 and not struck:
		struck = true
		if global_position.distance_to(target.global_position) <= 44.0:
			strike_requested.emit(target)
	if elapsed >= 0.55:
		transition(State.CHASE)
```

The slightly larger strike radius permits small motion during windup. Choose whether leaving range causes a miss or cancels the attack; preserve that choice in the test.

- For platform movement, `RayCast2D.target_position` is local. Reposition wall and ledge probes toward requested travel and call `force_raycast_update()` before consuming a changed query.
- Terrain-only masks avoid hitting the enemy's shape or other actors' shapes. Check floor ahead before moving; airborne status alone is not proof of safe ground.
- Apply `CharacterBody2D.velocity` once, then `move_and_slide()` once. A top-down controller normally uses `MOTION_MODE_FLOATING` with no gravity.
- API references: [RayCast2D 4.3](https://docs.godotengine.org/en/4.3/classes/class_raycast2d.html), [CharacterBody2D 4.3](https://docs.godotengine.org/en/4.3/classes/class_characterbody2d.html).

## Hit and hurt volumes

Use shaped volumes instead of the distance check above when attack reach depends on facing, animation or weapon shape.

| Volume | Owner and layer | Rule |
| --- | --- | --- |
| Hitbox | Attacker's `Area2D` on a hitbox layer, masking only hurtboxes | Active only during the strike window; toggle with `set_deferred("monitoring", …)` from physics callbacks |
| Hurtbox | Target's `Area2D` on a hurtbox layer | Separate from the movement `CollisionShape2D`, so damage reach can change without altering passable gaps |
| Per-swing record | Attacker clears a set of hit targets when the window opens | A target already in the set is skipped, so a long window hits it once |

The combat owner still decides damage and invulnerability; the volume only reports contact. In Phaser, an attack `Zone` with an Arcade body and `physics.add.overlap(zone, hurtboxGroup, …)` plays the same role; enable the body only during the window.

## Steering for top-down and flying enemies

Seek, arrive and separation keep a crowd from stacking on one pixel and from overshooting the target. Steering is local: with `NavigationAgent2D`, steer toward `get_next_path_position()`, and do not add separation if the agent's own avoidance is enabled.

```gdscript
@export var max_speed: float = 120.0
@export var max_force: float = 400.0
@export var arrive_radius: float = 48.0
@export var separation_radius: float = 24.0

# neighbors excludes self; feed it from an Area2D or the scene's spatial query.
func steer_toward(goal: Vector2, neighbors: Array[Node2D], delta: float) -> void:
	var offset := goal - global_position
	var distance := offset.length()
	var desired := Vector2.ZERO
	if distance > 0.001:
		desired = offset / distance * max_speed * minf(1.0, distance / arrive_radius)
	for other in neighbors:
		var away := global_position - other.global_position
		var gap := away.length()
		if gap > 0.001 and gap < separation_radius:
			desired += away / gap * max_speed * (1.0 - gap / separation_radius)
	velocity += (desired - velocity).limit_length(max_force * delta)
	velocity = velocity.limit_length(max_speed)
	move_and_slide()
```

Platform enemies steer only on X; gravity and ledge probes stay as above. For large crowds, see the performance-profiling skill before scanning every enemy for neighbors.

## Phaser 3 adapter

| Concern | Phaser 3 anchor |
| --- | --- |
| Time | `update(time, delta)` receives milliseconds; use `delta / 1000` for seconds-based windup |
| Movement | Arcade `setVelocityX(speed)` uses pixels per second; do not multiply speed by delta |
| Attack | Stop X velocity, advance one timer, consume one strike; overlap callbacks only identify potential contact |
| Top-down | Disable Arcade gravity with `body.setAllowGravity(false)` and cap movement-vector length |
| Restart | Reset state and timers in `init` or `create`; remove shared listeners on `Phaser.Scenes.Events.SHUTDOWN` |
| Steering | Same vector math with `Phaser.Math.Vector2`; apply the result with `setVelocity`, in pixels per second |

Check whether the target is still active and alive before a strike. Prefer the installed Phaser 3 types over current-major documentation. Avoid independent delayed callbacks that can hit after destruction or after the attack is canceled.

## Unity 6 adapter

Focused members on an existing 2D enemy. Call `TickAttack` once from `FixedUpdate` while `Current` is `Attack`, so pause and hit-stop hold the windup. Distances are world units.

```csharp
using System;
using UnityEngine;

public sealed class EnemyAttack : MonoBehaviour
{
    public enum State { Patrol, Chase, Attack, Flee }
    public event Action<Transform> StrikeRequested;
    [SerializeField] private Rigidbody2D body;
    [SerializeField] private Transform target;
    private float elapsed;
    private bool struck;
    public State Current { get; private set; } = State.Patrol;

    public void Transition(State next)
    {
        if (next == Current) return;
        Current = next;
        elapsed = 0f;
        struck = false;
    }

    public void TickAttack()
    {
        elapsed += Time.fixedDeltaTime;
        body.linearVelocityX = 0f;
        if (target == null) { Transition(State.Patrol); return; }
        if (elapsed >= 0.20f && !struck)
        {
            struck = true;
            if (Vector2.Distance(body.position, target.position) <= 1.4f) StrikeRequested?.Invoke(target);
        }
        if (elapsed >= 0.55f) Transition(State.Chase);
    }
}
```

| Concern | Unity 6 anchor |
| --- | --- |
| Destroyed target | `target == null` catches a destroyed object through Unity's overloaded `==`; `target?.position` skips that check and throws `MissingReferenceException` |
| Sight | `Physics2D.Linecast(eye, targetPosition, occluderMask)`. With Queries Start In Colliders on, a query starting inside the enemy hits the enemy, so keep it off the mask |
| Ledge and wall probes | `Physics2D.Raycast(feetAhead, Vector2.down, distance, terrainMask)` each tick, before committing movement |
| Hit and hurt volumes | Child trigger colliders on hitbox and hurtbox layers, paired in the collision matrix. `OnTriggerEnter2D` needs a Rigidbody2D on one side, and also reaches scripts on the Rigidbody's object, so filter in the handler. Enable the hitbox collider only during the window, with a per-swing `HashSet` of targets already hit |
| Neighbors | `Physics2D.OverlapCircle(position, radius, filter, results)` with a preallocated array, refreshed at a set cadence |
| Navigation | `NavMeshAgent` with a `NavMeshSurface` (`com.unity.ai.navigation`) is 3D-oriented. In 2D, reuse the installed pathfinder or a grid search; do not assume a baked 2D NavMesh |
| Animation authority | Pick the timer or one Animation Event for the strike. With Animator Culling Mode set to cull, an off-screen enemy's events stop firing, so a strike driven by events never lands |
| Shared data | ScriptableObjects hold ranges and timings. Timers and targets stay on the instance, or every enemy shares one cooldown |
| Restart and pooling | Reset state, timers and triggers in `OnEnable`. Disabling an object stops its coroutines, so a delayed strike there is cancelled, but nothing restores what it was due to undo |
| Steering | Same vector math with `Vector2.ClampMagnitude`; assign the result to `linearVelocity` in `FixedUpdate`. `NavMeshAgent` already has avoidance |

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Deal damage on every overlap tick | Route through the one consumed strike event |
| Reuse the movement collider as the hurtbox | Keep a separate hurtbox; resizing one changes both damage and passable gaps |
| Timer strike plus animation-event strike | Pick one authority; two sources duplicate hits |
| Advance elapsed in both shared and state ticks | Advance once in simulation time; pause and hit-stop should preserve readable windup |
| Shared mutable resource stores cooldowns | Keep runtime state per enemy so two enemies act independently |
| Patrol across a ledge then reverse on falling | Probe a safe landing before committing movement |
| Recreate pathfinder or debug label every frame | Reuse them; refresh perception at an intentional cadence for crowds |

## Done when

- [ ] Observed both detection thresholds without chatter; debug output identifies enemy and transition.
- [ ] One strike attempt per attack; interruption, target destruction and respawn produce no delayed or stale hit.
- [ ] Relevant wall, ledge, flee, death, pause and restart cases work with two independent enemies.
- [ ] Where added: a long hitbox window hits each target once, and steering enemies arrive without overshoot or stacking.
- [ ] Report observed transitions separately from build or screenshot success. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser.
