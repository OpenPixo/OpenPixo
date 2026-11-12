# OpenPixo Phase 2：多 Agent 接入实施规格

状态：2026-10-26 已实现切片 1、2、4（注入接口、能力矩阵、Claude 应用内审批、OpenCode 审批判定为不支持并改用 `--auto`）。未做：切片 3 的录制/金样回放、§6 真实 CLI 验收（本机未装 Claude Code）；矩阵暂无 `verified` 格。所属版本 v0.2。上游：路线文档 §4 Phase 2 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`)。已定：Claude Code 和 OpenCode 与 Codex 同一阶段产品化（决策记录 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`) 第 3 项）。

改运行时流解析前先读根 `AGENTS.md` 的 "Agent runtime conventions" 和 `apps/daemon/tests/fixtures/claude-cli-recordings/README.md`。

## 1. 目标

同一个游戏项目可以在 Codex、Claude Code、OpenCode 之间切换，并且项目里启用的 skills 和 MCP、审批、中断、恢复、子代理在三者上都真实可用。做不到的格子在 UI 里如实标出，不靠宣传口径。

不在本阶段：自建多 Agent 调度器。运行时现仅保留 Codex、Claude Code、OpenCode 及 BYOK OpenCode；其余未认证运行时已在 slim-core 第 6 批删除。

## 2. 现状与缺口

| 能力 | Codex | Claude Code | OpenCode | 证据 |
| --- | --- | --- | --- | --- |
| 项目 skill 正文 | ✅ 追加到提示词 | ✅ 同左 | ✅ 同左 | `server.ts:12990` 对所有运行时拼接 `projectExtensions.skills` |
| 项目 MCP | ✅ 线程 RPC 注入 | ❌ | ❌ | `server.ts:14288` 只构造 `codexMcpServers` |
| 全局外部 MCP | 依赖 Codex 自身配置 | ⚠️ 只在托管项目目录写 `.mcp.json` | ✅ `OPENCODE_CONFIG_CONTENT` | `server.ts` 约 13870 行 `isManagedProjectCwd` 条件；导入的游戏目录不满足 |
| 应用内审批 | ✅ `routes/codex-approvals.ts` | ❌ 固定 `--permission-mode bypassPermissions` | ❌ 支持时追加 `--dangerously-skip-permissions` | `defs/claude.ts:116`、`opencode-permissions.ts` |
| 中途引导 | 不适用 | ✅ stream-json | ❌ | `run-steering.ts` |
| 子代理归属 | ✅ `codex-child-evidence.ts` | ✅ `claude-child-evidence.ts` | ✅ `opencode-child-evidence.ts` | 各自 child evidence |
| 能力声明 | `capabilities.ts` 只有一个空 Map，靠 `--help` 探测 flag | 同左 | 同左 | — |

两个缺口要优先处理：

1. 导入的游戏目录拿不到 Claude 的 MCP。按产品原则也**不能**往用户的游戏仓库写 `.mcp.json`。
2. Claude 和 OpenCode 跳过权限运行，与范围中「权限请求在应用内呈现」的要求冲突。

## 3. 设计

### 3.1 运行时扩展注入接口

新文件 `apps/daemon/src/runtimes/extension-injection.ts`：

```ts
export interface RuntimeExtensionInput {
  runId: string;
  /** Run-scoped scratch dir under the daemon data root (never the game folder). */
  runScratchDir: string;
  projectMcpServers: ProjectMcpServer[];   // enabled, tokens already resolved
  globalMcpServers: ExternalMcpServer[];   // existing enabledExternalMcp
  projectSkills: Array<{ id: string; dir: string; body: string }>;
}

export interface RuntimeExtensionPlan {
  args: string[];
  env: Record<string, string>;
  /** Written with owner-only permissions before spawn, removed when the run ends. */
  files: Array<{ path: string; content: string }>;
  /** Codex-only: native thread RPC config. */
  rpcConfig?: unknown;
  /** Exact strings to redact from run output. */
  secrets: string[];
  /** Cells this plan could not satisfy, surfaced as run warnings. */
  unsupported: Array<'project-mcp' | 'global-mcp' | 'skill-files'>;
}

export interface RuntimeExtensionInjector {
  readonly id: 'codex-rpc' | 'claude-mcp-config' | 'opencode-config-content';
  plan(input: RuntimeExtensionInput): RuntimeExtensionPlan;
}
```

