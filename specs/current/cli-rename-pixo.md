# CLI 可执行名 `pixo`（执行单）

> 已完成的历史执行单；改名结果和回归政策见 [ADR 0011](../../docs/adr/0011-remove-upstream-identifiers.md)。下文保留当时的改动范围，当前保留模块以 [ADR 0012](../../docs/adr/0012-slim-core.md) 为准。

> 这是 `specs/current/remove-upstream-traces.md` 总计划的阶段 2。阶段 1 已完成。执行时采用仓库所有者确认的覆盖规则：留在 `codex/opendesign-base` 本地提交，不创建分支、PR 或推送；使用 ADR 0008，因为 ADR 0007 已用于领域解耦。旧名和改名理由保存在 [ADR 0008](../../docs/adr/0008-cli-binary-pixo.md)。

## 1. 决定

- OpenPixo 的命令行可执行名统一为 **`pixo`**。
- **不保留旧可执行名的兼容别名**：当前没有老用户、没有已发布的安装包，不需要过渡期。仓库中的调用说明统一使用 `pixo …`。
- 没选 `op`：1Password CLI 就叫 `op`，开发者机器上很常见，会撞名。
- 改名也避免了与 macOS/Linux 八进制转储工具的冲突；背景见 ADR 0008。源码 clone 的 MCP 安装仍使用绝对路径，避免依赖全局 PATH。

## 2. 范围

### 要改

| # | 内容 | 位置 |
|---|---|---|
| A | 统一常量 | 在 `packages/contracts/src/product.ts` 新增 `export const PRODUCT_CLI_NAME = 'pixo';`。`index.ts` 已经 `export * from './product.js'`，daemon 和 web 都能从 `@openpixo/contracts` 引用。 |
| B | 可执行文件 | 用 `git mv` 将继承入口重命名为 `apps/daemon/bin/pixo.mjs`；更新 `apps/daemon/package.json` 的 `bin`（`"pixo": "./bin/pixo.mjs"`）、根 `package.json` 的 `bin`、`scripts/guard.ts` 的 JS 白名单。把入口报错里的 “OpenDesign daemon” 改成 “OpenPixo daemon”。 |
| C | MCP 默认启动命令 | `apps/daemon/src/cli.ts` 的 fallback MCP `command`、`apps/daemon/src/runtimes/mcp.ts` 的默认 `command` 改为引用 `PRODUCT_CLI_NAME`。这两处会写进用户的 MCP 配置。 |
| D | CLI 帮助文本和提示 | `apps/daemon/src/cli.ts`（约 390 行帮助和用法文本）以及 `apps/daemon/src/**/*-cli.ts`（`tools-connectors-cli.ts`、`recipes/recipe-cli.ts`、`services/project-extensions-cli.ts`、`tools-live-artifacts-cli.ts` 等）。TS 字符串一律用 `${PRODUCT_CLI_NAME}` 插值，不要再手写字面量。 |
| E | daemon 其他源码里的命令说明 | `apps/daemon/src/**` 中的报错、提示、注释，例如 `plugins/validate.ts`、`server.ts`、`routes/collab-sync.ts`、`media/index.ts`。 |
| F | Prompt 文本 | `apps/daemon/src/prompts/**` 和 `packages/contracts/src/prompts/**`，重点是游戏路径 `packages/contracts/src/prompts/openpixo-game.ts` 的 `pixo recipe list`、`pixo media generate`。改之前必须读 `docs/prompt-composition.md`。daemon 和 contracts 两边的镜像要保持一致。 |
| G | Web UI | `apps/web/src/components/use-everywhere/sections.ts`、`components/design-files/pluginFolderActions.ts`、`SettingsDialog.tsx` 等。i18n 方面：`locales/en.ts`、`locales/zh-CN.ts` 和其余 17 个语言文件里写到命令的地方都改，只替换命令名，不动原有译文。 |
| H | 内容目录 | `plugins/**`、`skills/**`、`design-templates/**` 里的命令说明。这些 Markdown 会原样发给模型，只改命令名，不要写入任何维护说明。阶段 1 已删除的内容无需处理。 |
| I | 测试 | `apps/daemon/tests/**`、`apps/web/tests/**`、`e2e/**`、`tools/pack/tests/**` 中断言或引用命令名的地方，例如 `e2e/lib/fake-agents.ts:714-716`、`e2e/tests/collab/headerless-mutation.test.ts`、`e2e/specs/web-clone/main.spec.ts`、`apps/web/tests/components/use-everywhere-agent-guide.test.ts`、`apps/daemon/tests/runtimes/claude-approval-args.test.ts`、`tools/pack/tests/mac-lifecycle.test.ts`。 |
| J | 文档 | 根目录和各层 `AGENTS.md`、`docs/**`、`specs/**`、`README*.md`、`QUICKSTART.md`、`CONTRIBUTING.md`。“UI/CLI 双轨”一节里的 `pixo <capability>`、`pixo media …` 等示例都要改。 |
| K | ADR | 新增 `docs/adr/0008-cli-binary-pixo.md`：记录本次决定、无别名理由和有意保留的内部标识。在 ADR 0006 追加说明其可执行名决定已由 ADR 0008 取代；历史正文保留。根 `AGENTS.md` 的兼容标识列表移除旧 binary，另列 `pixo`。 |

### 本阶段不改（带 `od` 字样，但不是命令名；由 `specs/current/remove-upstream-traces.md` 的后续阶段统一改名或删除，这里不要顺手改）

