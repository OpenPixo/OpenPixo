# Run and build OpenPixo / 运行与构建

Updated / 更新：2026-10-25 (Asia/Tokyo). Verified local unsigned build / 已验证本地无签名构建：`0.1.0-alpha.2`，source / 源码 `c058ba3`。Source/artifact checks and actual isolated install/start/stop/cold-restart/uninstall passed / 源码、产物检查及实际隔离安装/启动/停止/冷启动/卸载通过。No real model/provider request or public release was executed / 未执行真实模型/供应商请求或公开发布。

## Requirements / 环境

Use Node **24.x**, pnpm **10.33.2** and native Codex CLI **0.160.0 or later**. Version 0.160.0 is the validated release baseline; older native installations receive explicit setup guidance. Check versions before installation. Use Corepack where available, or select the pinned pnpm through your normal toolchain. Windows may need Visual Studio Build Tools if a native dependency has no matching prebuilt binary.

请确认 Node 24.x、pnpm 10.33.2 和原生 Codex CLI 0.160.0 或更新版本。0.160.0 是已验证基线，旧版会收到明确配置引导。可用 Corepack 或现有工具链选择固定 pnpm。Windows 缺少匹配的原生预编译包时，可能需要 Visual Studio Build Tools。

## Start / 启动

Use the local adapted checkout. Public fork `main` still contains upstream `9724c441`; the adaptation has not been uploaded / 使用本地适配后的 checkout；公开 fork 的 `main` 仍为上游 `9724c441`，适配尚未上传。

```powershell
pnpm install --frozen-lockfile
pnpm tools-dev
pnpm tools-dev status --json
```

The existing lifecycle tool starts the local daemon, Web interface and Electron shell. To run only daemon + Web in the foreground:

现成的生命周期工具统一启动 daemon、Web 和 Electron；仅运行前台 Web 开发循环可用：

```powershell
pnpm tools-dev run web --daemon-port 18456 --web-port 18573
```

Use the URL reported by the tool. Ports are controlled by `--daemon-port` and `--web-port`. For shutdown, run `pnpm tools-dev stop`.

使用工具实际输出的 URL；端口通过上述参数控制。关闭使用 `pnpm tools-dev stop`。

Storage and daemon data-root rules are defined only in [AGENTS.md — Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract). A namespace label alone does not establish daemon data isolation.

数据目录规则统一见上述 AGENTS 文档。仅设置 namespace 名称不代表 daemon 数据已经隔离。

## This workspace's local toolchain / 本工作区的本地工具链

The implementation workspace has Node 24.22.1 and pnpm 10.33.2 in ignored `.cache/toolchain/`. This is a local convenience, excluded from Git and public builds. From the repository root in PowerShell:

当前实施工作区已在被 Git 忽略的 `.cache/toolchain/` 中准备固定工具链。它不是公开仓库内容；在仓库根目录的 PowerShell 会话中可用：

```powershell
$toolchainRoot = Join-Path (Get-Location) '.cache\toolchain\node_modules'
$env:Path = (Join-Path $toolchainRoot 'node\bin') + ';' + (Join-Path $toolchainRoot '.bin') + ';' + $env:Path
node --version
pnpm --version
pnpm tools-dev
```

This changes only the current shell environment. It does not replace global Node/pnpm installations.

这些命令仅影响当前 shell 环境，不替换全局 Node/pnpm。

## First project / 首次打开项目

1. Select Local AI, choose Codex, and use the existing detection/configuration flow. An authenticated Codex installation is required for model tasks.
2. Open your existing game folder. Imported project files stay in that selected folder.
3. Use Assets to preview/filter files and select original file references for chat. Use Files for the inherited file workspace.
4. Use Extensions to manage project skills/MCP, inspect requirements and enable the entries needed by a task.
5. Send a bounded task. Review output and permissions, inspect the produced files, and interrupt the run when needed.

对应流程：本地 AI → Codex 配置 → 打开游戏文件夹 → 素材/文件/扩展 → 发送任务并检查输出与审批。本地工作流不需要 OpenPixo 平台账号。

DeepSeek/OpenRouter canonical OpenAI presets now use native Codex Responses through the existing API form, credential storage and model draft. UI, local HTTP and CLI use the same provider classification. Missing runtime/key or known unsupported selections fail before spawning; there is no default-account or OpenCode substitution. No real provider task has been verified. Responses Test checks service connectivity only.

