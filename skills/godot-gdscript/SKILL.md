---
name: godot-gdscript
en_name: Godot 4 GDScript craft
zh_name: Godot 4 GDScript 开发规范
description: "Write or fix Godot 4 GDScript, scenes, input, resources, animation or saves, using version-correct APIs and OpenPixo verification. Not engine installation or an automatic architecture rewrite."
zh_description: "使用版本匹配的 API 编写或修复 Godot 4 GDScript、场景、输入、资源、动画与存档，并用 OpenPixo 验证；不用于引擎安装，也不自动重写架构。"
triggers:
  - godot
  - gdscript
  - godot 4
  - characterbody2d
  - godot scene
  - Godot 开发
  - GDScript 脚本
  - Godot 场景
  - Godot 存档
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
  category: game-development
  design_system:
    requires: false
  example_prompt: Add a dash ability to the player with a cooldown, wired to an input action that also works on a gamepad.
  example_prompt_i18n:
    zh-CN: 给玩家加一个带冷却的冲刺技能，绑定到同时支持手柄的输入动作上。
---

# Godot 4 GDScript craft

The user's choices and existing project conventions, architecture and engine version win. Examples target **Godot 4.3**; inspect `project.godot` `config/features` and the configured editor's version before using minor-version additions.

## Quick path

1. Read `project.godot`, the affected scene and script, then relevant input, autoload and resource definitions.
2. Make the requested change within the existing owner; use the pitfalls table for Godot 3 habits.
3. Add only necessary actions and resources. Preserve tracked references and import metadata.
4. Run `pixo game verify --steps check --json`; inspect parse, script and resource errors in logs even if the process exits zero.
5. Play the changed path. For visible changes, `pixo game playtest --duration 10 --json` can capture supported Godot output, but it does not inject player input.

Commands inherit `PIXO_PROJECT_ID`; otherwise add `--project <id>`. In a host that exposes executable paths, PowerShell invokes the CLI with `& $env:PIXO_NODE_BIN $env:PIXO_BIN` in place of `pixo`.

## Godot 3 → 4 pitfalls

| Wrong version or habit | Right: Godot 4 anchor |
| --- | --- |
| `KinematicBody2D`, `move_and_slide(vel, Vector2.UP)` | `CharacterBody2D`; set `velocity` and `up_direction`, then `move_and_slide()` |
| `export var`, `onready var`, `tool` | `@export var`, `@onready var`, `@tool` |
| `yield(obj, "signal")` | `await obj.signal` |
| Old target and method-string signal connection | `button.pressed.connect(_on_pressed)`; typed signal emission: `hit.emit(1)` |
| `File`, `Directory` | `FileAccess`, `DirAccess` |
| `scene.instance()` | `scene.instantiate()` |
| `get_tree().change_scene(path)` | `get_tree().change_scene_to_file(path)` |
| `Sprite`, `Position2D`, `YSort`, Tween node | `Sprite2D`, `Marker2D`, `y_sort_enabled`, `create_tween()` |
| `rand_range`, `stepify`, `deg2rad`, `OS.get_ticks_msec()` | `randf_range`, `snapped`, `deg_to_rad`, `Time.get_ticks_msec()` |
| `to_json`, `parse_json` | `JSON.stringify`, `JSON.parse_string` |
| `BUTTON_LEFT`, `event.scancode` | `MOUSE_BUTTON_LEFT`, `event.keycode` or `physical_keycode` |
| `setget` | Inline `set(value):` and `get:` or `var hp: int: set = set_hp` |
| `.empty()`, `PoolStringArray`, text scene `format=2` | `.is_empty()`, `PackedStringArray`, `format=3` |
| Typed dictionaries in 4.3 | Plain `Dictionary`; typed dictionaries require 4.4+ |
| `TileMapLayer` API in 4.0–4.2 | Existing `TileMap` layer-index API; `TileMapLayer` is available from 4.3 |

## Scenes, signals and ownership

- Keep existing scene boundaries. Reusable scenes instantiate with `preload("res://enemies/enemy.tscn").instantiate()` and `add_child()`; adapt the inspected path.
- Prefer local child references and signals for upward events. `%Name` requires Access as Unique Name; `@onready` initializes tree references after children enter.
- Connect once per owner lifetime, for example `player.health_changed.connect(_on_health_changed)`. Shared emitters surviving a scene need matching cleanup.
- `queue_free()` schedules deletion safely; reserve immediate `free()` for contexts where no active callback needs the object.
- Follow the project's pause owner. A menu that handles Resume needs `Node.PROCESS_MODE_ALWAYS` or the appropriate existing processing policy.
- The editor owns generated `.godot/` content. Prefer editor-aware moves and renames; preserve tracked `.import` and version-specific UID companions and update affected `res://` references. Invented `uid://` values break resource identity.
- Handwritten Godot 4 scenes and resources use `format=3` and string resource IDs such as `ExtResource("1")`. Small code-built trees can be clearer than a large manual scene rewrite.

## Movement: velocity versus displacement

Godot 4.3 `CharacterBody2D` stores pixels per second in `velocity`. Acceleration and gravity use delta; `move_and_slide()` integrates velocity itself.