- **所有 `OD_*` 环境变量**，包括 `OD_BIN`、`OD_NODE_BIN`、`OD_DAEMON_CLI_PATH`、`OD_DATA_DIR`、`OD_PROJECT_ID`。prompt 和插件里的 `"$OD_NODE_BIN" "$OD_BIN" media generate …` 保持原样。agent 用这种绝对路径调用，本来就不依赖命令名。
- 包作用域（阶段 2 不改；阶段 3 已按 ADR 0009 统一为 `@openpixo/*`）。
- 插件 manifest 的 `od` 字段（`manifest.od`、`PluginManifest['od']`），以及导出目标 `'od'`（`apps/daemon/src/plugins/export.ts:29`、`cli.ts:3607`、`server.ts:10053`）。这是插件格式，不是命令。
- 已在阶段 1 删除的策略、品牌、设计系统和 Vela 等领域无需处理；其余仍存在的产物类型和 `od-notifications-sw.js` 不改。
- 项目里的 `.od/` 目录、`x-od-*` HTTP 头、持久化键、CSS 标识、sidecar 协议名。
- `od://` 系统协议（`apps/packaged/src/protocol.ts:3`）。它属于打包身份（ADR 0005、`openpixo-internal/docs/coordination/PACKAGING.md`），要改另开任务；如果发现它和 ADR 0005 冲突，在 PR 的 “Adjacent issues” 里写明。
- 已归档的上游文档 `docs/spec.md`、`docs/roadmap.md`，以及 git 历史。
- `/usr/bin/od` 相关注释：保留这层逻辑（源码 clone 用绝对路径仍然是对的），只把注释改成说明历史原因，或者在不再适用的地方删掉。

## 3. 查找方法

先列出候选位置，再逐条人工判断，**不要全局 sed**。字符类拼写与旧名等价，并避免执行单自匹配：

```bash
rg -n --hidden -g '!**/node_modules/**' -g '!**/dist/**' -g '!.git' -g '!.tmp' -g '!.cache' \
  -e '(^|[^A-Za-z0-9_$./-])o[d] (media|project|plugin|mcp|automation|extensions|tools|run|daemon|recipe|asset|assets|skill|skills|comment|account|store|game|chat|library|login|credits|studio|status|help|version|--help)\b' \
  -e 'Usage: o[d]\b' -e '`o[d]`' -e "command: 'o[d]'" -e "command = 'o[d]'" -e 'o[d]\.mjs' -e 'bin/o[d]\b'
```

改完再跑一遍，并补查未列出的子命令、PATH 检查和任意参数调用。剩下的命中只能是第 2 节“不改”里的内容、ADR 0006 的历史正文，或者 ADR 0008 中对旧名的说明。

## 4. 执行顺序

1. 按仓库所有者确认的覆盖规则，留在 `codex/opendesign-base`，不创建新分支。
2. 按 A → B → C → D/E → F → G → H → I → J → K 的顺序改。每一类改完就跑对应的 focused 测试，不要攒到最后。
3. 改完 bin 以后运行 `pnpm install`（AGENTS.md 要求：改 bin 或入口后必须重新安装）。
4. 在 PowerShell 里先按 AGENTS.md “Windows”一节把 `.cache\toolchain` 加到 `PATH`。

## 5. 验证

- `pnpm guard`
- `pnpm typecheck`
- `pnpm --filter @openpixo/daemon build`，然后 `node apps/daemon/bin/pixo.mjs --help`：帮助里只出现 `pixo`。
- `pnpm install` 之后，`pnpm exec pixo --help` 能用，`pnpm exec od` 找不到。
- focused 测试，只跑受影响的文件，**不要跑 daemon 或 web 全量套件**：
  - `pnpm --filter @openpixo/daemon test -- tests/prompts tests/runtimes/claude-approval-args.test.ts tests/mcp-install-info.test.ts tests/cli-startup.test.ts`，再加上第 I 类里改过的其他 daemon 测试；
  - `pnpm --filter @openpixo/web test -- tests/i18n/locales.test.ts tests/components/use-everywhere-agent-guide.test.ts`，再加上改过的其他 web 测试；
  - 改过的 e2e 测试按 `e2e/AGENTS.md` 的方式单独跑；
  - `tools/pack/tests/mac-lifecycle.test.ts` 如果在 Windows 上跑不了，在 PR 里说明。
- 第 3 节的 `rg` 复查结果为空，或者只剩“不改”清单里的内容。
- **不要**跑任何 live 模型或 provider 测试。

## 6. 提交与 PR

- 提交信息用 Conventional Commits，例如 `refactor(cli)!: rename od binary to pixo`，并在正文写明 `BREAKING CHANGE: the CLI binary is now pixo; od is removed`。
- **不加** `Co-authored-by` 或其他共同作者信息（根 `AGENTS.md` “Git commit policy”）。
- 按仓库所有者确认的覆盖规则，仅在当前分支本地提交，不创建 PR、不推送。最终报告记录提交、各区域替换数量、剩余检索命中的理由及每条验证命令的结果。

## 7. 完成标准

- 除已归档上游文档外，仓库的调用说明统一使用 `pixo …`，旧可执行入口已删除。
- TS 代码中的命令名都来自 `PRODUCT_CLI_NAME`。以后再改名，代码层只需要改这一处，Markdown 内容另外替换。
- 第 2 节“不改”清单里的标识一处都没被动过。
- `pnpm guard`、`pnpm typecheck` 和上面的 focused 测试全部通过，最终报告附上命令结果。
