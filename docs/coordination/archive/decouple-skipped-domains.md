> Historical coordination record. It does not describe the current OpenPixo feature set. Deleted cloud, team, global Library and design-strategy references are evidence only.

# 阶段 1 补完：解耦并删除跳过的 4 个继承域

> 给执行 agent 的任务说明，是 `specs/current/remove-upstream-traces.md` 阶段 1 的补完。阶段 1 第一轮（`14c11b91..c4d4e4bb`）跳过了设计系统、brands、Vela/协作/计费、retired design strategy 四项，理由见 `docs/coordination/PHASE1-REMOVAL.md`。本文给出每项的依赖点、拆法和顺序。先读完全文，再读根目录 `AGENTS.md`、`docs/prompt-composition.md`、`openpixo-internal/docs/CLOUD-CREDITS-LAUNCH-PLAN.md` §2，以及要改的每个目录的 `AGENTS.md`。

## 0. 原则

- **先拆依赖，再删。** 每一项都是：把游戏主线真正用到的那一小块挪进中性模块（名字里不带 design-system / brand / vela / collab / pixo-next），确认绿了，再整块删除。
- **中性模块要按本地单机产品的语义重写，不是原样搬家。** OpenPixo 没有团队工作区、没有云端账号（自己的账号和积分是以后新建的 `/api/openpixo/*` 领域，不复用 Vela，见 `openpixo-internal/docs/CLOUD-CREDITS-LAUNCH-PLAN.md` §2）。所以搬出来的代码里，凡是团队、workspace、Vela 身份的分支一律删掉，只留本地单用户的那条路。
- **没有用户，不写迁移。** 删掉的 SQLite 表、app-config 键、请求头、持久化键直接从 schema 和代码里去掉，不写升级脚本。
- **每个提交都要绿**：`pnpm guard`、`pnpm typecheck`、改动涉及的 focused 测试。不跑 daemon 或 web 全量测试，不跑任何 live 模型测试。已知的 Windows 环境性失败（CRLF、缺 `python3` 和 `corepack` 等，见 `PHASE1-REMOVAL.md` “Failures and limits”）在当前 HEAD 上复现过的，可以排除，但要在报告里列出来。
- **游戏主线冒烟**：每完成一项（不是每个提交），跑一次 `e2e/tests/openpixo/game-workspace.test.ts`（按 `e2e/AGENTS.md` 的方式），再用 `mocks/` 的 mock CLI 在隔离 namespace 里导入一个游戏项目、跑通一轮对话（`pnpm tools-dev run web` + 独立 `PIXO_DATA_DIR`）。不要用真实模型。
- **遇到本文没写到的依赖**：先按“挪进中性模块、去掉团队/云分支”的原则自己拆；如果拆法会改变游戏主线的行为（不只是删掉不可达的分支），停下这一项，在报告里写清楚，不要猜。

## 1. 顺序

1. retired design strategy（最独立，先做）
2. 设计系统 + brands（是同一个“设计套件”域，一起做）
3. Vela / 协作 / 计费 / AMR（最大，最后做；做完后第 2 步留下的团队分支才能彻底清掉）
4. 收尾：删除 `PRODUCT_SURFACES` 机制本身

## 2. retired design strategy

依赖点（已核实）：

| 位置 | 情况 | 拆法 |
|---|---|---|
| `apps/daemon/src/runtimes/chat-prompt-inputs.ts:185`、`:269` | 普通（含游戏）路径也会调用 `assertOdNextLegacyTextContributorCoverage`，它只是检查 prompt 片段 ID 有没有登记在 retired design strategy 的映射表里 | 删掉这个断言调用，以及 `strategyInputStage` / `odNextRequestBundle` 两个分支，普通路径保持原样 |
| `packages/contracts/src/prompts/chat-turn-host-protocol.ts:3`、`:91` | `policy === 'od_next_request'` 分支和对 `pixo-next-production-marker` 的 import | 删掉这个 policy 值、分支和 import；`ChatTurnHostProtocolPolicy` 类型同步收窄 |
| `apps/daemon/src/services/run-analytics-lifecycle.ts`、`apps/daemon/src/db.ts`、`runtimes/chat-run-records.ts` | Run 记录和统计里带着策略状态 | 删掉策略相关字段和列，不写迁移 |
| `apps/daemon/src/strategies/pixo-next/rollout.ts` 及调用方 | 每次 Run 评估是否启用 | 整个调用链删除 |
| Settings → Labs → Design Harness、app-config `odNextStrategyMode`、`PIXO_NEXT_STRATEGY_ROLLOUT` | 开关 | 删除 UI、配置键、环境变量和对应 i18n 键（en、zh-CN 和其他语言文件里的同名键都删） |

