# 设置模块

本页记录当前保留的设置覆盖。Memory、Orbit、Connectors、Design systems、
Appearance 和旧宠物设置不再作为当前设置能力列入矩阵；删除边界见
[ADR 0012](../../adr/0012-slim-core.md)。

## 覆盖范围

- Execution mode 页面
- Language 页面
- Integrations 的 Skills 标签页
- API protocol 迁移与切换回归
- 国际化内容注册完整性

## 对应测试文件

- `e2e/ui/settings-api-protocol.test.ts`
- `e2e/ui/settings-media-providers.test.ts`
- `e2e/tests/localized-content.test.ts`
- `apps/web/tests/components/App.mediaProviders.test.tsx`
- `apps/web/tests/components/SettingsDialog.test.ts`
- `apps/web/tests/components/SettingsDialog.execution.test.tsx`
- `apps/web/tests/components/SkillsSection.test.tsx`
- `apps/web/tests/components/SettingsDialog.media.test.tsx`
- `apps/web/tests/components/SettingsDialog.product-surfaces.test.tsx`
- `apps/web/tests/components/theme-settings-removed.test.tsx`

## 已自动化

| ID | 场景 | 来源 |
| --- | --- | --- |
| SET-001 | BYOK 页面展示 protocol tabs，以及 `Quick fill provider / API key / Model / Base URL` 核心字段 | `SettingsDialog.execution.test.tsx` |
| SET-002 | BYOK 的 `Show / Hide` 可以切换 API key 明文与密文显示 | `SettingsDialog.execution.test.tsx` |
| SET-003 | 切换 `Quick fill provider` 后，`Model` 与 `Base URL` 会联动更新到对应 preset | `SettingsDialog.execution.test.tsx`, `settings-api-protocol.test.ts` |
| SET-004 | 手动修改 `Base URL` 后，当前 provider 会回退为 custom 状态 | `SettingsDialog.execution.test.tsx` |
| SET-005 | 不同 protocol 的 draft 相互隔离，`apiKey` 不会跨协议泄漏 | `SettingsDialog.execution.test.tsx`, `SettingsDialog.test.ts` |
| SET-006 | 历史 OpenAI-compatible 已知 provider 切到 Anthropic 时，会命中对应 sibling preset | `settings-api-protocol.test.ts`, `SettingsDialog.test.ts` |
| SET-007 | 历史 custom provider 切换 protocol 时，会保留自定义 `Base URL` 和 `Model` | `settings-api-protocol.test.ts`, `SettingsDialog.test.ts` |
| SET-008 | BYOK 下只有必填字段合法时才会触发自动保存，非法 `Base URL` 会阻止保存 | `SettingsDialog.execution.test.tsx`, `settings-api-protocol.test.ts` |
| SET-009 | BYOK 自动保存后，配置会写入本地并在关闭后重新打开设置时正确回显 | `settings-api-protocol.test.ts` |
| SET-010 | Azure 的 `apiVersion` 仅保留在 Azure draft 中，不污染其他协议 | `SettingsDialog.test.ts` |
| SET-011 | Settings 弹窗支持右上角关闭按钮和遮罩关闭，关闭入口不会误触额外保存动作 | `SettingsDialog.execution.test.tsx` |
| SET-012 | Azure OpenAI 页面展示 `Deployment name / API version` 专属字段，并支持保存 Azure 配置 | `SettingsDialog.execution.test.tsx` |
| SET-013 | BYOK 支持切换到 `Custom model id` 输入路径并保存自定义 model | `SettingsDialog.execution.test.tsx` |
| SET-014 | Local CLI 模式下只能选择已安装 agent，选择后会自动保存为当前执行 CLI | `SettingsDialog.execution.test.tsx` |
| SET-015 | Local CLI 在无 agent 时显示 empty state，且不会触发无效保存 | `SettingsDialog.execution.test.tsx` |
| SET-016 | `Rescan` 会展示 loading 状态、阻止重复点击，并在成功后展示可用 agent 数 | `SettingsDialog.execution.test.tsx` |
| SET-017 | `Rescan` 失败时会展示错误提示，但不破坏当前页面状态 | `SettingsDialog.execution.test.tsx` |
| SET-018 | Configure execution 页面里的 `CLAUDE_CONFIG_DIR`、`CODEX_HOME` 可保存进配置 | `SettingsDialog.execution.test.tsx`, `SettingsDialog.test.ts` |
| SET-019 | daemon offline 时 `Local CLI` 模式不可选，并展示 offline 文案 | `SettingsDialog.execution.test.tsx` |
| SET-020 | Local CLI 保存后，首页左下角执行状态 pill 会联动展示当前 agent 与版本 | `settings-api-protocol.test.ts` |
| SET-021 | Media providers 会按 `已配置优先 -> Integrated 优先 -> 名称排序` 稳定展示，已配置 provider 会显示 `Configured` badge | `SettingsDialog.execution.test.tsx` |
| SET-022 | Unsupported media providers 会以禁用行展示，不允许编辑当前不支持的 provider 配置 | `SettingsDialog.execution.test.tsx` |
| SET-023 | Media providers 支持保存 API key / Base URL / 自定义 model，并在 `Clear` 后从保存 payload 中移除对应 provider | `SettingsDialog.execution.test.tsx` |
| SET-024 | Media providers 支持右上角关闭按钮和遮罩关闭，关闭入口不会误触额外保存动作 | `SettingsDialog.execution.test.tsx` |
| SET-025 | App 启动时如果本地已有已配置的 media providers，且 daemon 在线，会自动把配置同步到 daemon | `App.mediaProviders.test.tsx` |
| SET-026 | Settings 保存 media providers 后，会以 `force: true` 触发 daemon 同步，并把 `onboardingCompleted` 一并落盘 | `App.mediaProviders.test.tsx` |
| SET-027 | Media providers 页面支持从 daemon load error 回退到 browser-saved state，并可通过 `Reload from daemon` 拉回 saved marker / tail / base URL | `SettingsDialog.media.test.tsx`, `settings-media-providers.test.ts` |
| SET-028 | Media providers 的 reload 成功会展示短暂 `Reloaded` flash，失败时展示 sticky error，且 reload 不会覆盖 saved-marker 行上的本地 pending edit | `SettingsDialog.media.test.tsx`, `config.test.ts` |
| SET-029 | Media providers 支持 marker-only saved state：replace placeholder、saved tail badge、clear，以及 custom-model provider 清理时连同 `model` 一起移除 | `SettingsDialog.media.test.tsx` |
| SET-030 | 真实 settings media flow 支持 provider 输入自动保存，并在关闭后重新打开设置时稳定回显 | `settings-media-providers.test.ts` |
| SET-090 | Settings 中保存的 media provider 配置会被 New Project 的 Media model picker 跨页面消费：provider badge 从 `Integrated` 升级为 `Configured` | `settings-media-providers.test.ts`, `NewProjectPanel.media.test.tsx` |
| SET-038 | MCP server 页面在 daemon 返回 install info 后，会默认渲染 Claude Code 的安装命令、重启提示和能力说明 | `SettingsDialog.execution.test.tsx` |
| SET-039 | MCP server 页面切换不同 client 后，会联动更新安装方式说明和 snippet 内容 | `SettingsDialog.execution.test.tsx` |
| SET-040 | MCP server 页面支持复制当前 snippet 到剪贴板，并展示 `Copied` 反馈 | `SettingsDialog.execution.test.tsx` |
| SET-041 | MCP server 页面在 daemon 无法返回 install info 时，会展示错误提示和降级 snippet 文案 | `SettingsDialog.execution.test.tsx` |
| SET-091 | External MCP 的 managed OAuth 支持启动授权、打开 authorize URL、接收 callback postMessage 更新 Connected 状态，并可 Disconnect | `settings-mcp-snippet-chip.test.ts` |
| SET-043 | Language 页面展开下拉后，会渲染完整 locale 列表，并正确标记当前已选语言 | `SettingsDialog.execution.test.tsx` |
| SET-044 | 在 Language 页面切换语言后，触发器文案会立即更新，同时把 locale 写入 `localStorage` 并同步 `html[lang]` | `SettingsDialog.execution.test.tsx` |
| SET-045 | English 和简体中文两个受支持语言均保持 `html[dir=ltr]` | `SettingsDialog.execution.test.tsx` |
| SET-046 | Language 页面不依赖全局保存按钮；语言切换即时生效，关闭 Settings 也不会回滚已应用 locale | `SettingsDialog.execution.test.tsx` |
| SET-047 | 保留的 skill、design template、prompt template 在 `en` / `zh-CN` 下通过翻译或英文 fallback 渲染为非空展示内容 | `localized-content.test.ts` |
| SET-048 | 保留资源缺少可选翻译时回退到源值，已有字典项仍可本地化 | `localized-content.test.ts` |
| SET-049 | Notifications 默认启用 completion sound 和桌面通知，并直接展示成功/失败音选择器；用户仍可分别关闭两个开关 | `SettingsDialog.execution.test.tsx` |
| SET-050 | Notifications 支持切换 success / failure sound，并把声音选择保存到通知配置 | `SettingsDialog.execution.test.tsx` |
| SET-051 | Desktop notification 在授权成功后会切为 `active`，支持发送测试通知并展示发送结果文案 | `SettingsDialog.execution.test.tsx` |
| SET-052 | Desktop notification 在权限被拒绝时，会保持禁用并展示浏览器阻止提示，不显示测试按钮 | `SettingsDialog.execution.test.tsx` |
| SET-053 | Notifications 支持右上角关闭按钮和遮罩关闭，关闭入口不会误触额外保存动作 | `SettingsDialog.execution.test.tsx` |
| SET-063 | Integrations 的 Skills 标签页展示 functional skills，支持按 type/category 筛选并结合搜索缩小结果 | `SettingsDialog.execution.test.tsx`, `SkillsSection.test.tsx` |
| SET-064 | Integrations 的 Skills 标签页支持展开详情，并可通过 toggle 把 skill 加入 `disabledSkills` 保存 | `SettingsDialog.execution.test.tsx`, `SkillsSection.test.tsx` |
| SET-066 | Integrations 的 Skills 标签页在筛选或搜索无匹配时展示空结果提示 | `SettingsDialog.execution.test.tsx` |
| SET-067 | About 页面会正确展示 `Version / Channel / Runtime / Platform / Architecture` 五项只读版本信息 | `SettingsDialog.execution.test.tsx` |
| SET-068 | About 页面在 `appVersionInfo` 缺失时，会展示版本信息不可用的降级空态 | `SettingsDialog.execution.test.tsx` |
| SET-069 | About 页面是只读信息页；关闭按钮或遮罩关闭不会产生保存动作或脏状态 | `SettingsDialog.execution.test.tsx` |
| SET-070 | Settings 顶部 autosave 状态会覆盖 `Saving… / All changes saved / Couldn’t save changes` 三种状态 | `SettingsDialog.execution.test.tsx` |
| SET-071 | BYOK 页面 `Test` 按钮只有必填字段可用后才允许测试，并会展示 provider 连接测试结果 | `SettingsDialog.execution.test.tsx` |
| SET-072 | Local CLI 页面 `Test` 按钮会使用当前选中的已安装 agent 发起连接测试，并展示 agent 响应结果 | `SettingsDialog.execution.test.tsx` |
| SET-093 | Settings 不展示已退役产品入口，也不请求相关资源 | `SettingsDialog.product-surfaces.test.tsx` |
| SET-094 | General 和 onboarding 不展示 Appearance 或亮暗主题切换控件 | `theme-settings-removed.test.tsx` |

## 自动化候选

| ID | 场景 | 原因 |
| --- | --- | --- |
| SET-C05 | MCP server 的 Cursor deeplink / 多平台路径差异（macOS/Linux/Windows） | 适合自动化，但需要更细的环境 mock 或浏览器 scheme 行为校验，适合后续补 |
| SET-C06 | Notifications 在 ProjectView 中收到真实任务完成事件后，是否按 success/failure 正确播放声音和发送桌面通知 | 适合自动化，但需要结合流式消息完成态和窗口焦点状态做更完整联动断言 |

## 手工保留

| ID | 场景 | 原因 |
| --- | --- | --- |
| SET-M01 | 不同主题下的整体观感是否协调 | 视觉主观项，人工验收更合理 |
| SET-M02 | 多语言翻译语气是否自然、本地化是否地道 | 语义质量判断仍需人工 review |

## 说明

- API protocol 用例的价值在于：历史配置迁移和协议切换很容易静默回归，单靠单元测试不够稳。
- `localized-content.test.ts` 不是浏览器流，但它确实保护了设置页/入口页在多语言下的展示完整性，适合放在这个模块下维护。