`RuntimeAgentDef` 使用 `extensionInjector?: RuntimeExtensionInjector['id']`，由三个保留运行时的实现负责注入。未认证运行时及其 ACP 注入路径已删除。

三个实现：

- **codex-rpc**：把 `codexProjectMcpConfig` 和 `codexOutputSecrets` 的现有逻辑搬进来，行为不变（回归测试锁定）。
- **claude-mcp-config**：把「全局 + 项目」MCP 合并成 Claude 的 MCP JSON，写到 `runScratchDir`，参数追加 `--mcp-config <file>`。不加 `--strict-mcp-config`，保留用户自己的 Claude 配置。flag 通过 `capabilityFlags` 探测，探测不到时 `unsupported: ['project-mcp','global-mcp']`。skill 附带文件通过 `--add-dir <skill dir>` 放行读取，正文仍走提示词。
- **opencode-config-content**：在现有 `buildOpenCodeMcpConfigContent` 的输入里并入项目 MCP。

OAuth token 只出现在 scratch 文件或环境变量里，不进 argv，并加入 `secrets` 做输出脱敏。run 结束（含崩溃恢复路径 `run-restart-recovery.ts`）删除 scratch 文件。

### 3.2 应用内审批

把 Codex 专用的审批会话泛化为运行级审批：

- 契约：`packages/contracts/src/api/codex-approvals.ts` 改名或新增 `run-approvals.ts`，审批请求带 `runtime`、`tool`、`summary`、`paths`、`command` 字段。旧 `CODEX_APPROVAL_*` 错误码保持兼容。
- 路由：`/api/runs/:id/approvals` 保持路径不变，后端从 `run.codexApprovalSession` 改为按运行时选择的 `run.approvalSession`。

**Claude Code**：用 `--permission-mode default` 加 `--permission-prompt-tool mcp__openpixo_approvals__request`。审批工具由 daemon 以 stdio MCP 提供（`pixo mcp approvals`，与现有 `pixo mcp live-artifacts` 同样的形态），收到请求后挂起，直到用户在 UI 里批准或拒绝，再返回 Claude 规定的允许/拒绝结构。超时按拒绝处理。

**OpenCode**：先做探针，确认两件事：OpenCode 插件 API 的权限钩子能否拦截 ask 型权限（现有 `opencode-event-plugin.ts` 已证明插件可以随包注入）；`opencode run` 非交互模式下 ask 权限的实际行为。可行就由随包插件把请求转给 daemon；不可行就保留跳过权限，能力格标为「不支持」，UI 在选择 OpenCode 时明确提示「此运行时不会请求批准」。

审批模式设置：每个运行时可选「应用内批准」（默认，验证通过后）或「跳过权限」（显式开启并有警告文案）。

### 3.3 能力矩阵

契约 `packages/contracts/src/api/agent-capabilities.ts`：

```ts
export type CapabilityCell =
  | 'project-skills' | 'project-mcp' | 'global-mcp' | 'approvals'
  | 'interrupt' | 'resume' | 'steer' | 'sub-agents' | 'image-input'
  | 'media-cli' | 'game-verify' | 'plan-mode';

export interface CapabilityEvidence {
  state: 'verified' | 'implemented' | 'unsupported' | 'unknown';
  /** CLI version the state was established on, e.g. "codex 0.160.0". */
  testedVersion?: string;
  /** Test file or acceptance record id. */
  evidence?: string;
  note?: string;
}

export type RuntimeCapabilityMatrix = Record<string /* runtime id */, Record<CapabilityCell, CapabilityEvidence>>;
```