然后删除：`apps/daemon/src/strategies/pixo-next/`、`apps/daemon/src/runtimes/pixo-next-exact-input.ts`、`plugins/_official/scenarios/pixo-next-strategy/`、`packages/contracts/src/prompts/pixo-next-*.ts`（`index.ts` 里的导出同步删）、相关测试和 fixture（`apps/daemon/tests/**/pixo-next*`、`tests/fixtures/od-next-runtime-capabilities`）、web 里的 retired design strategy 卡片和状态。

文档：根 `AGENTS.md` “Prompt variants”从三条路径改为两条（游戏路径、legacy 路径），删掉 retired design strategy 开关说明；`docs/prompt-composition.md` 同步。`<question-form>` 的游戏路径规则已经在 `packages/contracts/src/prompts/openpixo-game.ts`，确认 legacy 路径也还有它的说明，不要随 retired design strategy 一起删掉。

建议提交：`refactor!: drop retired design strategy hooks from the ordinary run path` → `refactor!: delete retired design strategy strategy`。

## 3. 设计系统 + brands

### 3.1 依赖点（已核实）

- **skill 目录服务混在设计系统模块里。** `apps/daemon/src/design-systems/server-services.ts` 里的 `listAllSkills`、`listAllDesignTemplates`、`listAllSkillLikeEntries`、`validateProjectSkillId` 管的是全部 skills 的列表和项目 skill 校验，游戏任务启动时要用；同一个工厂函数里另外 10 个函数才是真正的设计系统逻辑。
- **brands 的“共享预览”其实是设计系统专用面板。** `apps/web/src/components/FileWorkspace.tsx` 里用 `useDesignKit` / `DesignKitView` 的是 `DesignSystemProjectPanel`（约 4821 行起），只在 `activeTab === DESIGN_SYSTEM_TAB && designSystemProject` 时渲染（约 4438 行），游戏项目走不到。所以 brands 不需要单独解耦，跟设计系统一起删。
- **Library 用到设计系统列表。** `apps/daemon/src/library-install.ts:11`、`library-sync.ts:26` import `listDesignSystems`。Library 是受保护的（ADR 0006），只删掉它的“设计系统”分类，不动 Library 本身。
- 其他 import 方：`routes/project/index.ts:94`（创建、删除、关联设计系统项目）、`server-context.ts:3`（类型）、`design/finalize-design.ts`、`project-design-token-suggestions.ts`、`brand-routes.ts`、`brands/index.ts`、`routes/design-systems.ts`、`routes/design-system-tool.ts`、`routes/static-resource.ts`、`cli.ts`（`rename-args.js`）、`server.ts`（多处）。

### 3.2 步骤

1. **抽出 skill 目录服务**：新建 `apps/daemon/src/services/skill-catalog.ts`，放 `listAllSkills`、`listAllDesignTemplates`、`listAllSkillLikeEntries`、`validateProjectSkillId`，`server.ts` 改为从这里拿。此时 `listAllSkills` 里的团队工作区分支（`teamResourceWorkspaceRoot`、`readTeamResourceMaterialization`、`workspaceTeamSkillBindingAllowsRead`）先原样保留，第 4 节删协作时再去掉。`listAllDesignTemplates` 这个名字改成不带 design 的（例如 `listAllTemplates`），因为剩下的模板（图片、视频、音频）不是设计模板。单独提交。
2. **删设计系统和 brands**：`design-systems/` 内容目录、`plugins/_official/design-systems/`、`apps/daemon/src/design-systems/`、`apps/daemon/src/brands/`、`brand-routes.ts`、`routes/design-systems.ts`、`routes/design-system-tool.ts`、`design/finalize-design.ts`、`project-design-token-suggestions.ts`，以及 `routes/static-resource.ts` 和 `routes/project/index.ts` 里的设计系统部分；项目 metadata 里的 `designSystemId` 字段和校验；legacy prompt 里注入设计系统内容的部分（先读 `docs/prompt-composition.md`，游戏路径不受影响）。web 侧：`DesignKitView.tsx`、`DesignSystemKitPreview.tsx`、`BrandPreviewCard.tsx`、`design-system-metadata.ts`、`runtime/design-kit.ts`、`runtime/design-md-parse.ts`（确认没有别的使用方）、`FileWorkspace.tsx` 里的 `DesignSystemProjectPanel` 和 `DESIGN_SYSTEM_TAB` 分支、设计系统选择器和相关 i18n 键。`scripts/guard.ts` 里的设计系统检查（token allowlist、A2 defaults parity、flag parity、component manifest）一并删除。Library 的设计系统分类删除。
3. 体量很大，可以按 daemon / web / 内容目录 / guard 拆成几个提交，但每个提交都要绿。

