# OpenPixo Phase 3：素材索引与处理实施规格

状态：草案，2026-10-25。未开工。所属版本 v0.2。上游：路线文档 §4 Phase 3 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`)。约束：[ADR 0003](../../docs/adr/0003-project-folder-is-source-of-truth.md)，游戏目录是素材的唯一真相，索引和缩略图只是派生数据。

> 历史实施草案：下文的现状、Library 关联和 SQL 记录最初方案，不是当前实现合同。Batch 9 已删除全局 Library；项目素材独立使用 `apps/daemon/src/assets/indexer.ts`、`apps/daemon/src/assets/store.ts` 和 `apps/daemon/src/assets/provenance-store.ts`，不依赖 Library 注册表。当前模块与交付证据见项目地图 (openpixo-internal: `docs/PROJECT-MAP.zh-CN.md`)和 [SLIM-CORE](../../docs/coordination/SLIM-CORE.md)。

## 1. 目标

1. 在万级文件的游戏项目里，快速浏览、筛选、打标签，看懂精灵图、图集和引擎元数据。
2. 每个生成或处理出来的素材都能查到来历：哪条 prompt、哪个模型、哪些参考图、哪个 run。
3. 常用处理（切图、打图集、像素化、去背景、音频规整）由确定性命令完成，Agent 只负责编排，不再临场拼 FFmpeg 命令。

不在本阶段：AI 自动打标签/描述（预留字段），完整图像或音频编辑器，云端素材库。

## 2. 现状与接缝

| 接缝 | 现状 | 结论 |
| --- | --- | --- |
| `GameAssetsPanel.tsx`（137 行） | 对项目文件列表做名称/类型过滤，多选加入对话 | 重写为素材库视图 |
| `packages/contracts/src/api/game-assets.ts` | `filterProjectAssets` 纯函数，UI 与 `pixo project assets` 共用 | 保留为兼容层 |
| `pixo project assets <id> [--kind] [--query] [--json]`（`cli.ts` 约 7620 行） | 已有 | 保留，作为 `pixo asset list` 的别名 |
| OpenPixo Library（`library.ts`、`library-store.ts`） | `library_assets` 以 `UNIQUE(content_hash)` 全局去重，支持 `storage: 'referenced'` | **不能直接做项目索引**：同一张图在项目里出现在两个路径会被折叠成一行，而游戏素材以路径为身份。新增按路径的项目索引表，可选关联 Library 行 |
| `project-watchers.ts` | 按项目引用计数的 chokidar 监听，事件 `add/change/unlink` | 用于增量更新 |
| `project-ignored-dirs.ts` | 忽略 `node_modules`、`build`、`dist` 等 | 补充引擎缓存目录（见 3.2） |
| FFmpeg | `@ffmpeg-installer/ffmpeg` 随包，`HYPERFRAMES_FFMPEG_PATH` 可覆盖 | 音频、视频处理和缩略图复用 |
| 图像库 | daemon 依赖里没有图像处理库 | 需要引入（见 3.5） |
| `skills/game-assets-batch` | 规范完善（保留原件、派生路径、逐项报告），但完全靠 Agent 拼命令 | 改为调用 `pixo asset` |

## 3. 设计

### 3.1 数据模型

新表放在 daemon SQLite（`library-store.ts` 同一数据库，建表方式一致）：

```sql
CREATE TABLE IF NOT EXISTS project_assets (
  project_id TEXT NOT NULL,
  rel_path TEXT NOT NULL,           -- POSIX separators, relative to project root
  kind TEXT NOT NULL,               -- image | audio | video | model3d | font | data | other
  mime TEXT,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  content_hash TEXT,                -- sha256, filled lazily
  width INTEGER, height INTEGER,
  duration_ms INTEGER,
  semantics_json TEXT,              -- sprite sheet / atlas / nine-slice / tileset / loop info
  engine_meta_json TEXT,            -- paired .meta / .import facts
  tags_json TEXT,                   -- user tags
  library_asset_id TEXT,            -- optional link into library_assets
  indexed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_project_assets_hash ON project_assets(project_id, content_hash);

CREATE TABLE IF NOT EXISTS asset_provenance (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  rel_path TEXT NOT NULL,           -- path at creation time
  content_hash TEXT NOT NULL,       -- survives renames: re-link by hash
  origin TEXT NOT NULL,             -- generated | processed | imported
  run_id TEXT, media_task_id TEXT, recipe_run_id TEXT,
  provider TEXT, model TEXT,
  prompt_text TEXT,
  params_json TEXT,
  reference_hashes_json TEXT,       -- input/reference asset hashes
  parent_hashes_json TEXT,          -- for processed: source asset hashes
  seed TEXT,
  cost_json TEXT,                   -- { credits?: number } from v0.3; null for BYOK
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_provenance_hash ON asset_provenance(project_id, content_hash);
```

素材被移动或重命名后，按 `content_hash` 重新关联来源记录；被修改后，旧记录保留，素材视图显示「已修改，来源仅供参考」。

契约（`packages/contracts/src/api/project-assets.ts`）：`ProjectAsset`、`AssetSemantics`、`EngineAssetMeta`、`AssetProvenance`、`AssetListQuery`、`AssetListResponse`（带游标分页）。

### 3.2 索引器

- 模块：`apps/daemon/src/assets/indexer.ts`。
- 首次打开项目时全量扫描，只读 `stat`，不读文件内容；尺寸和时长在后台按预算补齐（每批 N 个文件，空闲时运行）。哈希也是后台补齐；对 provenance 关联、去重和缩略图键需要的文件优先计算。
- 增量：订阅 `project-watchers.ts`，`add/change` 重新 stat，`unlink` 删行（来源记录不删）。
- 额外忽略目录：Unity `Library/`、`Temp/`、`Logs/`、`obj/`；Godot `.godot/`；Unreal `Intermediate/`、`Saved/`、`DerivedDataCache/`。按 Phase 1 的引擎画像生效，不改全局 `IGNORED_PROJECT_DIR_NAMES`，以免影响非游戏项目。引擎画像只看项目根，所以另有一条在任意深度生效的标记判定（`project-ignored-dirs.ts` 的 `isEngineCacheDirName`）：缓存目录名与引擎工程标记（Unity `ProjectSettings/`+`Assets/`、Godot `project.godot`、Unreal `*.uproject`）同在一个父目录时才忽略。项目文件列表、文件夹列表、打包下载和文件监听同样走这条判定，嵌在子目录里的 Unity 工程不会把 `Library/` 交给每次列表遍历。
- 性能预算：1 万文件的项目首次列表 < 2 s（不含后台补齐）；单次增量事件 < 50 ms；后台补齐占用不超过一个 CPU 核心。

### 3.3 缩略图与预览

- 缓存位置：daemon 数据根下的缩略图缓存目录（由 `RUNTIME_DATA_DIR` 派生，遵守根 `AGENTS.md` 的数据目录约定），键为 `content_hash + 尺寸档`，与项目无关，可在项目间共享。
- 图片：256 px 和 1024 px 两档 WebP。像素风素材（小于 128 px 或调色板颜色少）用最近邻缩放，避免糊掉。
- 音频：用 FFmpeg 解码，生成波形峰值 JSON（每秒 50 点）。
- 视频：取首帧和中间帧做封面。
- 3D 模型（`.glb`/`.gltf`/`.fbx`/`.obj`）：v0.2 只显示信息，不渲染。
- 接口：`GET /api/projects/:id/assets/thumb?path=<rel>&size=256|1024`、`GET .../assets/waveform?path=<rel>`。

### 3.4 游戏语义识别

规则式识别，写入 `semantics_json`，每条都带 `source`（证据文件），置信度不足时不标：

| 类型 | 识别依据 |
| --- | --- |
| 精灵图/图集 | TexturePacker JSON（hash/array）、libGDX/Spine `.atlas`、Aseprite JSON、Godot `SpriteFrames`/`AtlasTexture` 的 `.tres`、Unity `.meta` 中 `spriteMode: 2` 及 `spriteSheet` 段 |
| 网格精灵图 | 用户在素材详情里声明行列或单元尺寸（不做自动猜测） |
| 九宫格 | Unity `.meta` 的 `spriteBorder`、Godot `NinePatchRect` 引用 |
| Tileset | Godot `TileSet` `.tres`、Tiled `.tsx`/`.tmx` |
| 音频循环 | Godot `.import` 的 `loop`、WAV `smpl` chunk、OGG `LOOPSTART` 注释 |

引擎元数据配对（`engine_meta_json`）：Unity `foo.png.meta` 的 `guid` 和导入设置摘要；Godot `foo.png.import` 的 `uid` 和导入器。通过 OpenPixo 移动或重命名素材时，必须带着配对文件一起移动；检测到外部重命名导致配对丢失时，在素材视图中警告。

### 3.5 确定性处理命令 `pixo asset`

查询类：

```text
pixo asset list   [--project <id>] [--kind <k>] [--tag <t>] [--origin generated|processed|imported] [--query <q>] [--cursor <c>] [--json]
pixo asset info   <rel-path> [--project <id>] [--json]
pixo asset tag    <rel-path...> --add <t> | --remove <t> [--project <id>] [--json]
pixo asset provenance <rel-path> [--project <id>] [--json]
```

处理类（全部遵守 `game-assets-batch` 的规则：不覆盖已有文件，默认输出到 `derived/<op>/<原相对路径>`，先写临时文件再改名，保留原件并前后比对哈希，逐项报告）：

| op | 参数 | 实现 |
| --- | --- | --- |
| `resize` | `--width/--height/--scale`，`--filter nearest|lanczos` | 图像库 |
| `trim` | `--padding` | 图像库，裁掉透明边 |
| `slice` | `--grid CxR` 或 `--cell WxH`，`--margin`，`--spacing` | 图像库，输出逐帧文件 + 清单 |
| `pack` | `--max-size`，`--padding`，`--format texturepacker-json|godot-tres` | 自写装箱算法（MaxRects），输出图集 + 描述文件 |
| `pixelate` | `--size`，`--palette <file|preset>`，`--dither none|ordered` | 图像库 + 调色板量化 |
| `palette` | `--colors N` | 提取调色板，输出 `.gpl`/`.hex` |
| `seamless-check` | — | 拼接四边比对，输出评分和预览图，不改原图 |
| `remove-bg` | `--mode chroma --color <hex> --tolerance` 或 `--mode model --model <id>` | chroma 本地完成；model 模式通过媒体管线调用供应商（BYOK，v0.3 起可走托管），记 provenance |
| `audio normalize` | `--lufs <值>`（必填，不替用户猜目标） | FFmpeg `loudnorm` |
| `audio trim` | `--silence-threshold` | FFmpeg |
| `audio loop` | `--crossfade-ms` | FFmpeg，输出带循环点的 WAV |
| `audio convert` | `--format wav|ogg|mp3`，`--sample-rate` | FFmpeg |

通用参数：`--project`、`--out <rel-dir>`、`--json`、`--dry-run`。输出契约 `AssetOpReport` 与 `game-assets-batch` 的报告字段一致，详见该 skill。

执行位置：这些是 daemon 内置的有界操作，不执行任意命令。由 daemon 执行，路径校验沿用媒体调度器的项目写入规则（只能写项目内、拒绝符号链接越界）。Agent 通过 CLI 调用时走 tool token 授权，与 `pixo media generate` 一样。

HTTP：`POST /api/projects/:id/asset-ops` `{ op, inputs: string[], params, out? }` → `AssetOpReport`；长任务返回 `taskId`，复用媒体任务的 wait 语义。

图像库选型（切片 1 的探针，二选一）：

- `sharp`：性能好，有 win32-x64 预编译包；需要验证打包后的 asar unpack 和 Electron 版本兼容。
- WASM 方案（如 `@jsquash/*` 系列）：无原生依赖，速度较慢。

在打包产物里实测两者后定，结论记入本文件。

### 3.6 UI

`GameAssetsPanel` 重写：

- 虚拟化网格，按缩略图展示；列表视图显示路径、尺寸、大小、来源。
- 筛选：类型、标签、来源（生成/处理/导入）、引擎语义（精灵图/图集/tileset/循环音频）。
- 详情抽屉：大图或波形、引擎元数据、来源记录（prompt、模型、参考图缩略图、run 链接）。
- 精灵图预览：按帧播放，可调帧率；网格声明表单。
- 批量操作：加入对话（保留现有事件）、运行处理（选 op 和参数）、「以此生成」（Phase 4 的入口，预留按钮）。
- 所有文案只加 en / zh-CN（若 Phase 0 的 i18n 回落已落地；否则按现行 19 语言规则）。

### 3.7 skill 更新

`skills/game-assets-batch/SKILL.md` 改为：优先调用 `pixo asset <op>`，只有 op 不支持的处理才回退到本机工具，并保留现有的保留原件和报告规则。

## 4. 实施切片

1. 图像库探针（打包后实测）+ 数据表 + 索引器（只做 stat 和增量）+ `pixo asset list/info` + 新网格 UI。
2. 缩略图与波形缓存。
3. 游戏语义识别 + 引擎元数据配对 + 重命名保护。
4. 来源记录：媒体任务完成时写入（改 `media/index.ts` 的落盘处），处理命令写入；详情抽屉。
5. 处理命令，依次：resize、trim、slice、pack → audio 四个 → pixelate、palette → remove-bg（chroma，然后 model）→ seamless-check。
6. skill 更新与批处理 UI。

## 5. 测试

- 索引器：夹具项目（含 Unity 和 Godot 布局，各约 200 个文件）全量扫描、增量事件、忽略目录、重命名后来源记录按哈希重新关联。
- 性能：生成 1 万个小文件的临时项目，断言首次列表时间预算（作为可选的慢测试，CI 默认跳过）。
- 每个 op：黄金文件比对（像素级或允许误差），覆盖「输出已存在则跳过」「原件哈希不变」「越界路径拒绝」「部分失败继续处理其他输入」。
- 语义识别：每种格式一个最小样本。
- UI：Playwright（`e2e/ui/openpixo-assets.test.ts` 扩展）覆盖筛选、详情、精灵图预览、批量切图后结果出现在网格中。

## 6. 验收

1. 一个约 1 万文件的真实或合成项目：打开 2 秒内出列表，滚动流畅，缩略图在后台补齐。
2. 在一张 8 方向行走精灵图上：声明网格 → `slice` → `pack` 成 Godot `.tres` 图集，Godot 能直接加载（`--headless --check-only` 无报错）。
3. 一次 `pixo media generate` 生成的图片，详情里能看到 prompt、模型和 run 链接；把它重命名后来源记录仍在。
4. Agent 在对话中被要求「把选中的音效统一到 -16 LUFS」，调用的是 `pixo asset audio normalize`，报告与输出文件一致。

## 7. 开放问题

- sharp chosen; packaged asar-unpack probe still pending.
- `sharp` 与 WASM 的最终选择（切片 1 决定）。
- 3D 模型缩略图是否在 v0.2 之后接入（可能借助 Three.js 离屏渲染）。
- 用户标签是否需要随项目保存（写进游戏目录便于团队共享），还是只存在本机数据库。当前设计只存本机。
