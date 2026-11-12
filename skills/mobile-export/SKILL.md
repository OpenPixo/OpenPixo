---
name: mobile-export
en_name: Mobile game export
zh_name: 移动端游戏导出
description: "Prepare an existing Godot or Unity game, or a Phaser game using Capacitor, for Android or iOS, including touch, safe areas, lifecycle and device checks. Not app-store publication or an instruction to add every mobile platform."
zh_description: "为既有 Godot 或 Unity 游戏，或使用 Capacitor 的 Phaser 游戏准备 Android 或 iOS 构建，处理触控、安全区域、生命周期与真机验证；不默认包含商店发布，也不要求加入所有移动平台。"
triggers:
  - Godot Android export
  - Godot iOS export
  - Unity Android build
  - Unity iOS build
  - Phaser mobile game
  - Capacitor game
  - mobile game touch controls
  - game mobile safe area
  - 游戏移动端导出
  - 游戏触屏控制
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# Mobile game export

The requested target, artifact, project conventions, engine and plugin versions, identity and signing workflow take precedence. Follow only the relevant platform branch. A debug device build does not require store assets, a release checklist or a second native platform.

## Quick path

1. Inspect engine and export configuration, or Capacitor configuration, target OS, orientation, renderer, controls and save owner.
2. Check the actual toolchain and templates for that engine version; select debug-device versus release artifact.
3. Build the requested platform with its existing preset or native project, using the matching branch below.
4. Test touch, safe area, backgrounding, resume and persistence on the designated device; record missing hardware or tools.
5. Run `pixo game verify --steps check --json` for Godot or Unity, or `pixo game verify --steps build --json` for Phaser, as a local source and build check, then report native and device evidence separately.

Add `--project <id>` to OpenPixo verification when `PIXO_PROJECT_ID` is absent. Inspect its detected build command: a desktop or web build is not a mobile package.

## Choose the target

| Target | Build path | Host constraint |
| --- | --- | --- |
| Godot Android debug | Matching export templates + configured Android preset → APK | Verify the installed Godot version's Java, SDK and Gradle requirements |
| Godot Android release | Existing signing and preset → requested AAB or APK | Current store requirements are checked at submission time |
| Godot iOS | Export to Xcode, then sign, build and archive | Requires macOS with Xcode; Windows prepares a handoff |
| Unity Android | Android Build Support module + build script or Build Profile → APK or AAB | Hub-installed OpenJDK, SDK and NDK matching the editor; a Windows standalone check is not a mobile build |
| Unity iOS | iOS Build Support module → generated Xcode project, then sign, build and archive | Compile and sign on a Mac with Xcode |
| Phaser + existing Capacitor Android | Web build → cap sync → native build | Keep compatible installed versions of core, CLI, platform and plugins |
| Phaser + Capacitor iOS | Web build and sync → Xcode | Build, sign and test on devices using the Mac |

Preserve package or bundle ID, versioning, permissions and signing identity. Keep private keys, passwords and local SDK paths out of shared files; losing or replacing a release key can prevent updates.

## Godot Android example: 4.3 CLI

Use the configured executable and real preset name. With an existing preset named `Android`:

```powershell
New-Item -ItemType Directory -Force -Path 'build/mobile' | Out-Null
godot --headless --path . --export-debug "Android" "build/mobile/game-debug.apk"
```

Matching export templates and configured SDK paths must already be available. For release, use `--export-release` only after the existing preset's signing settings and package format match the requested extension.

