---
name: player-controller-2d
en_name: Responsive 2D player controllers
zh_name: 灵敏的 2D 玩家控制器
description: Implement or tune platformer or top-down movement and jump timing in Godot 4, Unity 6 or Phaser 3; not for animation or camera-only changes.
zh_description: 在 Godot 4、Unity 6 或 Phaser 3 中实现或调整平台跳跃、俯视角移动与跳跃时序；不用于仅动画或镜头的改动。
triggers:
  - 2D player controller
  - platformer coyote time
  - 2D jump buffer
  - 2D top-down movement
  - fixed timestep
  - tunneling through walls
  - Rigidbody2D jump
  - 2D 玩家控制器
  - 平台跳跃土狼时间
  - 2D 跳跃缓冲
  - 高速穿墙
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# Responsive 2D player controllers

Use for delayed or slippery movement, jump timing or a new 2D controller in Godot 4, Unity 6 or Phaser 3.
Project conventions, installed version, architecture, input mappings and explicit user choices take precedence.
Preserve collision geometry and scene ownership unless the requested change needs them.
Animation and camera code should consume movement state rather than become a second movement owner.

## Quick path

1. Read the player, input actions, physics tick and gravity owner; reproduce the specific timing problem.
2. Pick the relevant movement branch below. Tune only the requested parameters.
3. Integrate with the existing controller; consume each buffered jump once and reset transient state on respawn or focus changes.
4. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser.
5. Play the affected timing cases and one nearby boundary; use a small test lane only if the existing level cannot expose them.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.

| Need | Choose or measure |
| --- | --- |
| Platformer grace | Coyote timer after leaving floor; jump buffer before landing; both consumed on accepted jump |
| Tap versus hold height | Cut upward velocity when jump is no longer held, including a released buffered press |
| Top-down movement | No gravity or jump branch; clamp diagonal length while preserving analog strength |
| Acceleration and braking | Separate rates; acceleration = speed / time-to-speed |
| Target jump height and time to apex | For constant gravity: `g = 2h / t²`, jump speed `= 2h / t`; validate under the actual integrator |

## Godot 4 platformer anchor

Adapt this to the existing CharacterBody2D and actual Input Map actions.
`is_on_floor()` reflects the last `move_and_slide()`; velocities are pixels per second.

```gdscript
extends CharacterBody2D
@export var speed: float = 220.0
@export var acceleration: float = 1400.0
@export var braking: float = 2000.0
@export var jump_speed: float = 420.0
@export var gravity: float = 1100.0
@export var coyote_seconds: float = 0.10
@export var buffer_seconds: float = 0.12
var coyote_left: float = 0.0
var buffer_left: float = 0.0

func _physics_process(delta: float) -> void:
    var grounded: bool = is_on_floor() and velocity.y >= 0.0
    coyote_left = coyote_seconds if grounded else maxf(0.0, coyote_left - delta)
    buffer_left = maxf(0.0, buffer_left - delta)
    if Input.is_action_just_pressed(&"jump"):
        buffer_left = buffer_seconds
    var axis := Input.get_axis(&"move_left", &"move_right")
    var rate := braking if is_zero_approx(axis) else acceleration
    velocity.x = move_toward(velocity.x, axis * speed, rate * delta)
    if not grounded:
        velocity.y += gravity * delta
    if buffer_left > 0.0 and coyote_left > 0.0:
        velocity.y = -jump_speed
        buffer_left = 0.0
        coyote_left = 0.0
    if not Input.is_action_pressed(&"jump") and velocity.y < -jump_speed * 0.45:
        velocity.y = -jump_speed * 0.45
    move_and_slide()
```

This consumes a landing buffer on the next physics tick. If same-tick launch matters, add a post-move landing check through a shared jump function, without a second `move_and_slide()`.
Godot already carries moving-platform velocity; adding it again causes a double boost.

For top-down, set `motion_mode = CharacterBody2D.MOTION_MODE_FLOATING` and replace platformer logic:

```gdscript
var direction := Input.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")
velocity = velocity.move_toward(direction * speed, acceleration * delta)
move_and_slide()
```

`Input.get_vector` handles the deadzone, caps diagonal length and retains analog strength.
A nonlinear stick curve belongs on vector magnitude, not independently squared X and Y.

## Phaser 3 timing anchor

The Scene fragment assumes dynamic `player` and mapped keyboard fields `left/right/jump`.
Keep Arcade gravity and colliders in their existing owner; Phaser delta is milliseconds.