标准 DeepSeek/OpenRouter OpenAI 预设已通过现有 API 表单、凭据存储和模型草稿接入原生 Codex Responses，UI、本地 HTTP 与 CLI 共用供应商判定。缺少运行时/密钥或已知不支持的选择在启动前明确失败，不改用默认账号或 OpenCode。尚未验证真实供应商任务；Responses“连接测试”只证明服务连通性。

## Native provider fields / 原生供应商字段

| Field / 字段 | DeepSeek | OpenRouter |
| --- | --- | --- |
| Protocol / 协议 | Existing OpenAI preset / 现有 OpenAI 预设 | Existing OpenAI preset / 现有 OpenAI 预设 |
| Base URL / 基础地址 | `https://api.deepseek.com` | `https://openrouter.ai/api/v1` |
| Model / 模型 | `deepseek-flash` (text/image), `deepseek-v4-pro` (text) | Exact complete `organization/model` slug; native discovery preserves returned capabilities |
| Credential / 凭据 | Provider key; dedicated child environment | Provider key; native command-auth helper reads a dedicated child environment |
| Native baseline / 原生基线 | Codex CLI 0.160.0 validated | Codex CLI 0.160.0 validated |

Optional trailing slashes are normalized. Other gateways, URL ports/credentials/query/fragment and alternative protocols are outside this native classification. DeepSeek reasoning is `low`, `high` or `max`; forced summaries are disabled. Known unsupported Pro image input and unsupported model/reasoning selections fail before spawn. OpenRouter modalities depend on the returned model metadata. These declarations do not verify image generation or a real tool task.

可选末尾斜杠会被规范化；其他网关、URL 端口/凭据/查询/片段及替代协议不属于此原生判定。DeepSeek 推理选择为 `low/high/max`，不强制生成摘要；已知不支持的 Pro 图像输入、模型/推理选择在启动前失败。OpenRouter 能力保留其模型元数据，不能据此声称图像生成或真实工具任务已验收。

Third-party provider/model/credential identity scopes its native home and resume identity under the daemon data-root contract. User Codex home/config/auth files are not rewritten; default account-backed Codex keeps its existing behavior. Settings retains its existing scoped credential store. Keys are omitted from persisted run records, project files and argv. See [runtime contract](coordination/RUNTIME.md) and [provider audit](coordination/PROVIDER-FIDELITY.md).

第三方供应商/模型/凭据身份用于隔离原生 home 与续跑身份，遵循 daemon 数据根契约；不改写用户 Codex home/config/auth，默认账号路径保持既有行为。Settings 仍使用现有作用域凭据存储，密钥不写入运行记录、游戏文件或 argv。

### CLI start and continue / CLI 开始与续跑

The existing `pixo` CLI must address the running daemon. Replace `PROJECT_ID`, `RUN_ID` and `PROMPT_FILE` below. Put the provider key in the named environment variable first; the flag carries its name, never the key value.

既有 `pixo` CLI 需连接正在运行的 daemon。替换以下 `PROJECT_ID`、`RUN_ID`、`PROMPT_FILE`，先在命名环境变量中提供供应商密钥；参数只携带变量名，不携带密钥值。

```text
pixo run start --project PROJECT_ID --byok-protocol openai --byok-base-url https://api.deepseek.com --byok-key-env DEEPSEEK_API_KEY --model deepseek-flash --prompt-file PROMPT_FILE --json
pixo run continue RUN_ID --byok-protocol openai --byok-base-url https://api.deepseek.com --byok-key-env DEEPSEEK_API_KEY --model deepseek-flash --prompt-file PROMPT_FILE --json
```

For OpenRouter, use `https://openrouter.ai/api/v1`, your named key variable and exact `organization/model`. `continue` needs no `--project`; it also accepts `--message` or `--prompt-file`, plus `--json` or `--follow`.

**Every provider continuation must resupply `--byok-protocol`, `--byok-base-url` and `--byok-key-env`; always resupply `--model` to preserve the exact configuration.** The provider snapshot and key are not persisted with the run. CLI reads the named environment, passes the key in the existing local API's in-memory request and then to a dedicated child environment; it is not confined to environment storage during that handoff, and is excluded from persistent run output.

OpenRouter 改用其标准地址、密钥变量名和完整模型 slug。`continue` 不需要 `--project`，可用 `--message` 或 `--prompt-file`，以及 `--json` 或 `--follow`。**每次供应商续跑必须重新提供 protocol/base-url/key-env，建议始终重供 `--model`。** provider snapshot 和密钥不随运行持久化；CLI 从命名环境读取密钥，通过现有本地 API 的内存请求传入 daemon，再进入专用子进程环境，不进入持久化运行输出。

