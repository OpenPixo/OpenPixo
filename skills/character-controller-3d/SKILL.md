---
name: character-controller-3d
en_name: 3D character controller and camera
zh_name: 3D 角色控制器与镜头
description: "Build or tune 3D first-person or third-person movement, jump grace, slopes, camera collision or lock-on in Godot 4, Unity or Three.js. Not a 2D controller or animation-only workflow."
zh_description: "在 Godot 4、Unity 或 Three.js 中实现或调节 3D 第一或第三人称移动、跳跃宽限、坡面、镜头碰撞或锁定；不用于 2D 控制器或纯动画任务。"
triggers:
  - third-person controller
  - first-person controller
  - 3D character movement
  - camera collision
  - lock-on camera
  - 3D 角色控制器
  - 第三人称镜头
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - threejs
  category: game-development
---

# 3D character controller and camera

The project's engine and version, input backend, physics architecture and the user's choices for view and motion win over these defaults. For a narrow fix, test the affected obstacle; build a full movement course only for a new controller or broad retuning.

## Quick path

1. Inspect the owners of movement and camera behavior, collision shape, scale, actions and physics tick.
2. Reproduce the requested behavior on a flat surface, ledge, ramp or wall that exposes it.
3. Change the existing owner. Keep movement in physics; keep view and presentation in their existing update paths.
4. Discover exposed values with `pixo game tuning list --json` if tuning is relevant; use returned IDs with `pixo game tuning set <id> <value> --json`.
5. Verify Godot with `pixo game verify --steps check --json`, Unity with `--steps check,build` or web with `--steps build`, then play the affected cases. Unity has no `pixo game run`, so play in the Editor or a player.

Add `--project <id>` to these commands when `PIXO_PROJECT_ID` is absent. OpenPixo tuning edits supported Godot sources and tuning JSON sources; it is not a live Unity inspector.

## Choose the movement and view rules

| Case | Starting point | Important boundary |
| --- | --- | --- |
| First person | Body yaw plus pitch-only eye anchor | Clamp pitch; handle pointer-lock exit and focus loss |
| Third person | Camera-yaw-relative movement, separate visual facing | Preserve stick magnitude; cap combined input rather than normalizing all input |
| Godot 4 | `CharacterBody3D` and capsule | Set `velocity` in units per second, call `move_and_slide()` without delta |
| Unity 6 | Existing `CharacterController` or Rigidbody controller | `CharacterController.Move` takes displacement and applies no gravity |
| Three.js | Existing physics backend's capsule and sweep queries | Scene transforms alone do not resolve solid collisions |

Mouse motion is already a delta; gamepad angular velocity needs delta time. Reuse action edges once per physics tick. Keep root motion and code displacement under one owner to avoid double movement.

## Godot 4.3: jump buffer and coyote time

A focused controller example for Y-up meters. Assign `yaw` to a unit-scale pivot rotating only about Y; pitch belongs to its child. Define the named input actions in the existing InputMap.

```gdscript
extends CharacterBody3D
@export var yaw: Node3D
@export var speed: float = 5.0
@export var acceleration: float = 28.0
@export var gravity: float = 20.0
@export var jump_speed: float = 7.0
@export var coyote_seconds: float = 0.10
@export var buffer_seconds: float = 0.12
var coyote_left: float = 0.0
var buffer_left: float = 0.0

func _physics_process(delta: float) -> void:
	var grounded: bool = is_on_floor() # Previous move_and_slide result.
	coyote_left = coyote_seconds if grounded else maxf(0.0, coyote_left - delta)
	buffer_left = maxf(0.0, buffer_left - delta)
	if Input.is_action_just_pressed(&"jump"):
		buffer_left = buffer_seconds
	var axes: Vector2 = Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	var direction: Vector3 = (yaw.global_basis * Vector3(axes.x, 0.0, axes.y)).limit_length()
	var rate: float = acceleration if grounded else 10.0
	velocity.x = move_toward(velocity.x, direction.x * speed, rate * delta)
	velocity.z = move_toward(velocity.z, direction.z * speed, rate * delta)
	if buffer_left > 0.0 and coyote_left > 0.0:
		velocity.y = jump_speed
		buffer_left = 0.0
		coyote_left = 0.0
	else:
		velocity.y = 0.0 if grounded else velocity.y - gravity * delta
	move_and_slide()
```

A pre-landing buffered press fires on the next physics tick. Reset both timers on teleport, respawn or disabling movement. Variable jump height should shorten upward velocity on release, rather than replenish grace while rising.

- Set `up_direction`, `floor_max_angle` (radians), `floor_stop_on_slope` and scale-appropriate `floor_snap_length`. Snap attaches descending slopes; test just below and above the slope limit.
- Stairs require an existing rule for step-up sweeps and clearance or designed ramps; `safe_margin` alone is not a stair climber.
- For platforms, select `platform_floor_layers` and `platform_on_leave` deliberately.
- [Godot 4.3 CharacterBody3D](https://docs.godotengine.org/en/4.3/classes/class_characterbody3d.html) and [Unity 6 Move](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/CharacterController.Move.html) define these differing movement units. Use the project's version if different.

## Unity 6: CharacterController jump buffer and coyote time

The same rules on a `CharacterController`, for Y-up meters. `yaw` rotates only about Y, and pitch belongs to its child. `Gameplay/Move` is a Vector2 and `Gameplay/Jump` a Button, on PlayerInput's default map.

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController), typeof(PlayerInput))]
public sealed class CharacterMotor : MonoBehaviour
{
    [SerializeField] private Transform yaw;
    [SerializeField] private float speed = 5f;
    [SerializeField] private float acceleration = 28f;
    [SerializeField] private float gravity = 20f;
    [SerializeField] private float jumpSpeed = 7f;
    [SerializeField] private float coyoteSeconds = 0.10f;
    [SerializeField] private float bufferSeconds = 0.12f;
    private CharacterController controller;
    private InputAction move, jump;
    private Vector3 velocity;
    private float coyoteLeft, bufferLeft;