```gdscript
extends CharacterBody2D
@export var max_speed: float = 220.0
@export var acceleration: float = 1400.0
@export var jump_velocity: float = -420.0
var gravity: float = float(ProjectSettings.get_setting("physics/2d/default_gravity"))

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += gravity * delta
	if Input.is_action_just_pressed(&"jump") and is_on_floor():
		velocity.y = jump_velocity
	var axis: float = Input.get_axis(&"move_left", &"move_right")
	velocity.x = move_toward(velocity.x, axis * max_speed, acceleration * delta)
	move_and_slide()
```

Keep physics movement in `_physics_process` and presentation in its existing update path. Rigid bodies use forces, impulses or `_integrate_forces`, rather than a competing per-frame position controller. Name and inspect collision layers and masks; `set_collision_mask_value(2, true)` uses a one-based layer number. See [CharacterBody2D 4.3](https://docs.godotengine.org/en/4.3/classes/class_characterbody2d.html).

## Input and data decisions

| Need | Use | Avoid |
| --- | --- | --- |
| Gameplay input | Existing named actions; `Input.get_vector`, `Input.get_axis`, `is_action_just_pressed` | A second raw-key reader that bypasses remapping |
| New action | Project Input Map or startup `InputMap.add_action` and `action_add_event` | Duplicate defaults after settings overrides; keep `ui_*` menus usable |
| Controller support | Existing schemes and deadzones; `Input.joy_connection_changed` | Assuming a connected device cannot disappear |
| Tunables | `@export` or `@export_range` on owned values | Hard-coded cross-scene paths for configurable references |
| Authored data | Existing Resources such as `.tres` or validated JSON | Shared loaded Resources as mutable per-enemy runtime state |
| Cross-scene lifetime | Existing state owner; an autoload only if needed | Adding a singleton for a local scene concern |

Use explicit types at interfaces and where inference is ambiguous; retain readable inference elsewhere. `Array[Enemy]` is supported in 4.3. Check nullable object casts before use. Resource duplication needs the correct subresource graph: a shallow copy still shares nested references.

## Saves under user://

Use the existing save and schema owner. `res://` is not a writable runtime save location in exports. Settings can use `ConfigFile`; preserve other sections and check load and save errors.

A focused defensive JSON loader; adapt the path and schema to the game:

```gdscript
func load_game() -> Dictionary:
	var path: String = "user://save.json"
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if parsed is Dictionary:
		var data: Variant = parsed.get("data", {})
		if data is Dictionary:
			return data
	return {}
```

When writing, check `FileAccess.open` for null and report `FileAccess.get_open_error()`. Use a version field, defaults, deliberate migration and recovery; a malformed save is not permission to overwrite progress. JSON numbers may require validated integer conversion, and Vector2 and other engine values need explicit component encoding. See [FileAccess 4.3](https://docs.godotengine.org/en/4.3/classes/class_fileaccess.html).

## Packed animation and optional generated assets

- `pixo asset pack <frames...> --format godot-tres --json` produces an atlas PNG and SpriteFrames TRES with looping `default` at 5 FPS, preserving input frame order. Read actual paths from the report and keep the pair together.
- Assign the resource to `AnimatedSprite2D.sprite_frames`, then `sprite.play(&"default")`. Name and retime animations explicitly when needed; one-shots need looping disabled for `animation_finished`.
- Pack one animation's ordered frames per resource, or build named animations with `SpriteFrames.add_animation` and `add_frame`. Verify frame counts before splitting rows.
- When new generated art is requested: `pixo recipe list --surface image --json`, `pixo recipe show <id> --json`, then `pixo recipe run <id> --input key=value --wait --json` using its actual inputs. Candidates are staged.
- Inspect candidate art and checks before `pixo recipe adopt <runId> --candidate <candidateId> --json`. Use adopted paths, then run the verify check to import newly added assets.

## Pixel art display and readable text

For pixel art, keep the window large and let Godot scale the world, so UI text stays sharp. In `project.godot`:

```ini
[display]
window/size/viewport_width=480       ; the pixel resolution: how much world fits on screen
window/size/viewport_height=270
window/stretch/mode="canvas_items"    ; not "viewport", which renders text at 480x270 and blows it up
window/stretch/scale_mode="integer"   ; Godot 4.2+
[rendering]
textures/canvas_textures/default_texture_filter=0   ; Nearest
2d/snap/snap_2d_transforms_to_pixel=true
```

Put HUD and menus in a `CanvasLayer` of Control nodes. If text looks jagged, set that layer's `texture_filter` to Linear. As the player sees it in a 1280x720 window, text is at least 16 px tall (18 px for Chinese, Japanese and Korean); check a screenshot.

## Done when

- [ ] Relevant parsing, resource loading and changed gameplay behavior pass; new actions have the requested devices' bindings.
- [ ] Signals connect once, tracked paths resolve, and saves and settings preserve existing data.
- [ ] Inspected any returned screenshot and logs; report interactive checks separately from capture. Use the installed version's docs for APIs beyond these 4.3 examples.
- [ ] For configured exports, run `pixo game verify --steps check,build,run --screenshot --json` to check the broader path. Missing presets or tools are skipped or failed capabilities, not passes.
