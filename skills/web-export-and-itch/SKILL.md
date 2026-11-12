---
name: web-export-and-itch
en_name: Web export and itch.io packaging
zh_name: Web 导出与 itch.io 打包
description: Build or debug a Godot 4 or Phaser 3 HTML5 export and package a tested local itch.io-ready ZIP when requested; not for native export or automatic publishing.
en_description: Build or debug portable Godot 4 or Phaser 3 Web output and a requested local HTML5 ZIP; not a native-export or automatic publishing workflow.
zh_description: 构建或修复 Godot 4、Phaser 3 的便携 Web 导出，并按请求打包经过验证的本地 HTML5 ZIP；不用于原生导出或自动发布。
triggers:
  - export game to web
  - itch.io package
  - HTML5 game ZIP
  - 游戏 Web 导出
  - itch.io 打包
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - phaser
  category: game-development
---

# Web export and itch.io packaging

Prepare and test a local HTML5 build or ZIP from an existing Godot 4 or Phaser 3 game.
Project conventions, installed versions, architecture, export settings and explicit user choices take precedence.
Apply only the requested branch: a broken asset URL does not require new release documentation or a full export redesign.
Reuse existing authorization for an upload or page change; a local packaging request alone does not authorize publication.

## Quick path

1. Inspect the actual engine and version, build scripts and presets, target browsers, and controls in embedded and fullscreen modes.
2. Choose the export path below; preserve the current package manager, toolchain and source assets.
3. Build into a fresh project-owned directory; confirm the detected build actually targets Web.
4. Serve the built output over HTTP and reproduce the requested behavior under a nested URL prefix.
5. If a ZIP is requested, archive export contents with root `index.html`, then test an extracted copy.
6. Run `pixo game verify --steps check,build,run --screenshot --json`; inspect logs and skipped steps. Distinguish harness smoke coverage from the exported-ZIP test.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.

## Choose an export path

| Project or requirement | Choose | Verify before claiming ready |
| --- | --- | --- |
| Godot 4 GDScript Web | Exact-version templates + Web preset + Compatibility renderer | Browser renderer and shader support; complete export with HTML, JS, WASM and PCK files |
| Godot single-thread | Prefer when supported and adequate | Installed minor's Web export options and audio behavior |
| Godot threads | Only when the project needs them and host supports them | Actual cross-origin isolation and SharedArrayBuffer headers |
| Godot C# or native extension | Check the installed release's Web export support | Required code and runtime compile for that target |
| Phaser 3 + Vite | Existing build script with portable base and asset paths | Built output under subpath, not just the dev server |
| Existing ZIP, one hosting bug | Fix or rebuild only the affected input, path or configuration | Same extracted artifact and host conditions |

A native build or a dev-server preview is not evidence of a working Web export.

## Godot 4 anchors

Read `project.godot` and `export_presets.cfg`. Keep existing native presets and select the intended Web preset.
Matching export templates must be installed; missing templates are a blocker, not permission to substitute another engine version.
Godot 4 Web rendering uses Compatibility; inspect renderer-dependent effects before switching an existing project.
Single-thread support and options depend on minor version; threaded exports require host support for isolation.

For a configured preset named Web, with `$godotEditor` set to the configured executable:

```powershell
New-Item -ItemType Directory -Force -Path .\build\web | Out-Null
& $godotEditor --headless --path . --export-release "Web" "build/web/index.html"
```

Keep all generated side files together. Renaming only HTML, WASM or PCK files can break loader references.
Inspect the actual `pixo game verify` build command and output: detection may choose another preset or a debug export.

- Start music through an explicit player gesture and the current audio owner; test a fresh browser session.
- Do not free a scene-owned music player while expecting it to continue; persistent music needs persistent ownership.
- Use the game's `user://` storage adapter and test embedded-browser persistence and failure feedback.
- On blur, pause and resume, clear stale held input so movement does not stick.
- Verify current limitations and options in the installed version's [Godot Web export docs](https://docs.godotengine.org/en/4.3/tutorials/export/exporting_for_web.html).

## Phaser 3 with Vite

