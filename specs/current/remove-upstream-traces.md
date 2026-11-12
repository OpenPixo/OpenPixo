# 移除 OpenDesign 痕迹（总计划）

Status: phases 1–7 complete (2026-10-28); final evidence and reproduced Windows validation exceptions: [PHASE7-CLOSE.md](../../docs/coordination/PHASE7-CLOSE.md).

> Historical migration plan. Its protected-domain inventory is superseded by the [slim-core record](../../docs/coordination/SLIM-CORE.md), including Batch 9's removal of the global Library. Original scope and measurements below remain evidence, not current retention instructions.

> 给执行 agent 的总任务说明。先读完全文，再读根目录 `AGENTS.md`、`docs/adr/0006-full-hard-fork.md`、`docs/prompt-composition.md`、`openpixo-internal/docs/OPENPIXO-ROADMAP.zh-CN.md` §1.3。CLI 改名的细则在 `specs/current/cli-rename-pixo.md`（本计划的阶段 2）。

## 0. 背景与目标

- OpenPixo 是 OpenDesign 0.25.1 的完全硬分叉（ADR 0006）。ADR 0006 曾允许内部标识（`@open-design/*`、`od`、`OD_*`、持久化键、协议名）继续保留。现在**没有用户、也没有已发布的安装包**，迁移成本最低，因此决定：一次性把这些标识全部换成 OpenPixo 自己的名字，**不写兼容层、不写数据迁移、不保留旧名别名**。
- 目标：除第 2 节“必须保留”的内容外，仓库里（git 历史除外）不再出现 OpenDesign、open-design、`od`/`OD_` 前缀标识，以及上游组织 nexu 的痕迹。
- 规模（2026-10-26 粗略统计，排除 node_modules/dist）：

| 痕迹 | 文件数 | 行数 |
|---|---|---|
| `OpenDesign` / `Open Design` / `open-design` 文字（含包名） | ~6000 | ~20000 |
| `od-` / `--od-` CSS 类和变量 | ~2000 | ~33000 |
| `@open-design/` 包名 | ~1800 | ~3300 |
| `OD_*` 环境变量和常量 | ~890 | ~5900 |
| Vela 云 | ~850 | ~7600 |
| `nexu` | ~730 | ~2600 |
| `od-next` | ~210 | ~1900 |
| `x-od-*` HTTP 头 | ~280 | ~1600 |
| `odXxx` 标识符 | ~140 | ~950 |
| `'od:xxx'` 消息、事件、存储键 | ~140 | ~930 |
| `open-design.json` 插件清单 | ~180 | ~560 |
| `.od/` 路径 | ~70 | ~330 |
| `<od-card>` | ~70 | ~280 |
| 文件名带 open-design / od | ~6200 | — |

- 其中 `design-systems/` 一个目录就占了约 2100 个文件的文字痕迹、约 1650 个文件的 CSS 痕迹。这些都属于已经隐藏、计划删除的继承功能，**所以先删、后改名**：要删掉的代码不要先花力气去改名。

## 1. 命名对照表（全仓统一，执行中不要自创新名）

| 旧 | 新 | 备注 |
|---|---|---|
| CLI 可执行名 | `pixo` | 阶段 2 已执行；细则见 `cli-rename-pixo.md`，决定见 ADR 0008 |
| 包作用域 `@open-design/*` | `@openpixo/*` | 子包名不变，例如 `@openpixo/daemon` |
| 根包名 `open-design` | `openpixo` | |
| 环境变量 `OD_*` | `PIXO_*` | 例如 `PIXO_DATA_DIR`、`PIXO_BIN`、`PIXO_NODE_BIN` |
| 代码常量 `OD_FOO` | `PIXO_FOO` | |
| 标识符 `odFoo` / `OdFoo` | `pixoFoo` / `PixoFoo` | |
| CSS `od-*` / `--od-*` | `pixo-*` / `--pixo-*` | 不要用 `px-`，会和 Tailwind 风格的间距类混淆 |
| HTTP 头 `x-od-*` | `x-pixo-*` | |
| 消息、事件、存储键前缀 `od:` | `pixo:` | 包括 postMessage、localStorage、自定义事件 |
| 产物标签 `<od-card>` | `<pixo-card>` | prompt、解析器、渲染器、fixture 要一次改齐 |
| 插件清单 `open-design.json` | `pixo.json` | |
| 清单字段 `od` | `pixo` | 包括 `od.kind`、`od.inputs`、`od.pipeline` 等 |
| 导出目标 `'od'` | `'pixo'` | `plugins/export.ts`、CLI `--as`、导出路由 |
| 项目内目录 `.od/` | `.pixo/` | 受“数据目录约定”约束，见阶段 4 |
| 系统协议 `od://` | `openpixo://` | 系统级协议名要唯一，所以用全称 |
| 文件名 `od-*`、`*open-design*` | `pixo-*`、`*openpixo*` | 用 `git mv` |
| 文字 OpenDesign / Open Design | OpenPixo | 只用于确实指本产品的地方；指上游时改写或删掉 |

