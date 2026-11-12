---
name: game-ui-hud
en_name: Game HUD, menus and input focus
zh_name: 游戏 HUD、菜单与输入焦点
description: "Implement in-game HUD, pause and settings menus with keyboard and controller focus in Godot 4, Unity 6 or Phaser 3. Use for playable game UI and scaling; not a website dashboard or image-only UI mockup."
zh_description: "在 Godot 4、Unity 6 或 Phaser 3 中实现游戏 HUD、暂停和设置菜单及键盘和手柄焦点，处理可玩界面与缩放；不用于网站仪表盘或纯图片 UI 效果图。"
triggers:
  - game HUD
  - pause menu
  - controller menu navigation
  - game settings menu
  - Unity pause menu
  - 游戏 HUD
  - 暂停菜单
  - 手柄菜单导航
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
  example_prompt: Add a pause menu with Resume and Settings, keyboard and controller navigation, and a score HUD that stays fixed while the camera moves.
  example_prompt_i18n:
    zh-CN: 加入含继续和设置的暂停菜单，支持键盘与手柄导航，并让分数 HUD 在镜头移动时保持固定。
---

# Game HUD, menus and input focus

Preserve the user's requested UI, project visual and input conventions, engine and version. Extend the existing HUD and settings owners; a score label does not require a new scene architecture or invented health system.

## Quick path

1. Find the authoritative state and affected UI owner; initialize labels from current values, then connect changes once.
2. Choose the requested HUD or menu case below and preserve the project's policy for the logical viewport and scaling.
3. For menus, give one owner responsibility for pause, visibility, input consumption and focus return.
4. Persist changed settings through the existing settings owner; keep navigation usable while values change.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser, then test relevant devices, resize and restart.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. `pixo game run <projectId> --json` starts supported gameplay for interaction checks; on Unity, test in the Editor or a player build.

## Choose the boundary

| Request | Implementation anchor | Key check |
| --- | --- | --- |
| HUD value | Observe the owner of score, health or objectives | Labels never become the source of truth |
| Fixed screen-space HUD | Godot CanvasLayer with Control, Unity Screen Space - Overlay canvas or separate Phaser HUD scene | Camera follow and shake leave essential UI fixed |
| Pause menu | Gameplay suspension separate from menu input and animation | Resume consumes its input and returns focus |
| Settings subpanel | Working control, current value, Back target and persistence | No dead-end Settings button or lost focus |
| UI scaling | Existing anchors and containers or logical canvas coordinates | Long text, safe margins and hit targets survive resize |

## Godot 4.3: pause and focus

Put a full-rect `Control` beneath a `CanvasLayer`. Use containers for growing labels and `MarginContainer` for insets; preserve the project's stretch configuration. Decorative overlays use `MOUSE_FILTER_IGNORE`; the modal panel and backdrop use `MOUSE_FILTER_STOP` to consume pointer interaction.

Example on a pause CanvasLayer with `Menu` and `Menu/Resume`:

```gdscript
extends CanvasLayer
@onready var menu: Control = $Menu
@onready var resume_button: Button = $Menu/Resume
var previous_focus: Control

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	menu.hide()
	resume_button.pressed.connect(func() -> void: set_paused(false))

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"pause") and not event.is_echo():
		set_paused(not get_tree().paused)
		get_viewport().set_input_as_handled()

func set_paused(paused: bool) -> void:
	if paused == get_tree().paused:
		return
	if paused:
		previous_focus = get_viewport().gui_get_focus_owner()
	get_tree().paused = paused
	menu.visible = paused
	if paused:
		resume_button.grab_focus()
	elif is_instance_valid(previous_focus) and previous_focus.is_visible_in_tree():
		previous_focus.grab_focus()
```

Define the `pause` action with the project's Escape or Start bindings. In a settings subpanel, route Back before toggling the entire pause state. If another system already owns pausing, call that owner rather than installing this second state owner.

