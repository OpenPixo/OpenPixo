# OpenPixo 插件与商店契约

插件为本地游戏项目提供可移植的 skills、assets 与 MCP context。
每个插件包含 `SKILL.md`；`pixo.json` 补充版本、输入、来源、预览与上下文引用。
编写指南见 [plugins/spec](../plugins/spec/README.zh-CN.md)，维护中的类型与解析器位于
`packages/contracts/src/plugins/`，对应 [JSON schema](schemas/openpixo.plugin.v1.json)。

## 安装与项目上下文

商店与 registry 解析内置、本地和远程来源。安装、更新、移除与权限操作通过 daemon API、
`pixo plugin` 和 `pixo store` 完成。项目 skill/MCP 扩展由扩展面板和
`pixo extensions` 管理；MCP 配置保留在设置及 `pixo mcp` 中。

应用插件时校验输入，解析 skills、assets 与 MCP context，并保存来源快照。
安装插件不会启动隐藏的 agent。每个物理 run 仍经
`internalRunCreation.start(run, analytics, starter)` 启动。

## 运行边界

agent 继续使用常规聊天流、工具调用、审批、停止与 steer；缺少必要信息时通过
`<question-form>` 产物提问。游戏媒体、素材操作和 recipes 保留自己的 HTTP/UI/CLI 契约。

宿主 pipeline executor、atom workers、GenUI、connector 账户绑定、评审剧场与
live-artifact 后端已删除。为读取既有商店内容与历史快照，仍解析静态 pipeline 元数据，
但不会调度宿主任务或向 run 注入 atom body。connector/GenUI 权限和 API 不再提供。

## 持久化与验证

数据规则统一见根 [AGENTS.md](../AGENTS.md#daemon-data-directory-contract)。
删除旧领域的建表代码不会删除既有用户数据库中的表。验证使用 `pnpm guard`、
包级类型检查，以及安装、快照、registry 和项目扩展的聚焦测试。
本轮证据与保留边界见 [SLIM-CORE](coordination/SLIM-CORE.md)。