## 2. 必须保留（法律和历史要求，不得删改）

- `LICENSE`（Apache-2.0）原文不动。
- `NOTICE` 里的上游署名段落（“This product contains software developed by the OpenDesign project…”、上游 commit 和链接）。Apache-2.0 第 4 条要求保留署名，只能更新 OpenPixo 自己写的那部分说明。
- 内置第三方组件自带的 LICENSE 和版权声明（`design-templates/guizang-ppt`、`design-templates/html-ppt`、`skills/web-clone` 等，删除目录时连同删掉没问题，保留的就不要改）。
- `docs/references.md` 中的上游出处说明，`docs/adr/0006-full-hard-fork.md` 正文（历史记录，只追加“已被 ADR 0007 取代”的说明）。
- git 历史。
- `apps/daemon/tests/fixtures/claude-cli-recordings/` 和 `mocks/` 里的录制数据：这些是 CLI 原样输出。只允许把 daemon 自己注入的内容（环境变量名、prompt 文本、标签名）按第 1 节对照表机械替换，并在对应 README 里写一句说明；不要重新录制（会花 provider 额度），也不要改 CLI 自己产生的字段。

## 3. 阶段

每个阶段单独提交（必要时一个阶段拆成多个提交）。**每个提交结束时都要通过 `pnpm guard` 和 `pnpm typecheck`**，并跑受影响的 focused 测试，不允许出现“先改坏、后面再修”的中间提交。不要跑 daemon 或 web 全量测试，不要跑任何 live 模型测试。

### 阶段 1：删除隐藏的继承功能

按 `openpixo-internal/docs/OPENPIXO-ROADMAP.zh-CN.md` §1.3 和 `packages/contracts/src/product.ts` 的 `PRODUCT_SURFACES`，**每次删一个域、一个提交**：

1. 设计系统：`design-systems/` 及其路由、UI、prompt 引用
2. deck / PPT 模板和 PPTX 导出：`design-templates/` 中的 deck 类模板、相关 skills
3. Figma 迁移
4. Orbit
5. brands
6. critique theater：评分 UI，以及 `.github/workflows/critique-conformance.yml`
7. Vela 云、团队 collab、team billing：包括 `mocks/` 中的 `vela` CLI，以及 AMR 钱包相关 spec
8. Web Clipper：`clipper/`
9. codex pets
10. 上游部署物：`deploy/`，确认没有被 OpenPixo 用到后删除
11. 设计向 skills 和插件：`skills/`、`plugins/_official/`、`plugins/community/` 中与游戏无关的部分。保留标准：游戏路径的 prompt、recipes、Studio 和素材功能有没有用到。拿不准的列进 PR 让用户确认，不要自己判断后删掉
12. **OD Next 策略**：游戏项目（有 `metadata.baseDir`）在 `apps/daemon/src/prompts/system.ts` 里提前返回，根本走不到 OD Next，所以它只服务于继承的设计项目。删掉 `apps/daemon/src/strategies/od-next/`、`plugins/_official/scenarios/od-next-strategy/`、`packages/contracts/src/prompts/od-next-*.ts`、Settings → Labs → Design Harness、`odNextStrategyMode`、`OD_NEXT_STRATEGY_ROLLOUT` 及对应测试；同步更新根 `AGENTS.md` 的 “Prompt variants” 一节（三条路径变成两条）。如果发现游戏路径实际依赖其中某块（例如 `<question-form>` 宿主约定），把那块移到 contracts 的公共 prompt 模块，不要整块保留
13. 最后：`PRODUCT_SURFACES` 中已经删完的开关一并删除，`isProductSurfaceEnabled` 的调用点随之清掉

不能删的（ADR 0006）：运行时适配层（`runtimes/`、`agent-protocol/`）、sidecar/platform 包、插件核心、媒体管线、Library、打包控制面。

### 阶段 2：CLI 改名

按 `specs/current/cli-rename-pixo.md` 执行。该文档“本次不改”一节列的内容由本计划后面的阶段处理，阶段 2 里不要碰。

### 阶段 3：包作用域和根包名