    private void Start()
    {
        controller = GetComponent<CharacterController>();
        var actions = GetComponent<PlayerInput>().actions;
        move = actions.FindAction("Gameplay/Move", true);
        jump = actions.FindAction("Gameplay/Jump", true);
    }

    private void Update()
    {
        var dt = Time.deltaTime;
        var grounded = controller.isGrounded; // Result of the previous Move.
        coyoteLeft = grounded ? coyoteSeconds : Mathf.Max(0f, coyoteLeft - dt);
        bufferLeft = Mathf.Max(0f, bufferLeft - dt);
        if (jump.WasPressedThisFrame()) bufferLeft = bufferSeconds;
        var axes = Vector2.ClampMagnitude(move.ReadValue<Vector2>(), 1f);
        var desired = (yaw.right * axes.x + yaw.forward * axes.y) * speed;
        var rate = (grounded ? acceleration : 10f) * dt;
        velocity.x = Mathf.MoveTowards(velocity.x, desired.x, rate);
        velocity.z = Mathf.MoveTowards(velocity.z, desired.z, rate);
        if (bufferLeft > 0f && coyoteLeft > 0f)
        {
            velocity.y = jumpSpeed;
            bufferLeft = coyoteLeft = 0f;
        }
        else velocity.y = grounded ? -2f : velocity.y - gravity * dt;
        controller.Move(velocity * dt); // Displacement, so delta belongs here.
    }

    public void Teleport(Vector3 position)
    {
        controller.enabled = false; // An enabled controller overwrites the assigned position.
        transform.position = position;
        controller.enabled = true;
        velocity = Vector3.zero;
        coyoteLeft = bufferLeft = 0f;
    }
}
```

- The constant `-2` keeps `isGrounded` stable. With no downward movement, the flag flickers false on flat ground.
- Inspector limits: Slope Limit, Step Offset (which handles small stairs) and Skin Width, plus Min Move Distance near 0 so slow analog input still moves. Test just below and above the slope limit.
- It does not ride moving platforms or push Rigidbodies by itself. Add platform motion to the displacement, and push from `OnControllerColliderHit`.
- A Rigidbody controller instead moves in `FixedUpdate`, with Interpolate on and input read in `Update` (see unity-csharp). Use one or the other on an actor.
- Camera follow belongs in `LateUpdate` or a Cinemachine camera, or it jitters against movement.

## Camera collision or lock-on, when requested

- Godot: `YawPivot/PitchPivot/SpringArm3D/Camera3D`, with camera directly under the arm. Set the arm's collision mask, margin and shape. Exclude the player's RID with `add_excluded_object(player.get_rid())`. See [SpringArm3D 4.3](https://docs.godotengine.org/en/4.3/classes/class_springarm3d.html).
- Shorten inward promptly to avoid walls; smooth outward recovery without exceeding the collision-safe boom length. Test corners, thin geometry and near-plane clipping.
- Unity: inspect the installed camera package before using collision extensions; Cinemachine major versions differ. Cinemachine 3 and later (`Unity.Cinemachine`) offers `CinemachineThirdPersonFollow` with its obstacle settings or a `CinemachineDeoccluder` on a `CinemachineCamera`; 2.x uses `CinemachineCollider` on a virtual camera. Keep the player's layers out of the camera's collision mask.
- Lock-on: filter living targets by range, view cone and line of sight. Then score distance in screen or world coordinates. Retain with hysteresis; support cycling, unlock and invalid-target removal.
- Preserve camera collision and the chosen rules for strafing and facing while locked. Aiming must not change collision or attack range. Keep manual override and motion intensity controls where applicable.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Normalize every analog vector | Cap length at one; normalization loses slow stick movement |
| Use pitched camera forward directly | Use yaw-only axes; looking up must not lift movement |
| Multiply Godot velocity by delta before sliding | Integrate acceleration and gravity with delta; slide integrates velocity |
| Multiply mouse relative motion by delta | Scale the motion directly; otherwise sensitivity changes with FPS |
| Test with only a stationary screenshot | Exercise jump timing, slope contact and camera walls interactively |

## Done when

- [ ] Relevant checks pass: diagonal and analog speed, jump edges, ceiling, slope boundary, platform departure, respawn, pause and focus loss.
- [ ] Camera and lock-on checks cover only requested features; targets can disappear safely.
- [ ] Compare different render rates at the same physics tick; record changed tunables and observations.
- [ ] Verification logs are clean or limitations are explicit. `pixo game playtest --duration 10 --json` offers supported Godot or web capture; it injects no Godot movement and provides no Unity capture, so report Unity checks from the Editor or a player.