建议提交：`refactor(daemon): extract skill catalog service` → `refactor!: delete design systems and brands`（可拆分）。

## 4. Vela / 协作 / 计费 / AMR

### 4.1 依赖点（已核实）

- **项目权限检查在协作模块里。** `apps/daemon/src/collab/project-request-authority.ts`（`createAuthorizeProjectRequest`、`enforceLocalProjectDataPlaneRequest`）被 19 个文件使用，包括 `routes/chat.ts`、`routes/media.ts`、`recipes/routes.ts`、`routes/host-tools.ts`、`routes/live-artifact.ts`、`routes/library.ts`、`import-export-routes.ts` 等游戏主线接口。云积分计划（`CLOUD-CREDITS-LAUNCH-PLAN.md` §2）也要复用“项目授权和落盘”。
- **协作模块还被这些地方 import**：`db.ts`（8 个 store）、`chat-artifacts/store.ts`、`plugins/local-source.ts`（`team-resource-materialization`）、`metrics/workspace-authority.ts`、`routes/library.ts`（`vela-workspace-context`）。设计系统相关的 import 在第 3 节已经删掉。
- **Vela 集成**：`apps/daemon/src/integrations/vela*.ts`（8 个文件）、`collab-cloud.ts`、`share-viewer-origin.ts`，以及 `routes/vela.ts`、`routes/collab-*.ts`。
- **AMR 是 Vela 的托管 agent 运行时**，不是 OpenPixo 产品化的运行时（Codex、Claude Code、OpenCode）。`runtimes/` 里依赖它的有 `defs/amr.ts`、`amr-model-cache.ts`、`amr-model-probe.ts`、`project-amr-trace-env.ts`、`vela-child-evidence.ts`，以及 `auth.ts`、`detection.ts`、`env.ts`、`metadata.ts`、`models.ts`、`registry.ts`、`executables.ts`、`types.ts`、`byok-opencode.ts`、`acp-*-failure.ts`、`chat-prompt-inputs.ts:991-993`、`chat-run-records.ts`、`run-lifecycle-analytics.ts` 中的 AMR/Vela 分支。
- 媒体：`media/models.ts` 里的 `vela` 托管供应商。
- web：约 76 个文件提到 Vela（钱包、套餐、团队、登录、分享查看器等）。
- `x-pixo-workspace-*` 请求头：服务端读取、web 和 CLI 发送。

### 4.2 关于 ADR 0006 的保护范围

ADR 0006 规定不能删运行时适配层（`runtimes/`、`agent-protocol/`）。本节删除的是其中 **AMR 这一个适配器**和各处的 AMR/Vela 分支，因为它只服务于 Vela 云；通用的运行时引擎、`agent-protocol/`、Codex/Claude Code/OpenCode 等适配器和它们的录制数据都不动。用户已要求移除 Vela，这条例外以此为准；在第 6 节的 ADR 0007 里写明。

### 4.3 步骤