执行记录（2026-10-27）：源码与 CI/打包改名见 `66d8afe1`、`36bae568`；决定见 [ADR 0009](../../docs/adr/0009-package-scope-openpixo.md)，验证与交付记录见 [PHASE3-SCOPE.md](../../docs/coordination/PHASE3-SCOPE.md)。本节与命名表保留原始旧名作为迁移来源；后续阶段的标识不在本次改名范围内。

- `@open-design/*` → `@openpixo/*`：所有 `package.json` 的 `name` 和依赖、import 语句、`tsconfig` paths、Next.js `transpilePackages`、vitest/playwright alias、`scripts/guard.ts`、`.github/config/scopes.json` 和 `.github/scripts/scopes.py`（改之前先读 `specs/current/ci.md`）、`tools/pack` 的打包清单。
- 根 `package.json` 的 `name` 改为 `openpixo`。
- 改完运行 `pnpm install`，提交更新后的 `pnpm-lock.yaml`。
- 验证：`pnpm guard`、`pnpm typecheck`、`pnpm --filter @openpixo/daemon build`、`pnpm --filter @openpixo/web build`、`pnpm --filter @openpixo/tools-dev build`、`pnpm --filter @openpixo/tools-pack build`。

### 阶段 4：环境变量、协议和持久化标识

可以按小节拆成多个提交，每个提交两端一起改：

1. `OD_*` → `PIXO_*`：daemon、tools-dev、tools-pack、packaged、desktop、sidecar、prompt、插件、skills、design-templates 里的 `"$OD_NODE_BIN" "$OD_BIN"` 一并改。根 `AGENTS.md` 的“Daemon data directory contract”整节同步改名（`PIXO_DATA_DIR`、`PIXO_MEDIA_CONFIG_DIR`、`PIXO_LEGACY_DATA_DIR`）。`OD_LEGACY_DATA_DIR` 是从上游导入数据用的；现在不需要导入上游数据了，直接删除这个功能，不要改名。
2. `x-od-*` → `x-pixo-*`：daemon 中间件、web 请求、CLI 请求、e2e 测试。
3. `od:` → `pixo:`：postMessage（iframe 桥接，比如 `od:tweaks-available`）、localStorage 和 sessionStorage 键、自定义事件名、`apps/web/public/od-notifications-sw.js`（文件改名并更新注册路径）。
4. `<od-card>` → `<pixo-card>`：`packages/contracts/src/artifacts/od-card.ts`（文件也改名）、`chat-protocol-context.ts`、`api/memory.ts`、两边的 `prompts/system.ts`、`apps/web/src/artifacts/internal-markers.ts`、`AssistantMessage.tsx`、`ExecutionShell.tsx`、`SayBlock.tsx`、`ThinkingMarkdown.tsx` 及对应测试。
5. 插件清单：`open-design.json` → `pixo.json`，字段 `od` → `pixo`。要改的地方包括：契约里的 `PluginManifest` 类型、daemon 的读取、校验、导出、diff 逻辑，`plugins/spec/`，所有保留下来的插件，以及市场种子数据。
6. 项目内目录 `.od/` → `.pixo/`。这是数据目录约定管辖的路径，用户已确认这次改名，不需要再走维护者审批。只改名，不新增任何路径规则，也不要在文档里写具体的路径示例。
7. `od://` → `openpixo://`：`apps/packaged/src/protocol.ts`、安装器注册、`tools/pack` 的身份校验。改完更新 `openpixo-internal/docs/coordination/PACKAGING.md`，并确认 ADR 0005 中的打包身份要求仍然满足。
8. sidecar 协议名、SQLite 表名或列名、app-config 键里带 `od`/`openDesign` 的，统一按对照表改名。数据库直接用新 schema，不写迁移。

### 阶段 5：代码标识符、CSS 和文件名

- `odFoo` / `OdFoo` / `OD_FOO` 常量 → `pixo*` / `PIXO_*`。
- CSS：`od-*` → `pixo-*`，`--od-*` → `--pixo-*`，包括 CSS Modules、全局样式、`packages/components`，以及 TSX/TS 里拼出来的类名字符串。改完要检查一遍视觉效果：用 `pnpm tools-dev run web` 起一个隔离的 namespace，截首页、项目页、设置页、聊天面板，和改之前对比。
- 文件名和目录名：`git mv`，然后更新所有 import。

### 阶段 6：文字和文档