```ts
private coyoteLeft = 0;
private bufferLeft = 0;

update(_time: number, delta: number): void {
  const dt = delta / 1000;
  const body = this.player.body as Phaser.Physics.Arcade.Body;
  const grounded = (body.blocked.down || body.touching.down) && body.velocity.y >= 0;
  this.coyoteLeft = grounded ? 0.10 : Math.max(0, this.coyoteLeft - dt);
  this.bufferLeft = Math.max(0, this.bufferLeft - dt);
  if (Phaser.Input.Keyboard.JustDown(this.jump)) this.bufferLeft = 0.12;
  const axis = Number(this.right.isDown) - Number(this.left.isDown);
  const step = (axis === 0 ? 2000 : 1400) * dt;
  this.player.setVelocityX(body.velocity.x +
    Phaser.Math.Clamp(axis * 220 - body.velocity.x, -step, step));
  if (this.bufferLeft > 0 && this.coyoteLeft > 0) {
    this.player.setVelocityY(-420);
    this.bufferLeft = this.coyoteLeft = 0;
  }
  if (!this.jump.isDown && body.velocity.y < -189) this.player.setVelocityY(-189);
}
```

Feed gamepad press and held actions through the same rules. Reset timers and pending input in `init()` or respawn.
For manual fixed-step physics, run movement and timers at that step; define focus and pause behavior instead of carrying stale input.
For top-down, `body.setAllowGravity(false)`; limit a Vector2's length to 1 without normalizing every nonzero analog value.

## Unity 6 platformer anchor

Adapt this to the existing Rigidbody2D and input actions. Velocities are world units per second, not pixels: at 32 pixels per unit, 220 px/s is about 6.9. It assumes PlayerInput's default map enables `Gameplay/Move` (Vector2) and `Gameplay/Jump` (Button), with dynamic input updates.

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(Rigidbody2D), typeof(PlayerInput))]
public sealed class PlatformerMotor : MonoBehaviour
{
    [SerializeField] private float speed = 7f, acceleration = 45f, braking = 65f, jumpSpeed = 13f;
    [SerializeField] private float coyoteSeconds = 0.10f, bufferSeconds = 0.12f;
    [SerializeField] private LayerMask ground;
    private Rigidbody2D body;
    private InputAction move, jump;
    private ContactFilter2D floor;
    private float axis, coyoteLeft, bufferLeft;
    private bool jumpHeld;

    private void Start()
    {
        body = GetComponent<Rigidbody2D>();
        var actions = GetComponent<PlayerInput>().actions;
        move = actions.FindAction("Gameplay/Move", true);
        jump = actions.FindAction("Gameplay/Jump", true);
        floor.useTriggers = false;
        floor.SetLayerMask(ground);
        floor.SetNormalAngle(45f, 135f); // Upward-facing contacts only, not walls or ceilings.
    }

    // Press edges exist for one frame, and FixedUpdate can run zero or several times per frame.
    private void Update()
    {
        axis = move.ReadValue<Vector2>().x;
        jumpHeld = jump.IsPressed();
        if (jump.WasPressedThisFrame()) bufferLeft = bufferSeconds;
    }

