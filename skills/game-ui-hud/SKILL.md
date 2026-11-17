---
name: game-ui-hud
en_name: Game HUD, menus and input focus
zh_name: 游戏 HUD、菜单与输入焦点
description: "Implement in-game HUD, title and start screens, pause and settings menus with keyboard and controller focus in Godot 4, Unity 6, Phaser 3, Three.js or a plain web game, styled to fit the game. Use for playable game UI, its look and scaling; not a website dashboard or image-only UI mockup."
zh_description: "在 Godot 4、Unity 6、Phaser 3、Three.js 或普通网页游戏中实现游戏 HUD、标题与开始界面、暂停和设置菜单及键盘和手柄焦点，并让界面风格贴合游戏；处理可玩界面的外观与缩放，不用于网站仪表盘或纯图片 UI 效果图。"
triggers:
  - game HUD
  - pause menu
  - controller menu navigation
  - game settings menu
  - Unity pause menu
  - title screen
  - start screen
  - main menu
  - 游戏 HUD
  - 暂停菜单
  - 手柄菜单导航
  - 标题画面
  - 开始界面
  - 主菜单
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
    - threejs
    - web-generic
  category: game-development
  example_prompt: Add a pause menu with Resume and Settings, keyboard and controller navigation, and a score HUD that stays fixed while the camera moves.
  example_prompt_i18n:
    zh-CN: 加入含继续和设置的暂停菜单，支持键盘与手柄导航，并让分数 HUD 在镜头移动时保持固定。
---

# Game HUD, menus and input focus

Preserve the user's requested UI, project visual and input conventions, engine and version. Extend the existing HUD and settings owners; a score label does not require a new scene architecture or invented health system.

## Quick path

1. Find the authoritative state and affected UI owner; initialize labels from current values, then connect changes once.
2. Choose the requested HUD or menu case below and preserve the project's policy for the logical viewport and scaling. Unless a look is given, style it as in "Make it look like this game".
3. For menus, give one owner responsibility for pause, visibility, input consumption and focus return.
4. Persist changed settings through the existing settings owner; keep navigation usable while values change.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity, `--steps build` for Phaser, or `pixo game verify --json` for Three.js and plain web games. Then test relevant devices, resize and restart.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. `pixo game run <projectId> --json` starts supported gameplay for interaction checks; on Unity, test in the Editor or a player build.

## Choose the boundary

| Request | Implementation anchor | Key check |
| --- | --- | --- |
| HUD value | Observe the owner of score, health or objectives | Labels never become the source of truth |
| Fixed screen-space HUD | Godot CanvasLayer with Control, Unity Screen Space - Overlay canvas or separate Phaser HUD scene | Camera follow and shake leave essential UI fixed |
| Pause menu | Gameplay suspension separate from menu input and animation | Resume consumes its input and returns focus |
| Settings subpanel | Working control, current value, Back target and persistence | No dead-end Settings button or lost focus |
| UI scaling | Existing anchors and containers or logical canvas coordinates | Long text, safe margins and hit targets survive resize |

## Make it look like this game

Working UI can still fail to read as a game. A plain one looks like a debug overlay: dark rectangles of text across the screen. A styled one looks like a web dashboard in the game's colours: each value in a rounded, bordered card with labels spelling out every number. Unless the user specified a look:

- **Start from the genre's layout.** Before drawing anything, write down where games of this genre usually put each value, and follow that unless the user asks otherwise. Use the shared conventions, never a copy of one game. For example:
  - Survivor-style action: XP bar across the full top edge, timer large at top-centre, kills and currency as icon and number at top-right, health as a small bar under the character, weapons as a small row of icons.
  - Platformer: health or lives and collectibles at top-left.
  - Shooter: health and ammo in the bottom corners, crosshair at the centre.
  - Racing: position and lap along the top, speed in a bottom corner.