- UI 文案和 i18n：19 个语言文件中的 “OpenDesign” 等字样一律改为引用 `PRODUCT_NAME` 或 OpenPixo；指上游的文案直接删掉。
- 注释、报错信息、日志文字。
- 文档：根目录和各层 `AGENTS.md`、`README*.md`、`QUICKSTART.md`、`CONTRIBUTING.md`、`docs/**`、`specs/**`、`.github/**`、`.claude/**`。
  - `docs/i18n/` 下面是上游的多语言 README、QUICKSTART、CONTRIBUTING、MAINTAINERS。OpenPixo 只维护中英文，**整个目录删除**；中文内容如果有用，并入 `README.zh-CN.md` 和 `docs/i18n/CONTRIBUTING.zh-CN.md`（按根 `AGENTS.md` 的索引保留这一个文件，或改到 `CONTRIBUTING.zh-CN.md` 并更新索引）。
  - 已归档的上游文档 `docs/spec.md`、`docs/roadmap.md` 直接删除，并更新根 `AGENTS.md` 的文档索引。
  - 指向 `nexu-io/open-design` 的链接：除了第 2 节必须保留的，其余都删掉。
- `pnpm guard` 的提示文字、`scripts/` 下的帮助文本。

### 阶段 7：收尾和防回退

1. 新增 `docs/adr/0007-remove-opendesign-identifiers.md`：记录命名对照表、不保留兼容层的理由（没有用户）、必须保留的署名内容。在 ADR 0006 的 “Internal names may stay” 一条后面注明“已被 ADR 0007 取代”。
2. 在 `scripts/guard.ts` 加一条检查：源码、内容目录和文档里如果再出现 `@open-design/`、`OpenDesign`、`open-design`、`\bOD_[A-Z]`、`x-od-`、`<od-card`、`open-design.json`，guard 直接失败。白名单只允许第 2 节列出的文件和录制数据。
3. 全仓复查（排除 node_modules、dist、.git、.tmp、.cache）：

```bash
rg -n -i --hidden -g '!**/node_modules/**' -g '!**/dist/**' -g '!.git' -g '!.tmp' -g '!.cache' \
  -e 'open-?design' -e 'nexu' -e '\bOD_[A-Z0-9_]+' -e '\bod[A-Z][a-z]' -e 'x-od-' -e '<od-card' \
  -e '(^|[^a-z])od-[a-z]' -e '--od-' -e "['\"\`]od:[a-z]" -e '\.od/' -e 'od://' -e '\bvela\b'
rg --files -g '!**/node_modules/**' | rg -i 'open-?design|(^|/)od[-.]'
```

剩下的命中只能是第 2 节允许的内容。

## 4. 本机环境注意

- `openpixo-internal/docs/coordination/STATUS.md` 记录了一个正在运行的已安装 Alpha.3 实例（“OpenPixo Alpha” 窗口），**不要停止或卸载它**。改名后的新构建会使用新的环境变量、数据目录名和协议，**读不到 Alpha.3 的配置和数据**。这是预期行为，不写迁移；需要的话，由用户决定什么时候卸载 Alpha.3。
- 测试和截图用隔离的 namespace，并通过 `PIXO_DATA_DIR`（阶段 4 之前用 `OD_DATA_DIR`）指定独立的数据目录。
- PowerShell 中先按根 `AGENTS.md` “Windows”一节把 `.cache\toolchain` 加到 `PATH`。

## 5. 分支、提交与 PR

- 从当前开发分支 `codex/opendesign-base` 切出新分支 `refactor/remove-opendesign`（本地没有 `main`）。分支名本身带 opendesign 字样不影响，这次不用改。
- 提交信息用 Conventional Commits，例如 `refactor!: delete design-systems surface`、`refactor(cli)!: rename od binary to pixo`、`refactor!: rename @open-design scope to @openpixo`。**不加** `Co-authored-by` 或其他共同作者信息。
- 每个阶段结束时在 `openpixo-internal/docs/coordination/STATUS.md` 追加一行进度和验证命令。
- 全部完成后开一个 PR（或者每个阶段开一个），用 `.github/pull_request_template.md`，每一节都填。附上阶段 5 的前后截图和第 3 节复查命令的输出。

## 6. 完成标准

- 第 3 节复查命令只命中第 2 节允许的内容。
- 第 7 阶段加的 guard 检查生效：随便加一行 `OpenDesign` 时，`pnpm guard` 会失败。
- `pnpm guard`、`pnpm typecheck`、各包 build、受影响的 focused 测试全部通过。
- `pnpm tools-dev` 能在隔离 namespace 里正常启动，导入一个游戏项目并跑通一次对话（用 `mocks/` 的 mock CLI，不要用真实模型）。
- `pnpm tools-pack win build --to nsis` 能出包，安装器身份、协议和数据 namespace 都是 OpenPixo 自己的。这一项只构建不安装，安装前要先问用户。
