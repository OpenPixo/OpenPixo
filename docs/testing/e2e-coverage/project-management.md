# 项目管理模块

## 覆盖范围

- 项目列表卡片
- 项目列表搜索与视图切换
- 项目重命名持久化
- 文件删除与首页删除流程
- General 设置中的宠物自定义草稿

## 对应测试文件

- `e2e/ui/project-management-flows.test.ts`

## 已自动化

| ID | 场景 | 来源 |
| --- | --- | --- |
| PM-004 | 项目标题重命名后刷新仍保留，空白标题不会覆盖原值 | `project-management-flows.test.ts` |
| PM-005 | 取消删除项目文件时，文件行和已打开标签都会保留 | `project-management-flows.test.ts` |
| PM-006 | 项目列表卡片删除同时覆盖取消和确认两种路径 | `project-management-flows.test.ts` |
| PM-007 | 项目列表支持 grid/kanban 切换，并在刷新后保持 | `project-management-flows.test.ts` |
| PM-008 | 项目列表搜索会过滤项目卡片，并支持从无结果态恢复 | `project-management-flows.test.ts` |
| PM-009 | General → Pets → Custom 可编辑名称、图形和问候语，并即时预览草稿 | `project-management-flows.test.ts` |

## 自动化候选

暂无。

## 手工保留

| ID | 场景 | 原因 |
| --- | --- | --- |
| PM-M01 | 宠物形象、表情、交互是否“自然/有趣” | 强主观体验项，不适合自动化 |
| PM-M02 | 首页卡片视觉密度、布局观感是否舒适 | 更适合人工视觉验收 |

## 说明

- 首页/项目管理相关场景集中在一个 Playwright 文件里，是因为它们共用相似的项目初始化生命周期。
- 已移除的设计系统和旧首页创作标签不再计入当前覆盖；保留其余场景的原 ID。
