---
name: unity-csharp
en_name: Unity 6 C# development
zh_name: Unity 6 C# 开发
description: Implement or debug Unity 6 C# gameplay with the installed Input System, data and assembly conventions and real batch verification; not for other engines or art-only tasks.
zh_description: 按已安装的 Input System、数据与程序集约定实现或修复 Unity 6 C# 玩法，并执行真实批处理验证；不用于其他引擎或纯美术任务。
triggers:
  - Unity 6
  - Unity C# gameplay
  - Unity Input System
  - ScriptableObject
  - Unity assembly definitions
  - Unity batchmode
  - Unity 开发
  - Unity 批处理构建
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - unity
  category: game-development
---

# Unity 6 C# development

Implement or debug Unity 6 gameplay against the installed 6000.x editor and Input System.
Project conventions, installed packages, architecture, render pipeline and explicit user choices take precedence.
Read `ProjectSettings/ProjectVersion.txt`, `Packages/manifest.json`, `Packages/packages-lock.json` and existing scenes, prefabs and assemblies.
A component fix does not require new assemblies, data assets, tests or build entrypoints.

## Quick path

1. Identify the owning component or prefab, editor and package versions, and existing input and physics path.
2. Choose the relevant owner below; preserve serialized references and asset GUIDs.
3. Patch the smallest affected behavior using installed types, with symmetric event cleanup.
4. Run `pixo game verify --steps check,build --json`; inspect actual commands, licensing logs, compile logs and unavailable steps.
5. Run existing focused tests when they expose the changed rule; test the affected flow in the Editor or player where OpenPixo capture is unsupported.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
Configure the installed editor through OpenPixo engine settings; `unity` in a detected command is a tool identifier, not a guessed executable path.

## Choose the owner

| Need | Use or check |
| --- | --- |
| Player input | Installed `com.unity.inputsystem`, existing `.inputactions`, PlayerInput and control scheme |
| Rigidbody movement | Collect input in configured input update path; consume in FixedUpdate |
| CharacterController movement | Project controller integrates displacement and gravity; do not add a competing Rigidbody |
| Save identities | Stable authored IDs and schema versions, not asset names or scene instance IDs |

## Input System in Unity 6

Inspect Active Input Handling and the package update mode before changing input timing.
With PlayerInput, read `playerInput.actions`; multiple players can have private copies.
PlayerInput owns enabling and disabling maps; standalone InputActions need a deliberate lifecycle owner.

Example `Assets/.../TopDownMotor.cs` assumes PlayerInput's default map enables a Vector2 `Gameplay/Move` action, dynamic input updates and an existing 3D Rigidbody:

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(PlayerInput), typeof(Rigidbody))]
public sealed class TopDownMotor : MonoBehaviour
{
    [SerializeField] private float speed = 5f;
    private Rigidbody body;
    private InputAction move;
    private Vector2 desired;

