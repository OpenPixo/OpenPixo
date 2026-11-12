# OpenPixo Phase 1：游戏 Harness 实施规格

状态：已实现（未提交），2026-10-26。切片 1–6 已落地；未完成：Godot `--write-movie` Windows 探针、执行记录内截图卡片、真实 Agent run 验收（§6 第 2 条）。所属版本 v0.2。上游：路线文档 §4 Phase 1 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`)、范围 · 后续版本 (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`)。

> 提示词实现说明：§2 的接缝表和 §3.2 保留 2026-10-26 的实施方案快照，已由 [ADR 0012](../../docs/adr/0012-slim-core.md) 的统一游戏提示词边界取代。当前入口是 `packages/contracts/src/prompts/openpixo-game.ts` 和 `apps/daemon/src/game/prompt.ts`；共享媒体文案在 `packages/contracts/src/prompts/media-contract.ts`。后续改动遵循 [提示词组合契约](../../docs/prompt-composition.md)。

改动提示词前必须先读 [docs/prompt-composition.md](../../docs/prompt-composition.md) 和根 `AGENTS.md` 的 "Prompt composition"。每项用户能力都要 HTTP + UI + `pixo` 同一改动落地。

## 1. 目标

让 Agent 在游戏项目里像熟悉这个项目的工程师一样工作：知道引擎和构建方式，能在同一个 run 里生成素材、放到正确目录并在代码里引用，改完能自己构建、运行并截图检查。

不在本阶段：多运行时注入（Phase 2）、素材索引（Phase 3）、配方（Phase 4）、引擎自动安装、内置引擎编辑器。

## 2. 现状与接缝

| 接缝 | 现状 | 本阶段动作 |
| --- | --- | --- |
| `apps/daemon/src/prompts/system.ts:944` | `metadata.baseDir` 存在时直接返回 `composeOpenPixoGamePrompt`，跳过下方所有块，包括 `renderMediaGenerationContract`（同文件 1435 行） | 游戏路径自行拼入媒体合同、引擎画像、验证规则 |
| `packages/contracts/src/prompts/system.ts:320` | API/BYOK 镜像，同样的提前返回 | 同步修改 |
| `packages/contracts/src/prompts/openpixo-game.ts` | 一段通用规则，参数里没有引擎和媒体信息 | 拆成分块组合函数 |
| `apps/daemon/src/prompts/media-contract.ts:118` | `renderMediaGenerationContract(mediaExecution, byokMediaDefaults)`；文案面向设计项目（如「新建一个图片项目再试」「OpenPixo 自己的问题」） | 新增游戏变体文案，不复用设计项目的回复句 |
| `pixo media generate --output <filename>` | 写入项目内，是否允许子目录未核实 | 核实并保证可写入 `assets/icons/sword.png` 这类项目内相对路径，拒绝越界 |
| `plugins/_official/atoms/build-test` | 只覆盖 next/vite/remix | 不扩展这个 atom，新做引擎感知的验证命令 |
| `apps/daemon/src/mcp-config.ts:567` `MCP_TEMPLATES` | 以设计/图像类为主，已有 `higgsfield-openclaw`、`fal-ai` | 新增 `game-engine` 分类条目 |
| `/api/import/folder`（`import-export-routes.ts:367`） | 受信任的目录导入流程，写 `metadata.baseDir` | 新建游戏项目复用这条流程 |

## 3. 设计

### 3.1 引擎画像 `EngineProfile`

契约放在新文件 `packages/contracts/src/api/game-project.ts`：

```ts
export type GameEngineId =
  | 'godot' | 'unity' | 'unreal' | 'phaser' | 'threejs'
  | 'cocos-creator' | 'bevy' | 'rpg-maker' | 'web-generic' | 'unknown';

export interface EngineCommand {
  /** argv[0] is a logical tool id ('godot', 'unity', 'npm', 'cargo'); resolved at execution time. */
  argv: string[];
  /** Project-relative working directory. */
  cwd: string;
  timeoutMs: number;
}

export interface EngineProfile {
  detectorVersion: number;
  engine: GameEngineId;
  engineVersion?: string;
  confidence: 'certain' | 'likely' | 'unknown';
  /** Project-relative files that justified the result. */
  evidence: string[];
  languages: string[];
  /** Project-relative asset roots in priority order. */
  assetRoots: string[];
  importMetadata: 'unity-meta' | 'godot-import' | 'none';
  commands: {
    check?: EngineCommand;   // fastest static/headless check
    build?: EngineCommand;
    run?: EngineCommand;     // used for screenshots
  };
  /** Logical tool ids the commands need, with resolution state. */
  tools: Array<{ id: string; resolved: boolean; source?: 'settings' | 'path' }>;
  detectedAt: number;
}
```