- Buttons need `FOCUS_ALL`, visible focus styling and usable neighbors. Preserve built-in `ui_*` actions.
- Keep the menu processing while ordinary gameplay is pausable; an input handler on a paused gameplay node cannot resume itself.
- Consume the event that opens the menu or resumes play and reset cached action edges so the same press cannot jump or fire on resume.
- Return focus to the launching button after a subpanel closes. Validate saved focus references because a scene may have been removed.
- Settings use existing `ConfigFile` or save ownership under `user://`. For audio, validate `AudioServer.get_bus_index("Music")` against `-1` before setting a named bus.
- References: [Control 4.3](https://docs.godotengine.org/en/4.3/classes/class_control.html), [pause processing 4.3](https://docs.godotengine.org/en/4.3/tutorials/scripting/pausing_games.html).

## Phaser 3: keep menu input alive

With existing registered `Game` and `Pause` scene keys, the gameplay owner can launch the menu while pausing only gameplay:

```ts
this.scene.launch('Pause', { gameKey: 'Game' });
this.scene.pause('Game');
```

From the Pause scene's Resume action, using the passed gameplay key:

```ts
this.scene.resume(gameKey);
this.scene.stop(); // Stops this Pause scene.
```

Use actual project keys. Scene operations are queued; guard repeated requests to pause or resume so one input edge cannot enqueue duplicate menus. See [Phaser 3.90 ScenePlugin](https://github.com/phaserjs/phaser/blob/v3.90.0/src/scene/ScenePlugin.js).

- A separate HUD scene has its own camera. `setScrollFactor(0)` fixes scrolling in a world scene, but does not isolate camera shake.
- Share one selection operation between pointer hover, keyboard and gamepad. For multiple items, `Phaser.Math.Wrap(index + direction, 0, items.length)` wraps; skip disabled entries.
- Use key and button edges, not held state. Enable gamepad input in the existing config; browser recognition may require an initial button press.
- Block gameplay pointer and key handlers while the modal is active. Pausing Arcade physics alone leaves custom update and input logic possible; pause the relevant gameplay owner or gate all its updates.
- Remove shared listeners for the registry, gamepad, scale and window on `Phaser.Scenes.Events.SHUTDOWN`. Reset selection and input-edge state in `init` or `create` so restarts do not inherit stale input.
- `Phaser.Scale.FIT` retains a fixed logical size; `RESIZE` requires relayout from new logical dimensions. CSS enlargement alone is not a UI scale setting.

## Unity 6: uGUI pause and focus

Check which UI system the project uses: uGUI (Canvas) or UI Toolkit (UIDocument). Extend that one; do not mix a second system in for one menu.

This uGUI example assumes PlayerInput with `Gameplay` and `UI` action maps, a `Gameplay/Pause` and a `UI/Cancel` action, and an EventSystem using `InputSystemUIInputModule`. Wire Resume's `onClick` to `SetPaused(false)`. If another system owns `Time.timeScale`, call it instead of writing it here.

```csharp
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;

public sealed class PauseMenu : MonoBehaviour
{
    [SerializeField] private PlayerInput input;
    [SerializeField] private GameObject menu;
    [SerializeField] private Selectable resume;
    private InputAction pause, cancel;
    private GameObject previousFocus;
    public bool Paused { get; private set; }

    private void Start()
    {
        pause = input.actions.FindAction("Gameplay/Pause", true);
        cancel = input.actions.FindAction("UI/Cancel", true);
        menu.SetActive(false);
    }

    // Update still runs at timeScale 0; FixedUpdate does not.
    private void Update()
    {
        if ((Paused ? cancel : pause).WasPressedThisFrame()) SetPaused(!Paused);
    }

    public void SetPaused(bool paused)
    {
        if (paused == Paused) return;
        Paused = paused;
        if (paused) previousFocus = EventSystem.current.currentSelectedGameObject;
        Time.timeScale = paused ? 0f : 1f;
        input.SwitchCurrentActionMap(paused ? "UI" : "Gameplay");
        menu.SetActive(paused);
        if (paused) resume.Select();
        else if (previousFocus != null && previousFocus.activeInHierarchy)
            EventSystem.current.SetSelectedGameObject(previousFocus);
    }

    private void OnDestroy() { if (Paused) Time.timeScale = 1f; }
}
```

In a settings subpanel, `UI/Cancel` goes Back first, before closing the whole pause state. Leaving for another scene must clear `timeScale`: it is static and survives the load.

- If Input System update mode is Process Events In Fixed Update, input stops with `FixedUpdate` at time scale 0 and the menu cannot close. Check Project Settings before pausing this way.
- Assign the EventSystem's module to PlayerInput's UI Input Module field so UI and gameplay share one set of actions. Otherwise the module uses its own actions and map switches do not reach it.
- A mouse click on empty space clears the selection, and a controller then navigates nothing. When a navigate input arrives with `currentSelectedGameObject == null`, reselect the last valid control. Give selected states a visible transition.
- Set Canvas Scaler to Scale With Screen Size with the project's reference resolution, and use anchors, not absolute positions. Inset safe areas from `Screen.safeArea`.
- Turn off Raycast Target on decorative images and labels. A modal backdrop keeps it on so clicks cannot reach the HUD beneath. `CanvasGroup.interactable` and `blocksRaycasts` disable a whole panel; alpha alone leaves it clickable.
- Menu animation needs Animator `updateMode = UnscaledTime` and unscaled tweens, or it freezes when paused.
- Add `onClick` listeners once, in `Awake` or `Start`. Adding them in `OnEnable` without removing them fires the action twice after the second opening.
- UI Toolkit equivalents: `rootVisualElement.Q<Button>("resume").Focus()`, `PanelSettings.scaleMode`, `NavigationCancelEvent` for Back, and `focusable` on custom controls.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Pause the scene or node that must receive Resume | Keep the menu and input owner active |
| Read score from its label | Initialize and subscribe to authoritative game state |
| Hover and gamepad maintain different selections | Share selection and focus so mixed-device navigation stays predictable |
| Save settings by replacing progress | Update the settings owner or settings section only |
| Connect listeners again on each resume | Connect once per lifecycle and remove external listeners at shutdown |
| Return to a level while the tree stays paused | Clear the owned pause state before the destination starts |

## Done when

- [ ] Relevant HUD values initialize correctly and update once; camera movement and resize preserve readability.
- [ ] Keyboard-only and controller-only navigation and pointer-to-controller switching retain visible focus.
- [ ] Two cycles of pausing and resuming, Back from settings and scene restart neither leak input nor duplicate listeners.
- [ ] Settings persist without resetting progress; applicable verify command above passes.
- [ ] `pixo game playtest --duration 10 --json` can provide supported layout capture. Inspect it, and report navigation and pause observations separately. Unity capture is unsupported, so test at the smallest and largest target resolutions in the Game view or a player.
