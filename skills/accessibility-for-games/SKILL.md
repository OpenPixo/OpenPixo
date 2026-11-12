---
name: accessibility-for-games
en_name: Game accessibility
zh_name: 游戏无障碍
description: "Fix input, reading, color, motion or difficulty barriers in an existing game. Use for remapping, captions, assists or scalable UI; not a general website accessibility audit."
zh_description: "修复既有游戏中的操作、阅读、辨色、动态效果或难度障碍，适用于重映射、字幕、辅助选项和可缩放 UI；不用于通用网站无障碍审计。"
triggers:
  - game accessibility
  - remappable controls
  - game subtitles
  - colorblind mode
  - reduced motion game
  - difficulty assists
  - 游戏无障碍
  - 按键重映射
  - 游戏字幕
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
---

# Game accessibility

The user's requested barrier, project conventions, engine version and challenge intent take precedence over these defaults. Fix that path first; a single subtitle fix does not require a full accessibility audit.

## Quick path

1. Reproduce the barrier on the affected screen or action; identify its input, UI, feedback or settings owner.
2. Choose the matching row below and add the smallest independently adjustable control.
3. Reuse settings persistence; retain focus while changing values and preserve progress when resetting preferences.
4. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for web.
5. Exercise the original barrier with the relevant device or setting, then restart and check persistence.

OpenPixo commands use `PIXO_PROJECT_ID` in a host run; otherwise add `--project <id>`. Apply only the checks relevant to the change.

## Choose the intervention

| Barrier | Implementation anchor | Observe |
| --- | --- | --- |
| Sustained hold or repeated tapping | Offer a toggle or a single-action alternative in the existing action layer | Release, focus loss and device disconnect clear held state |
| Rebinding | Handle listening, cancellation, conflicts and reset. Save overrides by stable action ID | Keep Confirm and Back available; new binding works after restart |
| Spoken or meaningful audio cue | Use a cue ID, a speaker or event label, and timing from the owner of the sound event | Muted play remains understandable; retry leaves no stuck or duplicate caption |
| Status or team shown only by color | Pair color with shape, icon, pattern or label | Identify the information without color on actual backgrounds |
| Shake, flash or camera motion | Let the effect owner adjust intensity or turn the effect off | Zero removes displacement and strong flashes while hazards remain readable |
| Reading or target size | Adjust font and target sizes; reflow the existing layout | Long text and largest requested scale fit the smallest supported viewport |
| Timing or difficulty | Specific assist such as longer timing windows or lower incoming damage | Make effects on scoring and saves explicit; network authority remains consistent |

Expose new options before the affected gameplay and from pause where useful. An opaque master toggle hides which barrier each setting addresses.

## Error-prone engine boundaries

**Godot 4.3 example:** inside a rebinding capture handler, after checking cancellation and conflicts, replace the selected event only. Here `action` is the existing action name and both events are `InputEvent` values:

```gdscript
InputMap.action_erase_event(action, previous_event)
InputMap.action_add_event(action, replacement_event)
get_viewport().set_input_as_handled()
```

Persist a portable binding representation through the settings owner; InputMap changes alone are session-only. Consume the capture event so it cannot also fire gameplay. Replacing all events would remove the other devices' bindings. See [Godot 4.3 InputMap](https://docs.godotengine.org/en/4.3/classes/class_inputmap.html); use the installed minor version's reference if different.

- Godot 4 UI: `Control` focus neighbors, containers and Theme font sizes provide navigation and reflow; test the project's stretch policy.

**Unity 6 example:** preserve the installed input backend. With Input System, rebind the active player's action instance. The action must be disabled during capture, and the operation must be disposed, including when the menu closes mid-capture:

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

public sealed class RebindButton : MonoBehaviour
{
    private InputActionRebindingExtensions.RebindingOperation operation;
    private InputAction active;

    public void Begin(InputAction action, int bindingIndex)
    {
        Cancel();
        active = action;
        action.Disable();
        operation = action.PerformInteractiveRebinding(bindingIndex)
            .WithCancelingThrough("<Keyboard>/escape")
            .OnMatchWaitForAnother(0.1f)
            .OnComplete(_ => Finish(true))
            .OnCancel(_ => Finish(false))
            .Start();
    }

    private void Finish(bool changed)
    {
        operation.Dispose();
        operation = null;
        active.Enable();
        if (changed) PlayerPrefs.SetString("bindings", active.actionMap.asset.SaveBindingOverridesAsJson());
        active = null;
    }

    private void Cancel() => operation?.Cancel();
    private void OnDisable() => Cancel();
}
```

Replace `PlayerPrefs` with the project's settings owner, and reload at startup with `LoadBindingOverridesFromJson`. Check conflicts in `OnComplete` before saving; Input System does not refuse a duplicate. `bindingIndex` selects one binding, so a keyboard rebind leaves the gamepad binding alone; composites like WASD rebind per part. Keep Confirm and Back reachable.

- Unity UI: `Selectable` navigation with a visible Selected state, and `CanvasScaler` plus layout groups for reflow. Scaling a root `RectTransform` clips content just as a root transform does elsewhere. Reduced motion goes to the shake owner: skip `GenerateImpulse` at zero rather than hiding the camera.
- Phaser 3 or other web games: keep one action mapping layer; preserve normal settings focus and convert canvas pointer coordinates through the existing scale transform.
- Engine UI labels alone do not establish screen-reader support. Check the integration for the project's engine and platform. Test narration before claiming support.

## Text, cues and preferences

- Keep essential text out of baked artwork. Subtitle size, background, speaker labels and placement must survive changing scenery and long translations.
- For reading-time changes, choose player advance, replay or longer display according to the scene. A local menu preference cannot slow only one peer's authoritative online simulation.
- Keep sound and captions independently selectable. Use a single event to schedule each so replay or restart cannot desynchronize them.
- Use semantic controls and accessible names for web menus; verify actual keyboard and screen-reader flow when that is the requested capability.
- For broader design and test guidance: select the relevant [Xbox Accessibility Guidelines](https://learn.microsoft.com/en-us/xbox/accessibility/guidelines), rather than imposing the whole set on every edit.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Global hue filter as the only colorblind option | Change semantic cues and add redundant shapes or labels; a filter cannot recover missing distinctions |
| Root transform as the only UI scale | Reflow text, targets and safe margins; transforms can clip content and misalign hit areas |
| Reset preferences by replacing the save | Update the existing settings section; progress is separate data |
| Auto-focus the first button after every change | Keep the changed control focused so controller navigation remains usable |
| Use a build or screenshot as proof of accessibility | Exercise the requested barrier; layout evidence cannot prove remapping or narration |

## Done when

- [ ] The affected path works with the requested accommodation, including relevant pause, retry and device transitions.
- [ ] Settings remain reachable, survive restart and handle absent or older keys with defaults.
- [ ] Applicable verification above passes; inspect logs and identify checks that were skipped or could not run.
- [ ] Report observed interactions and remaining barriers; claim player feedback only if actually obtained.
- [ ] For layout evidence, use `pixo game playtest --duration 10 --json` on supported Godot or web output. Godot capture does not inject input and Unity capture is unsupported, so check Unity layouts in the Game view at target resolutions.
