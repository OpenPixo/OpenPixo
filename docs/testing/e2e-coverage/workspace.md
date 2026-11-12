# 工作区模块

## 覆盖范围

- 项目工作区内的会话与文件流
- Files 上传、删除、标签持久化
- 上传图片在 HTML artifact 中的解析与非 HTML 源码预览
- Quick switcher 键盘行为
- 聊天面板宽度持久化

## 对应测试文件

- `e2e/ui/app.test.ts`
- `e2e/ui/app-design-files.test.ts`
- `e2e/ui/app-restoration.test.ts`
- `e2e/ui/workspace-keyboard-flows.test.ts`

## 已自动化

### 资源驱动工作区场景

| ID | 场景 | 来源 |
| --- | --- | --- |
| WS-001 | 会话历史在刷新和线程切换后仍能保留 | `app.test.ts` via `conversation-persistence` |
| WS-002 | 上传文件后可以在聊天中通过 mention 再次引用发送给 agent | `app.test.ts` via `file-mention` |
| WS-003 | 通过文件深链接进入项目时，可以恢复到正确的预览标签 | `app.test.ts` via `deep-link-preview` |
| WS-004 | 通过 composer 文件选择器上传文件，并随 prompt 一起发送 | `app.test.ts` via `file-upload-send` |
| WS-005 | Files 上传图片后，会在工作区打开并可预览 | `app-design-files.test.ts` via `file-list-upload` |
| WS-006 | Files 删除上传文件后，列表和打开标签都会清理 | `app-design-files.test.ts` via `file-list-delete` |
| WS-007 | 已打开的文件标签在刷新后仍会恢复，并保持正确激活项 | `app-design-files.test.ts` via `file-list-tab-persistence` |
| WS-010 | 普通 inline question form 的提交和 Skip 回答进入下一次 run request，并写入用户消息历史 | `app-restoration.test.ts` |
| WS-011 | 在没有新 prompt 的情况下，刷新或空闲不会额外生成新文件 | `app.test.ts` via `generation-does-not-create-extra-file` |
| WS-013 | daemon 发送失败后，错误详情在跨文件切换、返回项目及后续失败之间仍然可见，便于重试和排查 | `app-restoration.test.ts` |
| WS-016 | Python 文件可以在工作区打开为可读的内联源码预览 | `app-design-files.test.ts` via `python-source-preview` |
| WS-017 | 上传的图片能通过 artifact 内的相对路径在生成 HTML 预览中正确加载 | `app-design-files.test.ts` via `uploaded-image-renders-in-preview` |
| WS-018 | 主动停止运行会只发送一次 cancel 请求，持久化 assistant 的 canceled 状态，并且不留下 artifact 文件 | `app-restoration.test.ts` |

### 键盘优先工作区流

| ID | 场景 | 来源 |
| --- | --- | --- |
| WS-101 | Quick switcher 可通过键盘打开，并激活目标文件 | `workspace-keyboard-flows.test.ts` |
| WS-102 | Quick switcher 搜索无匹配时，不会改变当前文件 | `workspace-keyboard-flows.test.ts` |
| WS-103 | Quick switcher 支持方向键移动选择后再打开文件 | `workspace-keyboard-flows.test.ts` |
| WS-104 | 通过键盘调整聊天面板宽度后，刷新仍会保持 | `workspace-keyboard-flows.test.ts` |

## 自动化候选

| ID | 场景 | 原因 |
| --- | --- | --- |
| WS-C02 | 工作区侧栏的更完整纯键盘导航 | 自动化价值高，但需要先明确产品侧快捷键与焦点规则 |
| WS-C03 | 多会话的重命名、归档或恢复流 | 值得自动化，但前提是这些能力在产品层正式稳定 |
| WS-C04 | 删除活跃会话后的回退恢复 | `conversation-delete-recovery` 资源标记为 `automated: false`，不计作已自动化覆盖 |

## 手工保留

| ID | 场景 | 原因 |
| --- | --- | --- |
| WS-M01 | 生成结果在预览里的“设计质量”是否达标 | 依赖主观内容质量判断，不适合用稳定断言衡量 |

## 说明

- `app.test.ts` 同时包含资源驱动场景和少量集中式回归，这里按用户行为分组，而不是按 helper 或实现结构分组。
- 资源驱动类场景来源于 `e2e/resources/playwright.ts`。
- 视觉方向问卷、预览评论和手动编辑属于 [已移除领域](../../adr/0012-slim-core.md)，
  不再列为当前工作区覆盖；普通 inline question form 保留。
