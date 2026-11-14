<p align="center">
  <img src="apps/web/public/app-icon.svg" alt="OpenPixo" width="88">
</p>

<h1 align="center">OpenPixo</h1>

<p align="center">
  <b>An open-source workbench that turns coding agents into game developers.</b><br>
  OpenPixo runs Codex, Claude Code or OpenCode on your game project and gives them the tools a coding agent lacks for games:<br>
  engine-aware build and run, scripted playtests, asset pipelines, game-dev skills and a plan-first workflow.
</p>

<p align="center">
  <a href="https://openpixo.com/download"><img alt="Download for Windows" src="https://img.shields.io/badge/download-Windows%2010%20%7C%2011-c4f542?labelColor=141128"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-7c5cff?labelColor=141128"></a>
  <img alt="Node 24" src="https://img.shields.io/badge/node-24-7c5cff?labelColor=141128">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-7c5cff?labelColor=141128">
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#the-pixo-cli">CLI</a> ·
  <a href="#extending-openpixo">Extending</a> ·
  <a href="#development">Development</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center"><img src="docs/readme/openpixo-hero.webp" alt="OpenPixo desktop app: a playtest note and Codex's stage 4 fix on the left, the Phaser game running on the right, last verification passed" width="100%"></p>
<p align="center"><sub><i>Sakura Nightfall</i>, a Phaser game Codex built in five stages inside OpenPixo. The user plays a stage and says what's wrong, the agent fixes it, and <code>pixo game verify</code> must pass before the turn ends.</sub></p>

## What is OpenPixo?

General coding agents can write a game's code, but they can't see the game: they don't know how to build a Godot project, press keys in a running Phaser game, or make a sprite sheet. OpenPixo is a local app and daemon that sits between the agent and your project. It starts the agent CLI you already have, adds game-development context to its prompt, and exposes build, playtest, asset and tuning tools that the agent calls as `pixo` commands mid-task. You work with it in a desktop app; scripts and other agents use the same tools from the CLI.

<p align="center"><img src="docs/readme/openpixo-workflow.webp" alt="Three steps from one project: style samples during planning, the art list waiting for approval, and the frame sheet from a scripted playtest" width="100%"></p>

## Features

**Agent harness**
- Runs **Codex**, **Claude Code** or **OpenCode** from your own install and subscription, or OpenCode with your own API key (BYOK).
- Streams every turn into an execution record: skills used, plan steps, tool calls, files changed, media generated, context usage.
- Steer a running turn, undo a turn's file changes, and resume native agent sessions across turns.

<p align="center"><img src="docs/readme/openpixo-execution-record.webp" alt="Execution record of one Codex turn: skills used, a three-step plan, verify and WASD playtest, and the changed file" width="68%"></p>

**Game loop**
- Detects the engine and derives check, build and run commands for the project.
- `pixo game verify` builds and runs the game and can capture a screenshot.
- `pixo game playtest` plays the build with scripted keyboard and mouse input. Presets cover platformers, WASD, grid clicks, drags, and seeded random input that replays exactly.
- `pixo game tuning` exposes the numbers, flags and colors in Godot scenes and scripts and web JSON data as sliders, with file-hash guards and checkpoints.
- `pixo game export` packs a web game into one HTML file that plays offline.

**Assets**
- 30 recipes: 13 asset recipes (8-direction walk cycles, character turnarounds, seamless tilesets, icon sets, VFX sequences, parallax layers, skyboxes, nine-slice UI, PBR textures, SFX packs, music loops, voice lines, image-to-3D), 10 game starters and 7 feature recipes (saves, settings, dialogue, inventory, gamepad, localization, achievements).
- Recipe output is staged as candidates. You or the agent adopt them explicitly, and every adopted file keeps its provenance: recipe, model, prompt and seed.
- Deterministic image edits for engines: crop, trim, pad to a power of two, nearest-neighbor resize, flip and rotate.

**Guardrails**
- New games are planned before they're built. During planning every runtime is read-only: Codex runs in its `read-only` sandbox, Claude Code loses its edit tools, and OpenCode gets deny rules. Only the user can approve the plan; the route refuses the agent's token.
- The daemon prices every media request itself and reserves it against an art budget only the user sets.