1. **抽出本地项目权限检查**：新建 `apps/daemon/src/projects/project-access.ts`（目录名按 `apps/AGENTS.md` 和 daemon 的约定调整），提供和现在相同签名的 `createAuthorizeProjectRequest` / 数据面检查，但只保留本地单用户语义：项目存在、属于本机数据目录（或导入项目的 `metadata.baseDir`）、现有的 token/来源校验不变。团队工作区、`getWorkspaceProject*`、Vela 身份分支全部去掉。19 个使用方改 import。单独提交，并跑这些路由的 focused 测试和 `e2e/tests/dialog/`、`e2e/tests/collab/headerless-mutation.test.ts` 里仍然适用的用例（`collab/` 下的其余用例随协作模块删除）。
2. **删除 `x-pixo-workspace-*` 请求头**：服务端、web 请求、CLI 请求一起删。
3. **删除 AMR 适配器和运行时里的 AMR/Vela 分支**（见 4.1 列表）；`mocks/` 里的 `vela` mock CLI 和对应 trace；`media/models.ts` 的 `vela` 供应商。运行时改动后，按根 `AGENTS.md` 的要求用 `mocks/` 回放 Codex、Claude Code、OpenCode 的录制，确认事件形态不变。
4. **删除协作模块和 Vela 集成**：`apps/daemon/src/collab/`（约 109 个文件）、`integrations/vela*.ts`、`collab-cloud.ts`、`share-viewer-origin.ts`、`routes/vela.ts`、`routes/collab-*.ts`、`db.ts` 里的协作 store 和表、`packages/contracts/src/api/collab.ts` 及相关类型、`metrics/workspace-authority.ts`、`plugins/local-source.ts` 的团队资源分支、`routes/library.ts` 的工作区上下文分支，以及第 3 节留下的 `services/skill-catalog.ts` 里的团队工作区分支。
5. **删除 web 侧的 Vela / 团队 / 钱包 / 套餐 / 分享 UI** 和 i18n 键；`EntryNavRail.tsx`、`SettingsDialog.tsx` 里的本地账号区域保留布局（云积分计划要复用），只去掉 Vela 菜单项。
6. 删除 AMR 钱包相关 spec（`specs/current/amr-wallet-*.md`）、`specs/current/collab-sse-vela-push.md`、`specs/current/touchpoint-realtime-vela-handoff.md` 等只描述 Vela 的文档，更新 `openpixo-internal/docs/CLOUD-CREDITS-LAUNCH-PLAN.md` §2 里指向已删代码的行号引用。

建议提交：`refactor(daemon): extract local project access` → `refactor!: drop workspace request headers` → `refactor!: delete AMR runtime adapter and Vela media provider` → `refactor!: delete collaboration and Vela integrations` → `refactor!: delete Vela and team UI`。

## 5. 收尾：删除产品开关机制

四项都删完后，`PRODUCT_SURFACES` 里剩下的开关（`designSystems`、`deckTemplates`、`figmaImport`、`brands`、`critiqueTheater`、`velaCloud`、`teamCollaboration`、`teamBilling`）对应的代码都不存在了：

- 删掉 `PRODUCT_SURFACES`、`ProductSurface`、`isProductSurfaceEnabled`，以及所有调用点（目前 `apps/web/src/App.tsx`、`components/home-hero/chips.ts`、`NewProjectPanel.tsx` 等里还有 `deckTemplates` 判断，它们守的是已删除的 PPT 入口，直接删掉判断和被守的分支）。
- `apps/web/src/features/productResources.ts` 的 `isProductResourceEnabled`：如果剩下的目录项都不再需要过滤，整个文件删掉；如果还有要隐藏的项（例如第一轮留下待定的 507 个插件和 skills），保留过滤，但改成不依赖 `PRODUCT_SURFACES` 的明确列表。
- 根 `AGENTS.md` “Product and fork status”里关于 `PRODUCT_SURFACES` 和继承面的段落按新现状改写。

## 6. 文档与报告

- 新增或补充 `docs/adr/0007-*.md`（如果阶段 7 还没建，这里先建，后续阶段补内容）：记录删除了这四个域、AMR 适配器例外、本地项目权限的新语义、不写迁移。
- 在 `docs/coordination/PHASE1-REMOVAL.md` 追加一节，按第 1 节的顺序列出每个提交、做了什么、验证命令和结果。
- `openpixo-internal/docs/coordination/STATUS.md` 追加一行进度。

## 7. 不在本次范围

- 第一轮留下待定的 507 个插件和 skills（`docs/coordination/PHASE1-CATALOG-REVIEW.md`），等用户决定。
- 阶段 2 及以后的改名（`od`、`PIXO_*`、`@openpixo`、CSS 前缀等）。本次删除时不要顺手改名，新建的中性模块用现有的命名风格即可。

## 8. 完成标准