## MCP startup feedback / MCP 启动反馈

Project MCP configuration is delivered through private native thread RPC on create/resume, keeping its arguments, environment values and HTTP headers out of process argv. Stdio and streamable HTTP are supported; legacy SSE reports an explicit unsupported transport. The default app-server path is required for project MCP.

Dependency `ready` means the executable/configuration check passed. Native startup `ready` means Codex started that server in this task; neither proves a successful tool call. Startup `failed/cancelled/reauthenticationRequired` feedback remains in the run event stream and CLI diagnostics. Actual tool results remain separate evidence.

项目 MCP 配置在创建/恢复线程时经私有原生 RPC 传入，参数、环境和 HTTP header 不进入进程 argv。支持 stdio 和 streamable HTTP，旧 SSE 明确提示不支持。依赖 `ready` 只表示命令/配置检查通过；原生启动 `ready` 表示 Codex 在本任务启动了该服务器，两者都不证明工具调用成功。失败、取消或重认证反馈保留在运行事件流与 CLI 诊断中。

## Checks / 检查

```powershell
pnpm guard
pnpm typecheck
pnpm --filter @openpixo/daemon build
pnpm --filter @openpixo/web build
pnpm --filter @openpixo/desktop build
```

Workspace packages use `@openpixo/*` and the root package is `openpixo` ([ADR 0009](adr/0009-package-scope-openpixo.md)). Run relevant focused tests through the owning package; for Vitest, pass file paths directly to `exec vitest run`:

workspace 子包使用 `@openpixo/*`，根包名为 `openpixo`。测试按所属包与改动范围执行；Vitest 文件路径直接传给 `exec vitest run`：

```powershell
pnpm --filter @openpixo/web exec vitest run tests/components/chat/codex-approvals.test.tsx --maxWorkers=1
```

Do not add root build/test/start aliases or run full daemon/Web suites merely to repeat already covered checks. Full acceptance evidence and any failures belong in delivery status (openpixo-internal: `docs/coordination/STATUS.md`).

## Windows package / Windows 打包

The frozen `0.1.0-alpha.2` source has produced local unsigned setup and ZIP files. Artifact/ZIP-integrity/metadata/notices and actual isolated installation/launch/stop/cold-restart/uninstall checks passed. The canonical build command is:

冻结的 `0.1.0-alpha.2` 源码已生成本地无签名安装包和 ZIP；产物、ZIP 完整性、元信息、许可证及实际隔离安装/启动/停止/冷启动/卸载检查通过。规范构建命令如下；旧 alpha.1 产物与清单保留。

```powershell
pnpm tools-pack win build --portable --namespace opx-a2 --app-version 0.1.0-alpha.2 --to all
```

The tool reports the actual artifact path and owns Electron/native-module compatibility. Keep namespaces short on Windows to reduce long-path friction. Build success, packaged launch, clean-machine acceptance, signing and public upload are separate gates. See packaging evidence (openpixo-internal: `docs/coordination/PACKAGING.md`) and the owner-provided local artifact manifest for availability.

工具输出真实产物路径，并管理 Electron 原生模块兼容。Windows namespace 尽量简短。构建、启动、干净环境验收、签名与公开上传分别记录；尚无公开下载源，本地产物以维护者提供的清单为准。

### Current alpha.2 files / 当前 alpha.2 文件

Local directory / 本地目录：`output/releases/0.1.0-alpha.2/`。Manifest source / 清单源码：`c058ba3d61f124a95ee22c99541ffc1ea73f4d3d`；`signed: false`。

| File / 文件 | Bytes / 字节 | SHA-256 |
| --- | ---: | --- |
| `OpenPixo-0.1.0-alpha.2-win-x64-setup.exe` | 443149607 | `0df1b404a68b87bc05b3638e094f46e5262263958b8b9f7990bce8f7e7abc0c3` |
| `OpenPixo-0.1.0-alpha.2-win-x64.zip` | 511935746 | `edb95192ae41a92c365974649ae1b28c603b75fc1db90347bfc95f2d332b9608` |

`SHA256SUMS.txt` and `manifest.json` accompany these files. They are verified local unsigned artifacts; actual install/restart/uninstall passed, and no public GitHub download has been published / 同目录保留校验表与清单。这些是已验证的本地无签名产物，实际安装/冷启动/卸载通过，尚未公开下载。