**Automation**
- Every user-facing capability is a `pixo` subcommand with `--json` output and `--prompt-file` input.
- `pixo mcp` runs a stdio MCP server, so agents working in other repositories can use OpenPixo projects.
- Headless runs over REST with your own model provider ([guide](docs/headless-byok.md)).

## Installation

### Windows app

1. Download the installer from **[openpixo.com/download](https://openpixo.com/download)** (Windows 10 or 11, x64).
2. Run it. Updates install themselves after that.
3. On first launch, connect an AI: a Codex, Claude Code or OpenCode CLI you're signed in to, or your own API key. An OpenPixo account for hosted models is optional.

> [!NOTE]
> The installer isn't code-signed yet, so Windows SmartScreen shows "Unknown publisher". Compare the file's SHA256 (`Get-FileHash` in PowerShell) with the value on the [download page](https://openpixo.com/download), then choose **More info → Run anyway**.

### From source

Requirements: Node 24, pnpm 10.33.2, and Visual Studio Build Tools 2022 or newer (`better-sqlite3` compiles from source on Node 24).

```powershell
git clone https://github.com/OpenPixo/OpenPixo.git
cd OpenPixo
pnpm install
pnpm tools-dev                 # daemon + web UI + desktop app, ports picked for you
```

`pnpm tools-dev run web` starts only the daemon and web UI; `pnpm tools-dev --help` lists status, logs and stop. Windows is the release platform. The macOS and Linux tooling still builds but isn't release-tested. Setup problems: [Windows troubleshooting](docs/windows-troubleshooting.md).

## Quick start

1. **Start a game.** Click **New game** and describe it, or open a folder that already contains a game.
2. **Agree on the plan.** The agent confirms gameplay, art style and engine with you, shows style samples, and proposes 3–6 stages. Nothing is written until you approve.
3. **Build and play.** It builds one stage per turn, verifies and playtests it, and tells you how to try it. Use **Run**, **Playtest** and **Tune** in the game panel, or tell it what feels off.

## Supported agents

| Runtime | How OpenPixo drives it | Notes |
| --- | --- | --- |
| Codex | `codex app-server`, JSON-RPC over stdio | Sessions resume across turns; image generation through your ChatGPT sign-in |
| Claude Code | `claude -p` with stream-json input and output | Stdin stays open, so you can steer a running turn |
| OpenCode | OpenCode JSON events | A bundled OpenCode also runs BYOK providers |

Each runtime is a declarative definition in [`apps/daemon/src/runtimes/defs/`](apps/daemon/src/runtimes/defs/). Parsers are tested against recorded sessions from the real CLIs, and [`mocks/`](mocks/README.md) replays those recordings as drop-in fake CLIs. Details: [docs/agent-adapters.md](docs/agent-adapters.md).

## Supported engines

| Engine | Detected from | Check / build / run | Scripted playtest | Starters |
| --- | --- | --- | --- | --- |
| Godot 4 | `project.godot` | Headless import; export when a preset is set; run | ✓ (MovieMaker capture) | 10 |
| Phaser, three.js, plain web | `package.json`, `index.html` | The project's `check`, `build` and `dev` (or `preview`) scripts | ✓ (in-app browser) | 10 (Phaser) |
| Unity | `ProjectSettings/ProjectVersion.txt` | Batch-mode check; build when the project has an editor build method | — | — |
| Bevy | `Cargo.toml` | `cargo check`, `cargo run` | — | — |
| Cocos Creator 3 | `project.json` | CLI build | — | — |
| Unreal, RPG Maker | `.uproject`, `.rmmzproject` | Detected; uses the project's own tooling | — | — |

Engine tools are found on `PATH` or set in Settings.

## Architecture

```mermaid
flowchart TB
  UI["Desktop app<br/>Electron + Next.js"] -- "HTTP + SSE" --> D
  CLI["pixo CLI"] -- "same /api/*" --> D
  MCP["pixo mcp<br/>(stdio MCP server)"] -- HTTP --> D
  D["Daemon (Express)<br/>projects · SQLite · prompts · game tools · recipes"] -- "spawn, stream events" --> A["Codex · Claude Code · OpenCode"]
  A -- "edits files" --> P[("Your game folder")]
  A -. "calls pixo mid-task" .-> CLI
  D -- "build · run · capture" --> P
```

- **One authority.** The local daemon (`apps/daemon`) owns `/api/*`, persistence, agent runs and the game tools. The UI and the CLI call the same endpoints, and their shared types live in [`packages/contracts`](packages/contracts/).
- **Agents call back in.** A spawned agent gets a scoped token and the project id, so it runs `pixo game verify` or `pixo recipe run` from its own shell. Routes that belong to the user, such as approving a plan or a budget, refuse that token.
- **Your files stay put.** Imported games are edited in place. Daemon state lives under one resolved data root ([contract](AGENTS.md#daemon-data-directory-contract)).

More: [Architecture](docs/architecture.md) · [Prompt composition](docs/prompt-composition.md) · [Skills protocol](docs/skills-protocol.md)

## The `pixo` CLI

```powershell
pixo game verify --steps check,build,run --screenshot --json
pixo game playtest --preset runJump --json
pixo game playtest --preset monkey --seed 42 --duration 15
pixo game tuning list --json
pixo game export --out build/my-game.html

pixo recipe list --surface image --engine godot
pixo recipe run tileset-seamless --input material="mossy cobblestone" --wait --json
pixo recipe adopt <runId> --candidate <id>

pixo asset edit <projectId> art/hero.png --trim --pad pot --nearest
pixo asset provenance art/hero.png

pixo mcp templates
pixo --help
```

## Extending OpenPixo

Extensions are plain folders. The daemon also scans a user-writable root, so your copy of an entry overrides the bundled one with the same id.

| Extension | Where | Format |
| --- | --- | --- |
| Skills (31) | [`skills/`](skills/) | `SKILL.md` with frontmatter: triggers, engines, mode. Loaded only when a task needs it. [Protocol](docs/skills-protocol.md) |
| Recipes (30) | [`plugins/_official/recipes/`](plugins/_official/recipes/) | `pixo.json` (`urn:openpixo:plugin:v1`) declaring typed inputs, target engines, post-processing and checks |
| Art styles (20) | [`plugins/_official/styles/`](plugins/_official/styles/) | Data-only style fragments, palette and constraints that a project pins |
| Plugins | [`plugins/`](plugins/README.md) | Installable bundles with marketplace metadata. [Spec](docs/plugins-spec.md) · [Publishing](docs/publishing-a-plugin.md) |
| MCP servers | Settings, `pixo mcp add` | External tools passed to the agent per run |

## Development

```text
apps/
  daemon/      Express daemon and the pixo CLI
  web/         Next.js 16 UI (React 18)
  desktop/     Electron shell
  packaged/    packaged runtime for the Windows installer
packages/
  contracts/   pure TypeScript API contracts and the shared game prompt
  sidecar*/    process identity, IPC and lifecycle shared by all launchers
tools/
  dev/         pnpm tools-dev, the local lifecycle entry point
  pack/        installers, auto-update, packaged smoke tests
skills/  plugins/  mocks/  e2e/
```

```powershell
pnpm guard                              # repository rules
pnpm typecheck
pnpm --filter @openpixo/daemon test     # tests are package-scoped
pnpm tools-pack win build --to nsis     # build the Windows installer
```

Read [AGENTS.md](AGENTS.md) before changing code. It holds the repository's boundaries and conventions for people and coding agents alike, and each layer (`apps/`, `packages/`, `tools/`, `e2e/`) has its own.

## Contributing

Bug reports, ideas and pull requests are welcome in [issues](https://github.com/OpenPixo/OpenPixo/issues). Read [CONTRIBUTING.md](CONTRIBUTING.md) first and open an issue before starting a large feature. Report security problems privately as described in [SECURITY.md](.github/SECURITY.md).

## License

[Apache-2.0](LICENSE). OpenPixo began as a hard fork of another Apache-2.0 project and no longer tracks it ([ADR 0006](docs/adr/0006-full-hard-fork.md)); [NOTICE](NOTICE) and [references](docs/references.md) carry the attribution. Bundled skills and components keep their own licenses.