- `rg -n -i 'design-?system|designkit|brand-routes|od-?next|OdNext|vela|\bamr\b|collab|x-pixo-workspace|PRODUCT_SURFACES|isProductSurfaceEnabled' apps packages tools e2e scripts mocks` 只剩无关命中（例如通用英文单词或已说明的保留项），每一条在报告里有解释。
- 游戏主线冒烟通过：`game-workspace.test.ts` 和隔离 namespace 里的 mock 对话。
- `pnpm guard`、`pnpm typecheck`、各包 build（daemon、web、desktop、packaged、tools-dev、tools-pack）、受影响的 focused 测试全部通过。
- `LICENSE`、`NOTICE` 的上游署名没动；运行中的 Alpha.3 实例没被碰过。

## 9. 第二轮补充（2026-10-27，用户决定）

第一轮执行（`1fff2546..5850cecf`）完成了第 2、3 节和 4.3 第 1 步，停在图库搜索上（见 `docs/coordination/PHASE1-REMOVAL.md` “The section 4 stopping condition”）。第二轮按下面的决定继续：

1. **图库搜索直接退役，不找替代供应商。** 接口、CLI、契约、遥测、测试、文档一起删：`apps/daemon/src/media/stock-search.ts`、`media/vela-stock-search.ts`、`media/stock-telemetry.ts`，`routes/media.ts` 里的 `STOCK_SEARCH_TOOL_ENDPOINT` 和 `/api/projects/:id/media/stock-search`，`cli.ts` 的 `pixo media stock-search` 子命令、帮助文本和 `MEDIA_STOCK_SEARCH_*` 标志集，`tool-tokens.ts` 里的对应授权，`analytics.ts` 里的图库事件，`packages/contracts/src/api/media-stock.ts`、`analytics/media-stock.ts` 和 `event-payload.ts` 里的对应部分，`apps/daemon/tests/media-stock-*.test.ts`、`packages/contracts/tests/media-stock-contract.test.ts`、`tests/runtimes/agent-runtime-env.test.ts` 里的相关断言，`docs/media-stock-telemetry.md`，以及根 `AGENTS.md`、`CLOUD-CREDITS-LAUNCH-PLAN.md`、ADR 0007 里的提及。web 端目前没有图库搜索界面，如有零散入口一并删。图库搜索退役后，第 4 节的停止条件不再成立，继续执行 4.3 第 2–6 步和第 5 节。
2. **删除 `docs/coordination/PHASE1-DECOUPLING-RG.md`**（第一轮提交的 2.1 万行逐条命中清单）。以后第 8 节的复查结果只在 `PHASE1-REMOVAL.md` 里写摘要：按类别统计剩余命中数，逐条解释只写真正保留的那些（例如通用英文单词、`LICENSE`/`NOTICE`），不提交逐条清单文件。
3. **清理失效的 web 测试。** 第一轮报告列出约 50 个失败用例（`EntryShell.onboarding.test.tsx` 的 AMR 引导、`HomeView.*` 里的设计系统、retired design strategy、PPT 断言等），另外 `apps/web/tests` 里还有约 270 个文件提到已删除或将删除的概念。做法：所有删除完成后，把 `apps/web/tests` 下内容命中 `design-?system|designSystem|odNext|pixo-next|\bamr\b|vela|Vela|deckTemplates|stock|brand|collab|workspace-?team|PRODUCT_SURFACES|isProductSurfaceEnabled` 的测试文件分批跑完（这是用户要求的专项清理，允许跑这一批，但仍不跑 web 全量套件）。对每个失败用例：断言的是已删除功能的，删掉用例（整个文件都是就删文件）；断言的是保留功能、只是 fixture 过时的，改 fixture；暴露出保留功能的真实回归的，修代码并在报告里单列。最后这一批文件必须全部通过，不留排除项（第一轮已登记、并在 `1fff2546` 上复现过的 Windows 环境性失败除外，逐个列出）。daemon、contracts、e2e 里引用已删除功能的测试同样处理。
4. **删除已删功能遗留的 skills 和插件**：`skills/pixo-next-media-inputs`（retired design strategy）、`skills/brand-extract`、`skills/brand-guidelines`、`skills/brandkit`（brands）、`skills/figma-create-design-system-rules`（Figma、设计系统），以及 `plugins/` 下只服务于已删除的设计系统、brands、retired design strategy、Vela 的条目。删前确认游戏路径、recipes、Studio、素材工具都没有引用。第一轮留下待定的 507 个条目里不属于这几个已删功能的，仍然不动。