Installed alpha.2 rendered successfully and passed health, desktop-authentication and renderer-isolation checks. Analytics was disabled; updating stayed disabled without an enable flag. After stopping the owned processes, a new desktop process cold-started and rendered again. The actual installed Electron executable ran the fixed auth helper with a dummy credential: exit 0 and matching output, with no provider/model request. Managed uninstall removed this installation, registry/shortcuts and processes while preserving product-wide user data, caches and both artifact versions.

已安装 alpha.2 实际渲染并通过健康、桌面认证和渲染器隔离检查，遥测关闭，未设置启用标志时更新保持关闭。停止托管进程后以新 desktop 进程冷启动并再次渲染。实际安装的 Electron 执行固定 auth helper，假密钥测试退出码 0 且输出匹配，没有供应商/模型请求。托管卸载清理了本次安装、注册表/快捷方式和进程，保留产品级用户数据、缓存与两版交付产物。

Dedicated evidence: `.cache/packaging/0.1.0-alpha.2/smoke.json` and `auth-helper.json`. Their flags record `actualModelTurnExecuted: false`, `providerRequestStarted: false` and `publicReleasePublished: false`; these lifecycle/helper checks do not establish native provider task success, clean-machine acceptance or signing.

## Source evidence and limits / 源码证据与边界

Current frozen source evidence is recorded separately: native classifier 24 passed; runtime/provider/CLI/session/transport/MCP selection 183 passed; canonical Responses probe/regression 6 passed; two production native-provider/MCP-approval fixtures passed with fake native processes. Startup/authority selection passed 118 tests; Web native-routing selection passed 7 tests, its affected regressions and Web typecheck passed. These selections overlap and must not be added into a total. Root offline install, guard, final repository typecheck and source review passed. Native Codex 0.160.0 offline catalog/MCP initialization probes sent no model turns. See the linked owner reports for exact boundaries.

当前冻结源码的独立证据：原生供应商判定 24 项、运行时等选定范围 183 项、Responses 探针/回归 6 项通过；两项原生供应商/MCP-审批生产边界样本使用假原生进程通过。启动授权范围 118 项、Web 原生路由 7 项及其受影响回归和类型检查通过；选定范围存在重叠，不能相加。Root 离线安装、guard、最终全仓类型检查及源码审查通过。Codex 0.160.0 离线目录/MCP 初始化探针没有发送模型 turn。Alpha.2 实际安装生命周期已通过，真实模型/供应商验收仍待完成。

The strengthened browser asset witness passed 1/1, including actual WAV playback with advancing time through native `ended` and no media error. Offline/live-gate self-checks passed 4/4 and E2E typecheck passed; real provider/model cases stayed skipped. This confirms fixture playback and test preparation, not real model, arbitrary codec or user-game acceptance / 加强后的浏览器素材样本 1/1 通过，WAV 实际播放至原生 `ended`、播放时间前进且无媒体错误；离线/live-gate 自检 4/4 与 E2E 类型检查通过，真实模型/供应商用例仍跳过。这证明样本播放和验收准备，不等于真实模型、任意编码或用户游戏验收。

### Historical alpha.1 evidence / 历史 alpha.1 证据

For the previous `0.1.0-alpha.1` baseline, repository checks, ZIP integrity and actual isolated installation/launch/cold-restart/uninstall passed. Its app detected Codex 0.160.0, rendered Chinese local setup, passed health/authentication/renderer checks and kept analytics/updating off; user data was preserved. These old lifecycle checks do not cover the corrected alpha.2 binary.

本地文件位于 `output/releases/0.1.0-alpha.1/`：

| File / 文件 | Bytes / 字节 | SHA-256 |
| --- | ---: | --- |
| `OpenPixo-0.1.0-alpha.1-win-x64-setup.exe` | 443112488 | `582187c5f2077458dcbafb46241b2a852ef26f741788e2ea6f3fe2f663fa679d` |
| `OpenPixo-0.1.0-alpha.1-win-x64.zip` | 511927245 | `7d616ddb057b566cf6027b3406f870f39f8ef48452972382eb263fdca237f6ba` |

`SHA256SUMS.txt` and `manifest.json` accompany the files; the manifest records `signed: false`. These ignored local artifacts are not public GitHub downloads. Live native Codex/MCP tasks, the user's actual game, large-project scale, third-party provider credentials, clean-machine acceptance and code signing remain separate checks.

本小节的检查、文件和哈希仅属于旧 `0.1.0-alpha.1` 基线；其隔离安装生命周期已通过，产品级用户数据保留。它们不证明 alpha.2 的实际安装结果。真实模型/游戏/第三方供应商、签名、公开发布与干净机器验收仍未完成。