Check [Android export for Godot 4.3](https://docs.godotengine.org/en/4.3/tutorials/export/exporting_for_android.html) or the installed version's documentation. Do not copy SDK and JDK versions from another engine release. Check native extensions, C# and target ABIs separately for compatibility.

Install on the designated test device using the project's existing device workflow. Test a fresh install and intended upgrade; confirm app signature and identity before updating an installed build so progress is not unintentionally lost.

## Unity 6 Android example

If Build Profiles own the scenes and settings, adapt to the selected profile. Otherwise this `Assets/Editor/MobileBuild.cs` makes a debug APK. It is named `BuildAndroid` because OpenPixo's build discovery looks for `Build`, `BuildWindows`, `BuildGame` or `BuildPlayer`, so it does not compete with the desktop entry.

```csharp
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

public static class MobileBuild
{
    public static void BuildAndroid()
    {
        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        if (scenes.Length == 0) throw new BuildFailedException("No enabled build scenes.");
        Directory.CreateDirectory("Builds/Android");
        EditorUserBuildSettings.buildAppBundle = false;
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = scenes, locationPathName = "Builds/Android/game-debug.apk",
            target = BuildTarget.Android, options = BuildOptions.Development,
        });
        if (report.summary.result != BuildResult.Succeeded)
            throw new BuildFailedException("Android build failed: " + report.summary.result);
    }
}
```

With `$unityEditor` set to the configured editor, the Editor closed and the module installed:

```powershell
& $unityEditor -batchmode -quit -projectPath . -buildTarget Android -executeMethod MobileBuild.BuildAndroid -logFile Builds/android.log
adb install -r Builds/Android/game-debug.apk
adb logcat -s Unity
```

- Google Play needs ARM64, so use the IL2CPP backend: Mono cannot target ARM64. Check `PlayerSettings.Android.targetArchitectures`.
- For release, set `buildAppBundle = true` with the existing keystore, and raise `PlayerSettings.Android.bundleVersionCode`. Unity does not keep keystore passwords in the project, so a batch build must supply them from the machine's secret store. Never commit them.
- iOS builds with `BuildTarget.iOS` and writes an Xcode project; `locationPathName` is a folder. Follow the Mac handoff below for team and signing.
- Mobile defaults to 30 FPS unless `Application.targetFrameRate` is set. Decide this on purpose and measure the thermal cost.
- Lifecycle: save and clear held input on `OnApplicationPause(true)`. `OnApplicationQuit` does not fire when the OS kills the process.

## Windows → Mac iOS handoff

[Godot 4.3 iOS export](https://docs.godotengine.org/en/4.3/tutorials/export/exporting_for_ios.html) requires macOS and Xcode. On Windows, complete the source, configuration and touch work. Record engine and template versions, preset intent, bundle ID, native plugins and required signing inputs. Keep secrets out of the handoff.

On the Mac, use the actual preset or native project, confirm the team, capabilities and deployment target. Then build and sign on a device. Simulator success does not prove native plugin or device compatibility. Mark export, archive, signing and device checks pending until performed; a Windows source check does not produce a verified IPA.

## Phaser + installed Capacitor

Use the game's package manager and existing build script. In a pnpm project where Android is already initialized:

```text
pnpm run build
pnpm exec cap sync android
pnpm exec cap open android
```

The existing config's `webDir` must contain the real built `index.html`. Sync copies that output and updates native dependencies; a release should bundle it rather than rely on a development `server.url`. Preserve native projects and plugins.

From the project root, a configured Windows Gradle project can build debug with:

```powershell
& .\android\gradlew.bat -p .\android assembleDebug
```

On the Mac, the analogous installed commands are `pnpm exec cap sync ios` and `pnpm exec cap open ios`. Add a missing platform only when requested. Check the installed major's [Capacitor workflow](https://capacitorjs.com/docs/basics/workflow), native requirements and plugin compatibility.

## Touch, safe areas and lifecycle

| Failure-prone area | Concrete anchor | Acceptance |
| --- | --- | --- |
| Two simultaneous actions | Godot 4.3 `TouchScreenButton.action` or pointer-ID tracking with `InputEventScreenTouch.index` and `InputEventScreenDrag.index`; Unity `OnScreenStick` and `OnScreenButton` feeding existing actions, or `EnhancedTouchSupport.Enable()` with `Touch.activeTouches` and `finger.index` | Move while jumping or attacking with a second finger |
| Stuck action | Clear held pointer IDs and derived actions on release-outside, cancellation, focus loss and background | No continued movement or attack after returning |
| Duplicate action | Inspect touch→mouse emulation and the action layer | One gesture produces one action |
| Godot safe area | `DisplayServer.get_display_safe_area()` returns display-space rectangle | Convert through the actual viewport and stretch transform before UI placement |
| Unity safe area | `Screen.safeArea` is in pixels; set a panel's `anchorMin` and `anchorMax` to `area.min` and `area.max` divided by `Screen.width` and `Screen.height` | Recompute when orientation or resolution changes |
| Canvas safe area | Convert display or CSS insets through Phaser Scale Manager | Drawing and hit targets agree after orientation changes and resizing |
| Native lifecycle | Existing owners of saves, pause and audio plus installed platform callbacks | Backgrounding, locking, interruptions and resume preserve progress and clear input |

For a DOM overlay, enable `viewport-fit=cover` in the page viewport and confirm the WebView exposes safe-area values:

```css
.game-controls {
  padding-top: max(12px, env(safe-area-inset-top, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
  padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
  padding-left: max(12px, env(safe-area-inset-left, 0px));
}
```

CSS on a wrapper does not relocate controls drawn inside a canvas. Recheck notches, browser bars, touch targets and the intended OS Back action. [Godot 4.3 DisplayServer](https://docs.godotengine.org/en/4.3/classes/class_displayserver.html) is the API reference; verify behavior on the actual mobile target.

Save at meaningful checkpoints, not just on termination: the OS may kill without a final callback. Test fonts, audio, assets, storage and native plugins in the device WebView or exported runtime, including audio-focus and rendering-context recovery where relevant.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Copy web source then run the native app | Build and sync the new output; otherwise the device may run stale content |
| Apply physical screen insets directly to logical UI | Convert coordinate spaces before laying out controls |
| Reuse a single touch boolean | Track finger ownership so release of one finger cannot cancel another |
| Freeze store SDK and API versions in this skill | Check current submission rules only when submission is in scope |
| Call desktop capture a device test | Record native install and real multitouch and performance evidence separately |

## Done when

- [ ] Requested artifact exists or the exact blocking requirement for tools, signing or the host is recorded; no secrets appear in the handoff.
- [ ] Relevant real-device input, orientation, safe-area, lifecycle, persistence and upgrade checks are observed or explicitly pending.
- [ ] For performance work, measure sustained play on the lowest target device: frame time, memory and thermal degradation, not only peak FPS.
- [ ] Report the artifact path, app identity, version, ABI, signing status and tested devices. Publication remains within the user's requested scope.
- [ ] Applicable local verify command passes. `pixo game playtest --duration 10 --json` offers supported local Godot or web capture; it has no Unity capture, and it neither installs native packages nor validates mobile thermals.
