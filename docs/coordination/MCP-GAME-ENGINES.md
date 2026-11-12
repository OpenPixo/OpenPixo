# Game-engine MCP presets

Reviewed 2026-10-26 for Phase 1 §3.4. These are community integrations. All three presets use **stdio** and launch an **already installed executable**. Selecting or saving a preset does not install software or launch its server. Dependency checks below are manual checks, also included in each preset's description.

| Preset / repository | License | Last activity observed | Transport and Windows notes | Why chosen |
| --- | --- | --- | --- | --- |
| `godot-mcp` — [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) | [MIT](https://github.com/Coding-Solo/godot-mcp/blob/main/LICENSE) | [History snapshot](https://github.com/Coding-Solo/godot-mcp/commits/main/): 2026-04-16 security fix merged. This is the latest commit visible in the fetched history, not a claim of daily maintenance. | Node stdio; [source](https://github.com/Coding-Solo/godot-mcp/blob/main/src/index.ts) includes Windows executable discovery. Set `GODOT_PATH` to the actual `.exe`; no Godot add-on required. | Established implementation with scene editing, project inspection and engine launch tools; small local setup. |
| `unity-mcp` — [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) | [MIT](https://github.com/CoplayDev/unity-mcp/blob/main/LICENSE) | [Stable history snapshot](https://github.com/CoplayDev/unity-mcp/commits/main/): v10.2.0 merged 2026-09-01; [beta history](https://github.com/CoplayDev/unity-mcp/commits/beta/) shows subsequent maintenance. | Python stdio with `--transport stdio`; local TCP bridge to the Unity package. [Installation docs](https://github.com/CoplayDev/unity-mcp/blob/main/website/docs/getting-started/install.md) explicitly cover Windows. Unity 2021.3 LTS+ and the companion editor package are required. | Widely used editor integration with documented Windows setup and a maintained stdio path alongside HTTP. |
| `blender-mcp` — [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) | [MIT](https://github.com/ahujasid/mcp-for-blender/blob/main/LICENSE) | [PyPI](https://pypi.org/project/mcp-for-blender/): release dated 2026-10-24. | Python stdio; local socket to the Blender add-on. [README](https://github.com/ahujasid/mcp-for-blender/blob/main/README.md) documents Windows, Blender 3.0+, Python 3.10+, and manual add-on installation. New installs use `mcp-for-blender`; the old repository/package name was `blender-mcp`. | Established modeling/material/scene integration with current releases and explicit Windows guidance. |

## Manual setup and dependency checks

- **Godot:** install Godot and the server yourself (`npm install -g @coding-solo/godot-mcp`, as named in the upstream README). Check `node --version`, `where.exe godot-mcp`, and invoke your Godot executable with `--version`. The preset runs `godot-mcp`, wrapped as `cmd /d /c godot-mcp` on Windows for npm's `.cmd` shim. For a source build, set Command to `node` and Args to the absolute `build/index.js` path.
- **Unity:** install Python 3.10+, uv, and Unity; manually run `uv tool install mcpforunityserver`. Check `uv --version` and `where.exe mcp-for-unity`. Add `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#main` in Unity Package Manager. In **Window → MCP for Unity**, select stdio and start the bridge. The preset runs `mcp-for-unity --transport stdio`.
- **Blender:** install Blender 3.0+, Python 3.10+ and uv; manually run `uv tool install mcp-for-blender`. Check `uv --version` and `where.exe mcp-for-blender`. Download the repository's `addon.py`, install/enable it in Blender's add-on preferences, and start its socket server. The preset runs `mcp-for-blender` without the upstream `setup` or `update` installer commands.

On Windows, restart OpenPixo after changing PATH, or enter the executable's full path in the MCP form. Executable discovery does not prove an editor bridge is running; check the editor's connection panel too. Compatibility was checked against upstream documentation/source; no editor session, installer or model/provider call was run for this change.

UI: **Settings → External MCP → Add server → Game engines & 3D**. HTTP: existing `GET` / `PUT /api/mcp/servers`. CLI uses those same endpoints:

```text
pixo mcp templates --category game-engine --json
pixo mcp add --template godot-mcp --env GODOT_PATH=C:/Tools/Godot/Godot.exe --json
```

Media output regression evidence is in `apps/daemon/tests/media/output-paths.test.ts`: six cases failed before the fix and passed after it, covering both project roots, traversal/absolute paths, Windows junctions, and provider extension handling. `tests/mcp-config.test.ts` validates the three presets with the existing server-config sanitizer.
