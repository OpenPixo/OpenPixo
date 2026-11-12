# OpenPixo Phase 4：生成 Studio 与 one-shot 预设实施规格

状态：草案，2026-10-25。未开工。所属版本 v0.2（只用用户自带 Key）。上游：路线文档 §4 Phase 4、§6 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`)。依赖：Phase 1（引擎画像、素材根、`pixo game verify`），Phase 3（`pixo asset` 处理命令、来源记录）。

## 1. 目标

体验参照 Higgsfield：挑一个预设 → 填少量参数或给参考图 → 一键出多张候选 → 选中的放进项目。与 Higgsfield 的区别是：结果直接落在游戏项目的正确目录、格式可用于引擎，而且 Agent 在写代码时也能调用同一个预设。

两类预设共用一种格式：

- **素材配方**：确定性管线，不需要大模型参与编排。流程是渲染 prompt → 媒体任务 → 后处理 → 检查 → 候选。
- **编码预设**：渲染出一段任务描述，加上所需 skills，启动一次 Agent run。

不在本阶段：平台托管模型和积分（v0.3 接入同一入口）、商店分发（Phase 6）、视频剪辑类配方。

## 2. 现状与接缝

| 接缝 | 现状 | 用法 |
| --- | --- | --- |
| `prompt-templates/{image,video}/*.json` + `media/prompt-templates.ts` + `GET /api/prompt-templates` | 单段 prompt，参数用 `{argument name="x" default="..."}` 内联 | 写一个转换器转成配方；旧接口保留 |
| 插件清单 `packages/contracts/src/plugins/manifest.ts` | `pixo.kind` 只有 `skill/scenario/atom/bundle`；有 `pixo.useCase.query`、`pixo.inputs`（`InputFieldSchema`：`string/text/select/number/boolean/file`） | 扩展出 `recipe` |
| 编码预设的 Agent run；素材配方执行器 | 旧 daemon atom 执行管线已按 [ADR 0012](../../docs/adr/0012-slim-core.md) 移除；保留的 atom 元数据不提供执行器 | 编码预设启动普通 Agent run；素材配方用新的确定性执行器（见 3.3） |
| `PluginInputsForm.tsx` | 按 `InputField` 渲染表单 | 扩展新的字段类型 |
| `pixo media generate/wait`、媒体任务 | 支持 `--image` 参考图（最多 5 张）、`--aspect`、`--output`、长任务轮询 | 执行器直接调用内部函数，不经 CLI |
| `MCP_TEMPLATES` 的 `higgsfield-openclaw` | Higgsfield 官方 MCP（OAuth） | 不作为配方后端；保留为可选 MCP |

## 3. 设计

### 3.1 配方清单

在插件清单上扩展，`pixo.kind` 增加 `'recipe'`，新增 `pixo.recipe` 块：

```json
{
  "name": "openpixo/sprite-walk-8dir",
  "title": "8 方向行走精灵图",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "pixo": {
    "kind": "recipe",
    "recipe": {
      "surface": "image",
      "category": "character",
      "engines": ["any"],
      "inputs": [
        { "name": "character", "type": "character-ref", "required": true },
        { "name": "style", "type": "select", "options": ["pixel-16", "pixel-32", "hand-drawn"], "default": "pixel-32" },
        { "name": "frames", "type": "number", "default": 6 }
      ],
      "prompt": "Sprite sheet of {{character.description}} walking, 8 directions in rows, {{frames}} frames per row, {{style}} style, transparent background, consistent proportions",
      "negative": "text, watermark, cropped limbs",
      "models": {
        "requires": ["i2i"],
        "recommended": ["gpt-image-2", "gemini-3.1-flash-image-preview"],
        "fallback": ["custom-image"]
      },
      "generation": { "count": { "default": 2, "max": 4 }, "aspect": "1:1" },
      "postprocess": [
        { "op": "remove-bg", "params": { "mode": "model" }, "optional": true },
        { "op": "slice", "params": { "grid": "{{frames}}x8" } }
      ],
      "checks": [
        { "check": "has-alpha" },
        { "check": "grid-divisible", "params": { "grid": "{{frames}}x8" } }
      ],
      "output": {
        "dir": "{{engine.spriteRoot}}/{{character.slug}}",
        "name": "{{character.slug}}_walk"
      }
    }
  }
}
```

要点：

- `surface`：`image | audio | video | model3d | code`。`code` 就是编码预设，此时用 `pixo.useCase.query` 和 `pixo.context.skills`，不使用 `prompt/models/postprocess`。
- 新增输入类型：`image-ref`（项目内图片）、`asset-ref`（任意项目素材）、`character-ref`（角色卡，见 3.4）、`aspect`、`count`。`InputFieldSchema` 同步扩展，`PluginInputsForm` 支持这些类型。
- 模板语法统一为 `{{var}}`，可访问 `inputs`、`engine`（Phase 1 画像，提供 `spriteRoot`/`audioRoot` 等派生字段）、`character`。只做变量替换，不支持表达式和代码执行。
- `models.requires` 是能力标签（`t2i/i2i/inpaint/transparent/loop/...`），执行时从用户已配置且满足条件的模型中选：先选 `recommended`，再选 `fallback`，都不可用就报「缺少可用模型」并链接到设置。
- `postprocess` 只能引用 Phase 3 的 `pixo asset` op。`checks` 是内置检查器（`has-alpha`、`dimensions`、`grid-divisible`、`seamless`、`loudness-range`、`duration-range`），失败的候选标红但仍可查看。

转换器 `scripts/import-prompt-templates-to-recipes.ts`：把 `{argument ...}` 转成 `inputs` 和 `{{var}}`，保留 `source` 归属。只转换适合游戏的条目；IP 有风险的条目（如提及具体商业游戏风格）不转换。

### 3.2 配方存放与发现

- 内置配方：`plugins/_official/recipes/<id>/`（`pixo.json` + `README.md` + `preview/` + `evals/`）。
- 用户或商店安装的配方：走现有插件安装流程，Phase 6 统一。
- 列表：`GET /api/recipes?surface&category&engine` → `RecipeSummary[]`；`GET /api/recipes/:id` → 完整清单与预览。

### 3.3 执行器

新模块 `apps/daemon/src/recipes/`：

```ts
export interface RecipeRun {
  id: string;
  projectId: string;
  recipeId: string; recipeVersion: string;
  inputs: Record<string, unknown>;
  model: { provider: string; id: string };
  status: 'queued' | 'generating' | 'postprocessing' | 'ready' | 'failed' | 'cancelled';
  candidates: RecipeCandidate[];
  quote?: RecipeQuote;          // v0.3: hosted credits; absent for BYOK
  createdAt: number; updatedAt: number;
}

export interface RecipeCandidate {
  id: string;
  index: number;
  stagedFiles: Array<{ role: 'primary' | 'derived'; ref: string; mime: string }>;
  checks: Array<{ check: string; ok: boolean; detail?: string }>;
  adoptedPaths?: string[];      // project-relative, after adopt
  error?: string;
}
```

流程：

1. 校验输入，渲染 prompt，选模型。
2. 按 `count` 提交媒体任务，复用媒体任务存储和 wait 语义，参考图来自 `image-ref`/`character-ref`。
3. 结果先放进 daemon 数据根下的**候选暂存区**（遵守数据目录约定），不直接写进游戏目录，避免被弃用的变体污染用户仓库。
4. 依次对每个候选执行 `postprocess`（在暂存区内调用 Phase 3 的处理实现），然后执行 `checks`。
5. 用户「采用」时，把选中候选的文件按 `output` 规则写入项目（不覆盖，冲突时自动加序号），同时写来源记录（`origin: 'generated'`，带 `recipe_run_id`、prompt、模型、参考图哈希）。
6. 暂存区按时间清理，默认保留 7 天；被采用的文件不受影响。

编码预设（`surface: 'code'`）：渲染 `useCase.query`，确保 `context.skills` 已在项目中启用（未启用时提示一键启用），然后用现有对话入口发起 run。启动路径必须走 `internalRunCreation.start`。

### 3.4 角色卡

角色卡保存在游戏目录里，便于随项目版本管理和团队共享（遵循 ADR 0003）：

```text
<project>/.openpixo/characters/<slug>.json
```

```json
{ "slug": "fox-hero", "name": "小狐狸", "description": "small orange fox, green scarf, big eyes",
  "references": ["art/fox/ref_front.png", "art/fox/ref_side.png"], "style": "pixel-32", "notes": "" }
```

引用路径都是项目相对路径。接口：`GET/POST/PUT/DELETE /api/projects/:id/characters[/:slug]`；`pixo character list|show|create|update|delete [--json]`。UI：Studio 侧栏的角色列表，素材详情里可「设为角色参考」。

### 3.5 HTTP 与 CLI

```text
GET  /api/recipes                              pixo recipe list [--surface] [--category] [--engine] [--json]
GET  /api/recipes/:id                          pixo recipe show <id> [--json]
POST /api/projects/:id/recipe-runs             pixo recipe run <id> [--project] [--input k=v]... [--inputs-file <path|->]
                                                              [--model <id>] [--count N] [--json] [--wait]
GET  /api/projects/:id/recipe-runs/:runId      pixo recipe status <runId> [--json]
POST /api/projects/:id/recipe-runs/:runId/adopt  pixo recipe adopt <runId> --candidate <id>... [--json]
POST /api/projects/:id/recipe-runs/:runId/cancel pixo recipe cancel <runId>
```

- `--inputs-file` 接受 JSON，`-` 表示 stdin；文本较长的输入（如角色描述）也可以用 `--prompt-file` 覆盖 `prompt` 里的自由文本槽。
- `--wait` 的退出码沿用 `media wait`：0 完成，2 仍在运行，5 失败。
- Agent 调用时默认不自动采用：返回候选路径（暂存区绝对路径，在运行允许目录内），由 Agent 用图像输入检查后再调用 `adopt`；用户也可以在 UI 里采用。

游戏路径提示词（Phase 1 的分块组合）增加一块：列出当前项目可用的配方 id 和用途（截断到前 N 个），说明优先用配方生成游戏素材，用法见 `pixo recipe --help`。

### 3.6 Studio 界面

- 项目内新增「生成」标签，与「文件」「素材」「扩展」并列。
- 左栏：分类（角色、道具图标、tileset、UI、特效、背景、key art、贴图、3D、音效、BGM、配音）和角色卡。
- 中间：预设画廊，卡片有预览图、标题、支持的引擎、需要的模型能力；没有可用模型的卡片置灰并说明原因。
- 右侧或弹层：参数表单 → 「生成」→ 候选网格（检查结果、放大对比）→「采用」「再来一组」「以此为参考生成变体」。
- 素材面板里的「以此生成」把选中素材作为 `image-ref` 带进配方。
- 首页的入口芯片：编码预设 6 个、素材配方 6 个。

### 3.7 首批内容

素材配方（每个都要在 `evals/` 里留下至少一次真实供应商运行的输入、输出和检查结果，才算上架）：

| id | surface | 后处理 / 检查 | 说明 |
| --- | --- | --- | --- |
| `character-turnaround` | image | trim / has-alpha | 角色三视图，输出可作为角色卡参考 |
| `sprite-walk-8dir` | image | remove-bg、slice / grid-divisible | 见上例 |
| `item-icon-set` | image | slice、resize / dimensions | 一张图出 N 个图标，切成单图 |
| `tileset-seamless` | image | seamless-check / seamless | 地砖、草地等可平铺贴图 |
| `ui-nine-slice` | image | trim / has-alpha | 按钮和面板，输出建议九宫格边距 |
| `vfx-sequence` | image | slice / grid-divisible | 技能特效序列帧 |
| `parallax-layers` | image | remove-bg / has-alpha | 视差背景分层 |
| `pbr-texture` | image | seamless-check | 无缝材质贴图（漫反射；法线图后续） |
| `skybox` | image | — | 等距柱状全景 |
| `model-from-image` | model3d | — | 图生 3D（需要支持 3D 的供应商，如 fal） |
| `ui-sfx-pack` | audio | audio trim、normalize / loudness-range | 一组 UI 音效 |
| `bgm-loop` | audio | audio loop / duration-range | 循环背景音乐（需要音乐供应商） |
| `npc-voice-lines` | audio | audio normalize | 按台词表批量配音 |

编码预设：横版跳跃、俯视角射击、三消、塔防、卡牌战斗、Roguelike 地牢（各限定 Phaser 或 Godot 模板）；功能型：存档、对话、背包、成就、设置菜单、手柄支持、本地化接入。每条都要在 Phase 1 的模板项目上真实跑通一次，并通过 `pixo game verify`。

## 4. 实施切片

1. 清单扩展：`pixo.kind: 'recipe'`、`pixo.recipe` 的 zod schema、新输入类型、`/api/recipes` 列表接口、转换器。
2. 执行器核心：模型选择、媒体任务提交、暂存区、采用、来源记录写入；`pixo recipe` 全部子命令。
3. 后处理与检查接入（依赖 Phase 3 处理命令）。
4. Studio UI 与首页入口。
5. 角色卡。
6. 首批内容和 evals；游戏提示词中的配方块。

## 5. 测试

- schema：合法和非法清单各一组；模板变量缺失、越界路径（`output.dir` 含 `..`）一律拒绝。
- 执行器：用 `stub` 媒体供应商跑完整流程（stub 只用于测试，执行器在非测试环境拒绝把 stub 产物作为候选，避免占位图被当成真结果）；覆盖取消、部分候选失败、采用时文件名冲突、暂存区清理。
- 模型选择：按 `requires` 和用户配置筛选的矩阵测试。
- CLI：`--json` 输出结构、`--wait` 退出码、`--inputs-file -`。
- UI：Playwright 覆盖从画廊进入、填表、生成（stub）、采用后在素材面板出现。

## 6. 验收

1. 至少 6 个素材配方在真实供应商（用户自带 Key，需批准用量）下产出可直接进引擎的素材：透明背景正确、尺寸符合、精灵图能切开，并在 Phaser 或 Godot 模板项目中实际加载显示。
2. Agent 在一次编码任务里调用 `pixo recipe run` 生成一组图标，自己检查后 `adopt`，并在代码里使用它们。
3. 编码预设至少 3 条在模板项目上一次跑通并通过 `pixo game verify`。
4. 所有采用的文件在素材面板的来源记录里能追溯到配方、模型和 prompt。

## 7. 开放问题

- 角色一致性完全依赖参考图和模型的 i2i 能力；是否需要「LoRA/角色训练」类供应商（如 fal train），放到 v0.3 之后评估。
- 音乐供应商（Suno、Udio 等）在 `media/models.ts` 中仍是未接入状态，`bgm-loop` 是否能进入首批取决于是否有可用的 BYOK 供应商。
- 候选暂存区的默认保留天数。