- **On the screen, not in boxes.** Most HUD values sit directly over the world as an icon and a number with an outline or shadow. Add a backing only where the background makes a value unreadable, and keep it slight. A HUD built from one bordered card per stat reads as a web page.
- **Icons and numbers, few words.** The player learns an icon in seconds; labels such as "Kills", "Level 1", "Not learned" or "Ready" are noise during play. Show locked or unavailable states as dim or empty slots, and ready states with a glow or pulse.
- **Bars and sweeps.** Show health, XP and charge as bars, and ability cooldowns as a radial sweep on the icon. Show low health and danger at the value itself, with colour and motion.
- **Palette and type from the art.** Take a dark base, a light text colour and one or two accents from the project's existing art, and reuse its fonts. Use the same palette on the HUD, pause, upgrade and result screens. Menus may use panels; the in-run HUD rarely needs them.
- **Art makes a HUD look finished.** Shapes drawn in code (Phaser `Graphics`, Godot `StyleBoxFlat`, Unity sliced sprites) produce clean rectangles and outlines, which tend to look like web UI. Prefer existing art. When a convincing HUD needs a few pieces, such as a slot frame, bar end caps or a counter backing, put them on the stage's art list the way the media section says (one `--sheet` for the set) instead of generating them unlisted.
- **Readable over the busiest frame.** Outline or shadow text over gameplay, keep at least 4.5:1 contrast against the background, and stay legible at the smallest target resolution. At 1280x720, text is at least 16 px, body text 20 px, Chinese, Japanese and Korean 18 px, drawn at screen scale outside any world zoom.
- **Transient help.** Show control hints at the start and fade them after a few seconds; keep them in the pause menu. Short-lived numbers and pickups vanish quickly. Tutorial text does not stay on screen.
- **Truthful labels.** A timer, countdown or wave label says what the game actually does.
- **Motion that stays still.** Bars drain with a trailing chunk and changed numbers pop briefly. The HUD never shakes or scrolls with the camera.
- **Judge it against the genre.** Overflow, focus and resolution checks do not show whether it looks like a game. Compare a screenshot of the busiest moment with the layout you wrote down. If a player of that genre would take it for a web page or a debug panel, it is not done.

## Title and start screens

The title screen is the game's cover, and the rules above for a HUD over gameplay do not make one. A title built from code-drawn rectangles, bordered buttons and system-font text reads as a website's landing page, however tidy it is. Unless the user specified a look:

- **Art leads.** Key art (the characters, the world or a striking scene) fills the frame, the logo is the largest element, and the menu is short. Leave out stat bars, footers and repeated taglines; the currency or version can sit small in a corner if it matters.
- **The logo is art, not a label.** Use a logo image, or set the title in a display font the project loads (a bitmap font, or a web font loaded before the scene draws) with outline, shadow or a gradient fill. A title in the default system font looks unfinished.
- **Menu items as text, not boxes.** Three to five items, shown as text. Mark the selection with a cursor, glow, scale or colour change, a short sound and a little motion. No bordered rectangle per item, no web-style arrows or chevrons. Panels belong to sub-screens such as settings and upgrades.
- **Something moves.** Parallax layers, an idle animation on the key art, drifting particles, a slow camera pan or a logo intro. A static screen with static buttons reads as a page.
- **Start from the genre.** Before drawing, write down how title screens of this genre are usually composed. Use the shared conventions, never a copy of one game. For example: an action or anime-style game puts characters at a dynamic angle with a large stylized logo; a cozy game puts a soft illustrated scene with a rounded logo; a pixel roguelike puts a pixel logo over an animated scene with a hard-edged menu.
- **When the art is missing, offer it, do not fake it.** If the project has no logo or key art that can carry the screen and the approved plan did not already list it, put the pieces it needs (logo, title background or key art, perhaps a menu frame) on the stage's art list the way the media section says; key art passes the style reference with `--image`. Until it exists, build the best version from existing art and a display font, and say plainly that the logo is a placeholder. Never present code-drawn boxes and system text as the finished look.
- **Judge it as a cover.** Look at a full-size screenshot next to the composition you wrote down. If it could pass for a website's hero section, it is not done.

## By kind of game

The look rules above assume an action game with a HUD. Adjust them for these cases:

