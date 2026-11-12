# 入口模块

## 覆盖范围

- 新建项目入口面板
- 新建项目名称回退与媒体参数
- 入口页外观约束与 Settings 入口
- 提示词模板创建路径
- 资源驱动的项目创建 happy path

## 对应测试文件

- `e2e/ui/entry-configuration-flows.test.ts`
- `e2e/ui/entry-chrome-flows.test.ts`
- `e2e/ui/app.test.ts`
- `apps/web/tests/components/NewProjectPanel.test.tsx`（组件级参数覆盖）

## 已自动化

### 入口配置流

| ID | 场景 | 来源 |
| --- | --- | --- |
| ENTRY-001 | 提示词模板加载失败后重试，编辑后的模板正文会写入项目 metadata | `entry-configuration-flows.test.ts` |
| ENTRY-011 | 创建图片项目时，默认图片模型与所选 `aspect` 会正确写入创建 payload | `NewProjectPanel.test.tsx` |
| ENTRY-012 | 创建视频项目时，所选 `aspect` 与 `duration` 会正确写入创建 payload | `NewProjectPanel.test.tsx` |
| ENTRY-013 | 创建音频项目时，所选 `duration` 与修剪后的 `voice` 会正确写入创建 payload | `NewProjectPanel.test.tsx` |
| ENTRY-014 | 入口页不再渲染旧 pet rail，Settings 也不再暴露 pet picker 的显示/隐藏开关 | `entry-chrome-flows.test.ts` |
| ENTRY-015 | 紧凑桌面宽度下，入口页 composer 与整页不会出现明显横向溢出 | `entry-chrome-flows.test.ts` |

### 资源驱动创建场景

| ID | 场景 | 来源 |
| --- | --- | --- |
| ENTRY-104 | Image 项目通过 New project → Image 路径创建，并保存图片项目 metadata | `app.test.ts` via `image-basic` |
| ENTRY-105 | Video 项目通过 New project → Video 路径创建，并保存默认模型、画幅与时长 metadata | `app.test.ts` via `video-basic` |
| ENTRY-106 | Audio SFX 项目通过 New project → Audio 路径创建，并保存音频类型 metadata | `app.test.ts` via `audio-sfx-basic` |
| ENTRY-108 | HyperFrames 项目通过 New project → Video 路径创建，并预览生成的 HTML motion artifact | `app.test.ts` via `hyperframes-basic` |

## 手工保留

| ID | 场景 | 原因 |
| --- | --- | --- |
| ENTRY-M01 | 入口页视觉风格是否符合品牌预期 | 依赖主观视觉判断，不适合做稳定自动化断言 |
| ENTRY-M02 | 入口页动效、过渡、微交互是否自然 | 更适合人工体验验收，自动化收益较低 |

## 说明

- `app.test.ts` 的部分场景来自 `e2e/resources/playwright.ts`。新增资源驱动用例时，需要同时更新资源文件和这份文档。
- 编号保留原值。按 [ADR 0012](../../adr/0012-slim-core.md) 已退役的连接器、设计体系、幻灯片和实时制品入口，以及 Batch 9 移除的原型设计创建表单，不计入当前覆盖；旧测试或资源中的残留声明不能证明当前入口可达。游戏模板创建由 `NewGameDialog` 承担，媒体项目仍由 `NewProjectPanel` 承担。
- 依赖 mocked SSE 的入口流程应尽量保持稳定、可重复、执行快。