检测规则（`apps/daemon/src/game/engine-detect.ts`，纯函数读取项目文件，不执行任何命令）：

| 引擎 | 证据 | 版本来源 | 默认素材根 | check / build / run |
| --- | --- | --- | --- | --- |
| Godot 4 | `project.godot` | `config/features` | 项目根（排除 `.godot/`） | `godot --headless --path . --check-only --quit` 或 `--import`；build 需 `export_presets.cfg`；run 见 3.3 |
| Godot 3 | `project.godot` 且无 `config_version=5` | 同上 | 同上 | 只做 check，标 `likely` |
| Unity | `ProjectSettings/ProjectVersion.txt` + `Assets/` | `m_EditorVersion` | `Assets/` | `unity -batchmode -quit -projectPath .`（编译检查）；build/run 不在 v0.2 |
| Unreal | `*.uproject` | `EngineAssociation` | `Content/` | v0.2 只识别，不提供命令 |
| Phaser | `package.json` 依赖 `phaser` | 依赖版本 | `public/`、`assets/`、`src/assets/` | `npm run build`（存在时）；run 用 `dev`/`preview` 脚本 |
| Three.js | 依赖 `three` | 依赖版本 | 同上 | 同上 |
| Cocos Creator | `project.json` 含 `creator` 或 `settings/project.json` | 字段 | `assets/` | 只识别 |
| Bevy | `Cargo.toml` 依赖 `bevy` | 依赖版本 | `assets/` | `cargo check`；run `cargo run` |
| RPG Maker MZ/MV | `game.rmmzproject` / `Game.rpgproject` | — | `img/`、`audio/` | 只识别 |
| 其他 Web | `package.json` + `index.html` | — | 同 Phaser | 同 Phaser |

包管理器按锁文件推断（`pnpm-lock.yaml` → `pnpm`）。多个证据冲突时取 `confidence: 'likely'` 并在 `evidence` 列出全部。

工具路径：设置里新增「游戏引擎」分区，可填 Godot / Unity 可执行文件路径，存 app-config；未填时用 `runtimes/executables.ts` 的 `resolveOnPath`。不自动下载或安装引擎。

存储：画像是派生数据，写在项目 metadata 的 `engineProfile` 字段，只由 daemon 写入；客户端 PATCH 携带该字段一律拒绝（与 `baseDir` 同等对待）。`detectorVersion` 变化或用户点「重新检测」时重算。

接口：

- `GET /api/projects/:id/engine` → `{ profile: EngineProfile }`
- `POST /api/projects/:id/engine/refresh` → `{ profile }`
- `pixo project engine <projectId> [--refresh] [--json]`
- UI：项目顶部显示引擎徽标（引擎名 + 版本 + 置信度），点击看证据和工具解析状态，缺工具时链接到设置。

### 3.2 游戏提示词组合

`composeOpenPixoGamePrompt` 改为按块组合，块顺序固定：

1. 基础规则（现有内容，去掉与下面重复的句子）
2. 引擎画像块：引擎、版本、素材根、导入元数据规则（Unity 移动素材要带 `.meta`，Godot 带 `.import`）、可用的 check/build 命令
3. 游戏素材生成块：媒体合同的游戏变体（见下）
4. 验证规则块：改动后优先运行 `pixo game verify`；无法运行时说明原因，不声称已验证
5. 运行时规划工具、记忆、用户/项目指令、启用的 skill 和插件（现有）
6. `COMMENT_IDENTITY_EDIT_DIRECTIVE`（现有）

输入新增 `engineProfile?: EngineProfile` 和 `mediaContractBlock?: string`。媒体合同由调用方渲染后传入：daemon 侧用 `apps/daemon/src/prompts/media-contract.ts`，contracts 侧用 `packages/contracts/src/prompts/media-contract.ts` 镜像，避免 contracts 依赖 daemon。

媒体合同游戏变体（新增 `renderGameMediaGenerationContract`，两侧各一份，用现有 drift 测试方式保持同步）：