| Game or UI | What changes |
| --- | --- |
| Pixel art | Use the game's pixel font at whole-number multiples of its size, scale the UI layer by whole numbers, and keep outlines hard-edged like the art's. Avoid blurred shadows and smooth gradients. Take colours from the game's own art (or the user's palette, if they set one). |
| Touch and mobile | Make tap targets at least 44 pt. Put frequent actions within thumb reach in the bottom corners, and keep a pause button always visible because there is no Escape key. Respect notches and safe areas, and never hide information behind hover. |
| Dialogue, inventory, shop, quest log | Keep text panels at the bottom or a side, 45–75 characters per line, with generous line height. One press finishes typewriter text and the next advances. A grid shows its selected slot clearly, with a details panel beside it. Leave room for translations that run 30–40 % longer. |
| Card, puzzle, visual novel, strategy | The UI is the play area, so "keep the centre clear" does not apply. Make the current decision the focal point, show cost and outcome before the player confirms, keep standing information in fixed side panels, and animate each state change so cause and effect can be followed. |
| UI in the world (enemy bars, names, "Press E") | Show it only when relevant: damaged enemies, the nearest interactable. Keep it above the target and inside the screen, never over the player. In 3D, face it to the camera and clamp its size with distance. |
| Minimal or in-world HUD (horror, immersive 3D) | Only when the user asks for it: carry information in the world, such as ammo on the weapon or health as a screen tint. Pause and settings stay conventional. |

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

## Three.js and plain web games: UI drawn in the canvas

There is no engine UI, and the game is the whole window: the HTML page holds only the canvas mount, so the HUD, title, pause and settings are drawn in that canvas, not as HTML or CSS around or over it. If the project already has an in-canvas UI layer, extend that.

- Three.js: keep a second scene with an `OrthographicCamera` in screen pixels and render it after the world (`renderer.autoClear = false`, then `renderer.clearDepth()` before the HUD pass). Draw text into a `CanvasTexture` on a plane or `Sprite`, or use the project's text library; redraw a label only when its value changes. Plain canvas: draw the world, then reset the transform (`ctx.setTransform(1, 0, 0, 1, 0, 0)` times the device pixel ratio) and draw the HUD in screen space.
- Hit-test menu items yourself in screen coordinates; block gameplay input while a menu is open.
- Pause through the existing loop owner: keep rendering but skip the simulation. Discard the time that passed while paused (for example, call `clock.getDelta()` once on resume) so physics does not jump. Also pause on `document.visibilitychange` when hidden.
- With pointer lock, the browser exits the lock on Escape and keeps that key to itself. Open the pause menu on `pointerlockchange` when the lock is lost, and request the lock again from the Resume click, which counts as the required user gesture.
- Keep one selected index shared by pointer hover, arrow keys and gamepad, draw the selection visibly, and restore it when a subpanel closes.
- The Gamepad API fires no button events. Poll `navigator.getGamepads()` each frame, act on press edges, and map D-pad and stick to selection moves and the A button to activate.
- Lay the UI out from the canvas size on every resize, inset safe areas, and keep the canvas pixel ratio a separate setting.
- For labels in the world, such as enemy bars and names, project the target with `vector.project(camera)` into the HUD scene's coordinates, and hide a label once its projected `z` exceeds 1, because it is behind the camera.

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
- [ ] A title or start screen is led by key art and a logo that is art or a display font, with menu items as text and a visible, animated selection; it would not pass for a website's hero section.
- [ ] The HUD follows the genre's usual layout, with values on screen as icon and number rather than in labelled cards, and uses the game's palette. In a screenshot of the busiest moment at the smallest target size, the essential values read at a glance and nothing important is covered.
- [ ] Keyboard-only and controller-only navigation and pointer-to-controller switching retain visible focus.
- [ ] Two cycles of pausing and resuming, Back from settings and scene restart neither leak input nor duplicate listeners.
- [ ] Settings persist without resetting progress; applicable verify command above passes.
- [ ] `pixo game playtest --duration 10 --json` can provide supported layout capture. Inspect it, and report navigation and pause observations separately. Unity capture is unsupported, so test at the smallest and largest target resolutions in the Game view or a player.