Read the existing Vite config and build script.
`base: './'` in Vite config or the existing `vite build --base ./` makes bundled references portable.
Keep bundler-imported asset URLs as returned; public files omit `public/` in their served URL.

```ts
// preload(), for public/assets/coin.png:
const assetUrl = (file: string): string =>
  new URL('./assets/' + file, document.baseURI).href;
this.load.image('coin', assetUrl('coin.png'));
```

Reuse the project's relative URL scheme; root-absolute `/assets/...` ignores a host's nested prefix.
Confirm file name case from the built output; Windows may hide case errors that hosting exposes.
Use the project's preview or static server for `dist`, not the dev server, and test a nested prefix where possible.
For iframe sizing, `Phaser.Scale.FIT` and `Phaser.Scale.CENTER_BOTH` preserve logical coordinates; resize-aware games may instead need their current RESIZE path.
Test supported keyboard, pointer, touch and gamepad input, first-gesture audio, reconnection and focus behavior.
Reference: [Vite public assets and base](https://vite.dev/guide/assets.html); use the installed Vite version's options.

## ZIP construction and inspection, when requested

Archive the export directory's contents, with `index.html` at archive root.
For a fresh Phaser `dist`, choose an unused artifact filename:

```powershell
New-Item -ItemType Directory -Force -Path .\releases | Out-Null
Compress-Archive -Path .\dist\* -DestinationPath .\releases\web-build.zip
Add-Type -AssemblyName System.IO.Compression.FileSystem
$webZip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path .\releases\web-build.zip).Path)
try { $webZip.Entries.FullName } finally { $webZip.Dispose() }
```

For Godot, archive `build/web/*` instead. Confirm no enclosing `dist/` or `web/` folder.
Include every referenced runtime file and required credits and licenses; exclude credentials, development saves, caches and unintended source.
PowerShell Compress-Archive can omit hidden files; check the runtime inventory if the project needs them.
Extract into a fresh test directory and serve that copy over HTTP. A `file://` load does not exercise normal hosted behavior.
Record the actual artifact, version and tested browsers; an asset-path-only request can finish without creating a ZIP.

## Browser acceptance and host handoff

| Case | Required observation when applicable |
| --- | --- |
| Fresh load | No game-resource 404s, missing imports or console exceptions |
| Start and audio | Gesture unlock works in a fresh browser; mute remains effective |
| Iframe and fullscreen | Canvas and text fit; focus, controls and exit remain usable |
| Pause, restart and focus return | No held-key movement, duplicate music or callbacks |
| Save and reload | Progress and settings follow the intended origin and storage behavior; failures recover |
| Threads and compression | Real host headers, isolation and file serving match export requirements |
| Packaged delivery | Extracted ZIP reproduces the tested built-output behavior |

For itch.io, use the current [HTML5 game upload guide](https://itch.io/docs/creators/html5).
Provide the local ZIP and describe the intended HTML and browser mode, viewport, fullscreen behavior and controls.
Verify current page and host settings when performing an authorized upload; local tests cannot establish remote headers or published-page behavior.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Verify only the dev server | Serve built or extracted output; dev routing can hide omissions |
| Wrap the build directory in the ZIP | Root index.html with its sibling runtime files |
| Fix one preload URL while Vite base is absolute | Inspect both bundled and public resource references under the real prefix |
| Enable threads assuming every iframe supports isolation | Test current host headers and browser behavior |
| Use one screenshot for audio or save acceptance | Perform gesture and listening checks, plus reload round trips |
| Treat skipped Godot build as a successful Web export | Name the missing preset or templates and actual output target |

## Done when

- [ ] Requested build or path fix works in the built output at the target URL prefix and viewport.
- [ ] If requested, ZIP root, index and runtime inventory are inspected. An extracted copy is tested over HTTP.
- [ ] Applicable input, audio, focus, save cases and host requirements have evidence.
- [ ] Use `pixo game run <projectId> --json` for harness interaction where useful; separately report the exported-artifact test and untested remote behavior.
- [ ] Inspect `pixo game verify --steps check,build,run --screenshot --json`; report skipped checks and whether it ran dev or export output.