- 保留调度器调用方式、模型白名单、`media wait` 轮询、禁止伪造产物等硬规则。
- 输出路径：必须用 `--output` 写到引擎画像的素材根内，按项目现有目录约定命名；不得写到项目外。
- 生成后要在代码或场景里真正引用新文件，并在总结里列出路径。
- 失败回复句改成游戏语境，不提「新建图片项目」，也不出现 OpenPixo 品牌。
- `mediaExecution.mode === 'disabled'` 时沿用禁用语义。

`docs/prompt-composition.md` 同步：在「The one thing to know first」写明第三条路径和它的位置；在 host runtime contract 表里加一列「game path」，标出媒体合同、`<question-form>` 等契约在游戏路径上的来源。

### 3.3 验证循环 `pixo game verify`

执行位置是关键约束：

- **由 Agent 调用时**，命令在 `pixo` CLI 进程内执行。CLI 是 Agent 的子进程，因此仍受运行时沙箱和审批约束。daemon 只负责提供画像和登记结果，**不得**替 Agent 在沙箱外执行项目脚本。
- **由用户在 UI 点击时**，daemon 执行同样的命令，点击本身即授权。

命令只来自 `EngineProfile.commands`，参数不由模型自由拼接；用户可在设置里覆盖某个项目的命令。

流程：解析工具 → 依次执行 check → build（可选）→ run+截图（可选）→ 汇总。

截图方式：

| 引擎 | 方式 | v0.2 状态 |
| --- | --- | --- |
| Web（Phaser/Three/其他） | 启动 `run` 命令得到本地 URL，交给桌面宿主用隐藏的 Electron 窗口加载并 `capturePage`，等待 `canvas` 出现后延时 N 毫秒。daemon 没有 Playwright 依赖（`apps/daemon/src/browser/` 只负责打开链接），所以截图能力经 `routes/host-tools.ts` 的宿主边界提供；无桌面宿主（纯 CLI/无头 daemon）时截图步骤返回 `unavailable` | 必做 |
| Godot 4 | `godot --path . --write-movie <png> --fixed-fps 30 --quit-after <frames>` 取最后一帧；需要有显示环境 | 必做，先验证 Windows 可行性 |
| Bevy | 不截图，只 check | — |
| Unity | 只编译检查 | — |

结果契约：

```ts
export interface GameVerifyResult {
  status: 'passed' | 'failed' | 'unavailable';
  steps: Array<{
    name: 'check' | 'build' | 'run';
    argv: string[];
    exitCode: number | null;
    durationMs: number;
    logRef: string;          // opaque id, fetch via API
    timedOut: boolean;
  }>;
  screenshots: Array<{ ref: string; width: number; height: number }>;
  missingTools: string[];
}
```

日志和截图存放在 daemon 数据根下的运行产物区（遵守根 `AGENTS.md` 的数据目录约定），**不写进用户的游戏目录**。日志截断上限沿用 build-test 的 1 MiB。

接口：

- `POST /api/projects/:id/game/verify` `{ steps?: ('check'|'build'|'run')[], screenshot?: boolean, runId?: string }` → `GameVerifyResult`
- `GET /api/projects/:id/game/verify/:ref`（日志或截图）
- `pixo game verify [--project <id>] [--steps check,build,run] [--screenshot] [--json]`，`PIXO_PROJECT_ID` 自动解析
- UI：项目工具栏「验证」按钮和结果抽屉；run 内调用时，截图作为执行记录里的产物显示

截图回灌：`pixo game verify --json` 输出截图的绝对路径（位于 daemon 产物区，已在运行允许目录内）。提示词要求支持图像输入的运行时读取截图再判断。不支持的运行时只依据退出码。

### 3.4 引擎 MCP 精选

在 `MCP_TEMPLATES` 增加 `category: 'game-engine'`，首批候选（入选前逐个核实许可证、维护状态、Windows 可用性和传输方式）：

- Godot MCP（社区实现，stdio，需本机 Godot）
- Unity MCP（社区实现，需在 Unity 项目里装配套包）
- Blender MCP（stdio，需本机 Blender 和插件）

每条写清依赖检测项和安装引导，沿用现有 MCP 边界：只做配置、依赖检测和引导，不自动安装引擎或编辑器插件。

### 3.5 从模板新建游戏项目

模板放在新的顶层目录 `game-templates/<id>/`（`template.json` + 文件树），首批：