    private void FixedUpdate()
    {
        var dt = Time.fixedDeltaTime;
        var velocity = body.linearVelocity;
        var grounded = body.IsTouching(floor) && velocity.y <= 0.01f;
        coyoteLeft = grounded ? coyoteSeconds : Mathf.Max(0f, coyoteLeft - dt);
        bufferLeft = Mathf.Max(0f, bufferLeft - dt);
        var rate = Mathf.Approximately(axis, 0f) ? braking : acceleration;
        velocity.x = Mathf.MoveTowards(velocity.x, axis * speed, rate * dt);
        if (bufferLeft > 0f && coyoteLeft > 0f)
        {
            velocity.y = jumpSpeed;
            bufferLeft = coyoteLeft = 0f;
        }
        if (!jumpHeld && velocity.y > jumpSpeed * 0.45f) velocity.y = jumpSpeed * 0.45f;
        body.linearVelocity = velocity;
    }
}
```

Clear `axis`, `jumpHeld` and both timers in `OnDisable` and on respawn.

- Body setup: Dynamic, Freeze Rotation Z, Interpolate on, Collision Detection Continuous. A zero-friction `PhysicsMaterial2D` stops the player sticking to walls while holding toward them.
- Gravity is `Physics2D.gravity.y * gravityScale`. To hit a target `g` from the table above, set `gravityScale = g / -Physics2D.gravity.y`.
- A capsule collider rides over tile seams that catch a box. Merge tile colliders with a CompositeCollider2D (see level-design-tilemap).
- Move through the body only. Writing `transform.position` skips interpolation and sweeping; teleport with `body.position` and clear velocity and timers.
- Riding a moving platform is not automatic for a body whose X velocity you assign. Add the platform's velocity deliberately, or use the project's existing rule.

For top-down, set `gravityScale = 0`, then `body.linearVelocity = Vector2.MoveTowards(body.linearVelocity, Vector2.ClampMagnitude(input, 1f) * speed, acceleration * dt)`. Stick deadzones belong on the action's processors, and `ClampMagnitude` keeps analog strength. `Rigidbody2D.Slide` suits a Kinematic controller that resolves its own collisions; do not add it on top of a Dynamic one.

## Fixed step and fast bodies

Use when jump height or speed changes with display refresh rate, or when a fast fall, dash or projectile passes through geometry.

- Godot runs `_physics_process` at `physics/common/physics_ticks_per_second` (default 60), so movement there is already fixed-step. For smooth motion on high-refresh displays, enable `physics/common/physics_interpolation` (2D since 4.3) instead of moving the player in `_process`; call `reset_physics_interpolation()` after a teleport or respawn.
- Unity runs `FixedUpdate` at `Time.fixedDeltaTime`, which defaults to 0.02 s (50 Hz, not 60). Interpolate on the body covers high-refresh displays; do not move the body in `Update`.
- Phaser Arcade steps its world at `physics.arcade.fps` (default 60); do not wrap Arcade velocity changes in a second accumulator. Custom movement without Arcade bodies needs one:

```ts
private accumulator = 0;
private readonly step = 1 / 60;

update(_time: number, delta: number): void {
  // Clamp a long stall so the loop catches up instead of spiraling.
  this.accumulator += Math.min(delta / 1000, 0.25);
  while (this.accumulator >= this.step) {
    this.simulate(this.step);
    this.accumulator -= this.step;
  }
}
```

A discrete overlap check misses a body whose per-step travel exceeds its own size plus the collider's thickness: 1500 px/s at 60 Hz moves 25 px per step, so a 6 px bullet can skip a 16 px wall.
Fix in this order: cap the speed the design does not need, thicken the thin collider, then sweep from the previous to the current position.
Godot's `move_and_slide()` already sweeps the body's motion; `Area2D` bullets need a `RayCast2D` or `ShapeCast2D` along their travel, and a `RigidBody2D` can set `continuous_cd`.
Arcade has no continuous collision: set `body.maxVelocity`, raise `physics.arcade.tileBias` for fast bodies against tiles, or test the segment between previous and current centers (`body.prev` and `body.position` plus half the body size) with `Phaser.Geom.Intersects.LineToRectangle`.
In Unity, Collision Detection Continuous protects a Dynamic Rigidbody2D moved by velocity. A bullet moved by `transform.position` gets none of it, so `Physics2D.Linecast` or `CircleCast` from its previous position to the new one.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Godot 3 `move_and_slide(velocity)` | Godot 4 uses the body's `velocity` and no-argument `move_and_slide()` |
| Unity `Rigidbody2D.velocity` from an old sample | Unity 6 renamed it `linearVelocity` |
| Read a Unity press edge in `FixedUpdate` | Read edges in `Update` and buffer them; a fixed tick can miss the frame they happened on |
| Multiply velocity by delta before physics | Multiply acceleration and manual displacement only; physics integrates velocity |
| Re-arm coyote while rising or from another ground ray | Consume grace and use one grounded source; stale contacts can grant another jump |
| Check only a release edge | Also cut a buffered jump whose button is already released |
| Normalize every input vector | Clamp length to preserve analog speed |
| Resize collision to hide slippery controls | Tune motion first; hitbox changes alter passable gaps |

## Done when

- [ ] Tap and hold heights differ; walking off a ledge permits only the intended coyote window.
- [ ] A press just before landing jumps once; holding through landing does not cause repeated jumps.
- [ ] Ceiling, reversal, pause, focus, respawn and supported devices work; compare different render rates.
- [ ] The fastest fall, dash or projectile does not pass through the thinnest collider it can meet.
- [ ] Inspect `pixo game verify --steps check --json` (Godot), `--steps check,build` (Unity) or `--steps build` (Phaser), including skipped checks.
- [ ] Use `pixo game run <projectId> --json` for timing tests. For matching browser bindings, `pixo game playtest --preset runJump --json` adds replay evidence; screenshots or Godot capture alone do not prove input timing. Neither command supports Unity: test in the Editor or a player, at more than one refresh rate.
