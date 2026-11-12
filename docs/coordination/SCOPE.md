# OpenPixo fork 交付清单

更新：2026-10-25（Asia/Tokyo）。执行依据：用户要求直接 fork `nexu-io/open-design`，先跑通、尽量复用，由当前会话协调并行开发。本文是验收地图，不是完成声明。

## 基线和边界

- 接受 OpenDesign 的 Electron + Next/React + Express daemon + pnpm monorepo 组织，避免移植整个上游到 M0 的 electron-vite 结构。
- M0 源码与测试已保存在提交 `c011cc4`，本地另有被 Git 忽略的 `.cache/m0-snapshot/` 供行为对照；保留其历史与验证产物。两张 `cloudflare-*.jpg` 是用户文件，不纳入产品代码。
- v0.1 完整边界以 `../FIRST-RELEASE-SCOPE.md` 为准：Windows、中英、多项目/历史、多根任务及 Codex 子代理、素材、skills/MCP、三条供应商路径、Windows 包和中英公开资料。不能把 fork 能启动称为完整 Alpha。
- Claude/OpenCode 执行层、macOS、自建生成服务、完整 IDE/引擎、云同步/账号/充值、交易平台后置。

## 最小完整验收

| 交付切片 | 优先复用 | 必须补齐或证据 |
| --- | --- | --- |
| 固定 fork 基线 | 上游仓库历史、构建与 Windows 脚本 | 记录准确 commit；保留 Apache-2.0 与内置 skills/templates 独立许可；隔离运行数据；从干净依赖安装启动 daemon、Web、桌面并记录命令 |
| Codex 运行时 | 上游 app-server/session/normalize | 流式回复、工具输出、真实项目写入、停止、历史恢复；审批在 UI 等待明确响应；请求/响应按项目/会话/请求 ID 关联；断开/退出清理进程 |
| 多任务 | 上游项目/会话及事件路由 | 两个根任务并行且结果不串线；显示子代理父子关系/状态；切换项目与会话后归属正确；不得设置全局单任务限制 |
| 项目与工作台 | 实际目录导入、文件树、diff、预览、会话 UI | `baseDir` 是用户目录；重启后仍可打开；代码/改动/执行输出可检查；支持安全外部编辑器/引擎打开 |
| 素材 | 上游图片、音频和文件读取/预览组件 | 直接反映实际目录；图片缩略图、音频试听、名称/类型筛选、多选加入对话；引用路径可被 Codex 使用；新增派生文件刷新可见；其他格式信息及外部打开 |
| 语言和首次使用 | 上游 i18n、runtime 检测/设置 | 跟随系统初始语言，中英切换并保留；Codex 缺失、未登录、可用状态明确且有官方配置引导；本地无需 OpenPixo 账号 |
| 供应商 | 上游 provider/config UI 和 Codex 支持方式 | 默认 Codex、DeepSeek、OpenRouter 各自有配置/连接反馈；凭据不进入项目版本控制；分别验证代码/工具、图像输入/生成、skills/MCP 能力，清楚标明差异及未验证项 |
| 扩展 | 上游 skills 扫描/覆盖、MCP registry/config/routes | 精选、本地/GitHub 导入；默认项目级；显示来源/版本/配置/状态；主动更新、启停、移除；MCP 依赖检查与引导；移除保留项目产物；一个 skill 与一个 MCP 实际参与任务 |
| skill 批处理 | skills + 素材多选 + 对话执行 | 至少一个代表性批操作；保留原素材、生成派生文件、报告逐项成功/失败；执行报告与素材视图能检查结果 |
| 公开交付 | 上游 Windows 打包与 README 模式 | OpenPixo 身份、Apache-2.0/第三方致谢、中英 README/官网、实际 Windows 下载包、真实仓库/反馈入口；干净环境安装与核心任务复核 |

## M0 的可复用行为与位置

以下路径均相对于历史提交 `c011cc4`（可用 `git show c011cc4:<path>` 读取），或本地 `.cache/m0-snapshot/`。它们不是当前仓库根目录文件；fork 的运行代码位于 `apps/` 等上游 monorepo 目录。

- `src/main/codex/detection.ts`：Windows 原生 Codex 检测，支持 npm 嵌套及提升的可选二进制包，不直接执行 `.cmd/.bat/.ps1` shim；版本探针有超时。
- `src/main/codex/client.ts` 与 `tests/codex-client.test.ts`：并发 JSONL RPC、UTF-8 分片、显式审批响应、错误/超时/退出清理；`thread/list` 默认 `useStateDbOnly=true`，避免大历史扫描超时；`turn/start` 使用 `text_elements`。
- `src/main/runtime.ts` 与 `tests/runtime-boundary.test.ts`：目录 realpath、线程所属项目检查、已打开线程边界；新建/恢复均使用 `workspace-write` + `on-request`；只把账号状态投影给 UI。
- `src/renderer/src/runtime.ts` 和同目录 `runtime.test.ts`：子代理 `collabAgentToolCall`、`subAgentActivity`、父线程来源映射；按线程合并流和历史、避免恢复覆盖活动流或重复用户消息。
- `scripts/verify-codex.ts`、`scripts/verify-desktop.ts`：可借鉴隔离配置/临时项目的真实链路验证。桌面脚本绑定旧 UI，不能直接当成 fork 的验收脚本。

## 证据与待定项

- 已读取 `output/playwright/desktop-report.json`：M0 真实 Codex 0.160.0、桌面写文件、一个子代理、停止、重连恢复、语言保留和 renderer 隔离通过；该次文件选择器是 stub，rendererErrors 为空。这是旧 M0 证据，不自动覆盖 fork。
- M0 交接记录另有 41 个测试、类型检查、构建及隔离握手通过记录；首次范围审查为只读，没有重复执行模型任务。
- 原始 OpenDesign `9724c44142ea0afaee3d207f37901b31c66a44ad` 审查发现审批设为 `never`、服务器请求回 unsupported。这是上游历史差距；当前修正及其实际证据见运行时、QA 和发布协调记录，不以旧检查替代新源码/产物验收。
- 用户的真实游戏尚未指定，不重复访谈；先用仓库内临时游戏样本覆盖可检查行为，真实游戏验收保持独立待办。
- 第三方真实凭据、真实游戏、公开发布 URL/签名等外部条件缺失时，保留可运行的配置/构建及明确状态，不伪造连接、付费调用、下载或发布成功。

## 协调约束

每个子代理只改分配路径；应用集成、依赖安装、锁文件、启动进程和最终验收由主协调者统一安排。记录实际命令、结果文件和未通过项；精简报告，避免搬运源码进主会话。