| id | 内容 | 必须通过 |
| --- | --- | --- |
| `phaser3-vite` | Phaser 3 + Vite + TypeScript，一个场景、一个精灵、键盘输入 | `pnpm install && pnpm build`；run 可截图 |
| `godot4-2d` | Godot 4 2D，标题画面、设置、手柄与改键、`user://` 存档、字符串表，加一个可移动的角色 | `--headless --import --quit`；设置 `PIXO_TEST_GODOT` 后，`apps/daemon/tests/game/templates-godot.test.ts` 用真实引擎走一遍 |
| `godot4-3d` | 同上，加相机、光照和一个可移动的方块 | 同上 |
| `threejs-vite` | Three.js + Vite + TypeScript | 同 Phaser |

创建流程：用户在原生对话框选择**父目录**和项目名 → daemon 复制模板到 `<父目录>/<项目名>`（目标已存在则拒绝）→ 走与 `/api/import/folder` 相同的受信任导入逻辑登记为导入项目。游戏项目因此都位于用户选择的位置，引擎可以直接打开，提示词也只有 `baseDir` 一条路径。

- `POST /api/projects/game-from-template` `{ templateId, parentDir, name }`，与目录导入使用同样的桌面授权校验
- `pixo project create-game --template <id> --dir <父目录绝对路径> --name <名称> [--json]`
- `GET /api/game-templates` / `pixo project game-templates [--json]`
- UI：首页「新建游戏」卡片 → 模板选择 → 目录选择

`pnpm guard` 目前只对 `tools/` 下的顶层条目设白名单，新增顶层 `game-templates/` 不需要改 guard；模板里的 `.js` 文件需要按 guard 的 TypeScript 规则处理（模板尽量用 TS，Godot 模板只含 GDScript）。打包时把 `game-templates/` 加进随包资源。

## 4. 实施切片

按顺序，每片独立可合并：

1. **契约与检测**：`game-project.ts` 契约、`engine-detect.ts`、metadata 字段与只读保护、HTTP、CLI、项目徽标。
2. **提示词组合**：分块函数、游戏媒体合同（两侧）、`--output` 子目录核实与修正、`prompt-composition.md` 更新。
3. **验证命令**：CLI 内执行与 daemon 执行两条路径、结果契约、日志/截图存储、UI 按钮与抽屉。
4. **截图**：Web 截图，然后是 Godot `--write-movie`。
5. **模板与新建流程**。
6. **引擎 MCP 条目**。

## 5. 测试

- `apps/daemon/tests/game/engine-detect.test.ts`：每种引擎一个最小夹具目录（放 `apps/daemon/tests/fixtures/game-projects/`），覆盖冲突证据、缺工具和 Godot 3/4 区分。
- 提示词：游戏路径的 compose 输出必须含媒体合同游戏变体、引擎块、验证块；daemon 与 contracts 两侧做一致性断言；`mediaExecution.mode === 'disabled'` 时断言禁用文案。
- `--output` 路径：项目内子目录可写；`../`、绝对路径、符号链接越界都拒绝。
- verify：用假的 godot/npm 可执行文件（PATH 覆盖）测退出码、超时、缺工具；断言 daemon 路径从不在 Agent 调用时执行命令（CLI 带 tool token 时走本地执行分支）。
- metadata：客户端 PATCH `engineProfile` 被拒绝。
- e2e（`e2e/tests/openpixo/`）：用 `phaser3-vite` 模板新建项目 → 检测 → verify 截图，全程不调用模型。

## 6. 验收

在夹具项目上（真实游戏指定后再做正式验收）：

1. 导入或新建一个 Phaser 项目和一个 Godot 4 项目，徽标显示正确的引擎和版本。
2. 一次真实 Agent run（需用户批准用量）里，Agent 修改代码、调用 `pixo media generate` 生成一张图标并写入素材根、在代码里引用它，再运行 `pixo game verify --screenshot`，截图里能看到图标。
3. 对 Godot 项目，`pixo game verify` 的 check 步骤在缺 Godot 时返回 `unavailable` 和 `missingTools: ['godot']`，配置路径后通过。
4. `pnpm guard`、`pnpm typecheck` 和上述聚焦测试通过。

## 7. 开放问题

- Godot `--write-movie` 在 Windows 上无窗口运行的可行性，需要先做探针。
- Unity 编译检查耗时很长（首次导入可能数分钟），超时默认值待真实项目测量。
- 游戏变体媒体合同里，图像和音频的默认输出目录是否按引擎细分，待真实游戏确定。
- Web 截图依赖桌面宿主；以后若要在无头环境截图，再评估是否引入 Playwright。