    private void Start()
    {
        body = GetComponent<Rigidbody>();
        move = GetComponent<PlayerInput>().actions.FindAction("Gameplay/Move", true);
    }
    private void Update() =>
        desired = move.enabled ? move.ReadValue<Vector2>() : Vector2.zero;
    private void OnDisable() => desired = Vector2.zero;
    private void FixedUpdate()
    {
        var current = body.linearVelocity;
        body.linearVelocity = new Vector3(desired.x * speed, current.y, desired.y * speed);
    }
}
```

Adapt map names, action names and the motion model; this arcade motor preserves vertical velocity. Force-driven actors should keep their force controller.
Queue a jump edge for the physics tick, consume once, and clear pending and held commands on pause, device loss and teardown.
Persist rebinding overrides separately; keep handling for cancellation and conflicts, plus a usable reset and menu path.
References: [Unity 6 Rigidbody.linearVelocity](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody-linearVelocity.html), [Input System 1.11 PlayerInput](https://docs.unity3d.com/Packages/com.unity.inputsystem@1.11/manual/PlayerInput.html). Select the installed package docs.
## Data, lifecycle and asset identity

- Match MonoBehaviour file and class names and keep required serialized references valid.
- Subscribe in OnEnable and unsubscribe in OnDisable under the same owner.
- Reset static and session state when domain reload is disabled.
- Keep ScriptableObject definitions separate from mutable actor, session and save state; use owned instances only when needed.
- Follow existing `.asmdef` boundaries. UnityEditor belongs in Editor-only assemblies; an Editor folder under a custom runtime assembly is not sufficient by itself.
- Add assembly boundaries only for a real module; avoid cycles and one-assembly-per-component ceremony.
- Keep `.meta` files with assets and preserve GUIDs when moving them. Let Unity generate new metadata.
- Edit source under Assets, Packages and ProjectSettings. Generated files in Library and Temp, and IDE files, are not source fixes.
## OpenPixo verification and builds

The current Unity check is `unity -batchmode -quit -projectPath .`.
It checks editor import and compilation; it does not run Test Framework or launch a captured player.
Avoid concurrent batch and Editor access to a locked project.

Build discovery looks under `Assets/Editor` for one unambiguous public static parameterless
`Build`, `BuildWindows`, `BuildGame` or `BuildPlayer` directly calling `BuildPipeline.BuildPlayer`.
It requires one class and at most one namespace in that file. Discovery searches within four subdirectory levels and 100 C# files.
An existing CI helper outside that shape can still run explicitly; report harness build unavailable instead of inventing a method.

Only when a new Windows build entry is in scope, this `Assets/Editor/GameBuild.cs` follows the contract:

```csharp
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class GameBuild
{
    public static void BuildWindows()
    {
        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        if (scenes.Length == 0) throw new BuildFailedException("No enabled build scenes.");
        var output = Path.GetFullPath(Path.Combine(Application.dataPath, "../Builds/Windows/Game.exe"));
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = scenes, locationPathName = output,
            target = BuildTarget.StandaloneWindows64, options = BuildOptions.None
        });
        if (report.summary.result != BuildResult.Succeeded)
            throw new BuildFailedException("Windows build failed: " + report.summary.result);
    }
}
```

Use the actual target, name, scenes and options. If Build Profiles own scenes and settings, adapt to the selected profile.
Keep one discoverable entry; a failed BuildReport must produce a failing batch result.
## Focused tests and player acceptance

From the game root, with `$unityEditor` set to the configured absolute executable path:

```powershell
New-Item -ItemType Directory -Force -Path .\TestResults | Out-Null
& $unityEditor -batchmode -projectPath . -runTests -testPlatform EditMode -testResults TestResults/EditMode.xml -logFile TestResults/EditMode.log
& $unityEditor -batchmode -projectPath . -runTests -testPlatform PlayMode -testResults TestResults/PlayMode.xml -logFile TestResults/PlayMode.log
```

Run sequentially; omit `-quit` so Test Framework can finish and exit. Add the project's focused test filter when appropriate.
Check exit status, XML totals and failures; empty or missing results are unavailable evidence.
Verify switches against the installed [Test Framework CLI](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html).

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Copy old Input.GetAxis into an Input System project | Use the existing actions; preserve the requested input architecture |
| Shared asset or singleton actions for every local player | Read that PlayerInput's actions and paired devices |
| Multiply assigned velocity by delta | Velocity is units per second; delta belongs to displacement and integration |
| Store actor health or ammo in a shared definition asset | Keep actor and session state independent |
| Lose .meta during move or edit Library to fix source | Preserve GUIDs, source settings and import settings |
| Claim OpenPixo playtest captures Unity | Use separate tests in the Editor or player; Unity run and input capture are unsupported |

## Done when

- [ ] Affected prefabs and scenes compile with valid references and preserved GUIDs.
- [ ] Relevant input, physics, pause, focus and restart behavior pass in the Editor or player.
- [ ] Applicable focused tests have real XML results; missing modules, missing licenses or Editor locks are stated.
- [ ] Inspect `pixo game verify --steps check,build --json`; report unavailable build or capture separately from tests.