- 数据源：仓库内的静态表 `packages/contracts/src/runtime/capability-matrix.ts`，人工维护，每次改动都要附测试或验收记录。运行时实测（`--help` 探测、已安装版本）在 daemon 侧叠加：若已安装版本高于 `testedVersion`，相关格降为 `implemented` 并提示「新版本未验证」。
- 接口：`GET /api/agents/capabilities`、`pixo agent capabilities [--agent <id>] [--json]`。
- UI：设置里的运行时页显示矩阵；对话框选择运行时时，若当前项目启用了该运行时不支持的项（如项目 MCP），在输入框上方给出一行提示。

### 3.4 录制与升级前回放

完全硬分叉后没有上游兜底（ADR 0006），所以：

- 每个产品化运行时在 `mocks/recordings/` 增加一组**游戏夹具场景**录制：改代码、调用 `pixo media generate`、调用 `pixo game verify`、触发一次审批、被中断、恢复、派生子代理。
- 新增回放检查：对每个录制跑一遍解析器，断言事件序列与金样（`mocks/golden/`）一致。
- 升级流程：用户机器上检测到的 CLI 版本高于矩阵的 `testedVersion` 时，开发者先用新版 CLI 重录场景、跑回放，通过后再更新矩阵。这一流程写进 `mocks/README.md`。

## 4. 实施切片

1. **接口与 Codex 迁移**：`extension-injection.ts`、`codex-rpc` 实现，server.ts 改为调用接口；行为与现状逐字节一致。
2. **矩阵契约 + API + CLI + 设置页**（先填现状，多数格为 `unknown`）。
3. **共用测试夹具**：游戏夹具项目、假 MCP 服务器（stdio + HTTP 各一个，提供一个能观察到调用的工具）、审批触发脚本。
4. 以下两条并行：
   - **Claude Code**：`claude-mcp-config`、`pixo mcp approvals`、审批泛化、录制。
   - **OpenCode**：`opencode-config-content` 并入项目 MCP、审批探针与实现（或明确不支持）、录制。
5. **逐格验收**并更新矩阵。

切片 1–3 合并之前不开始 4，避免两边各写一套。

## 5. 测试

- 注入：每个 injector 的单测断言参数、环境变量、文件内容；断言 token 不出现在 argv；断言 scratch 文件位于 daemon 数据根的运行目录而非游戏目录；断言 run 结束后文件被删除。
- 审批：Claude 审批 MCP 的挂起、批准、拒绝、超时、run 被中断时自动拒绝；Codex 现有审批回归不变。
- 回放：三个运行时的游戏夹具录制全部通过金样比对。
- 矩阵：契约测试保证每个产品化运行时每个格都有值；`testedVersion` 低于已安装版本时降级逻辑。
- e2e：同一夹具项目依次用三个运行时（mock CLI）执行「调用项目 MCP 工具」任务，断言假 MCP 服务器收到调用。

## 6. 验收

需要真实 CLI 和用户批准的模型用量：

1. 三个运行时各跑一次真实任务：调用一个项目 MCP 工具、使用一个项目 skill、生成一张图、运行 `pixo game verify`。
2. Claude Code 至少一次写文件操作弹出应用内审批，拒绝后文件未被修改，批准后修改生效。
3. 中断和恢复在三者上表现与矩阵一致。
4. 矩阵里所有 `verified` 格都有对应证据；其余格在 UI 中如实显示。

## 7. 开放问题

- `--permission-prompt-tool` 在当前 Claude Code 版本里的返回结构需按真实 CLI 核实，结构变化时以录制为准。
- OpenCode 是否能拦截权限决定了它的审批格最终是「支持」还是「不支持」。
- 子代理（Claude Task、Codex 子线程）在审批时的归属显示，需要和执行记录的父子结构一起设计。
