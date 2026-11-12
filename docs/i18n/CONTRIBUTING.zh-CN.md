# 为 OpenPixo 贡献

[English](../../CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

先读根 [AGENTS.md](../../AGENTS.md)，再读所修改层的 AGENTS.md。首版范围 (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`)与协调状态 (openpixo-internal: `docs/coordination/STATUS.md`)决定当前交付边界。非简单功能先与维护者明确问题和范围；公开问题反馈和讨论入口尚未配置。

## 环境与运行

使用 Node 24、pnpm 10.33.2。Windows 本地工具链、PATH 与原生依赖要求见 [AGENTS.md](../../AGENTS.md#windows)，不要更改全局安装。

```powershell
pnpm install --config.confirmModulesPurge=false
pnpm tools-dev --help
```

开发生命周期只使用 tools-dev。测试使用独立 namespace；namespace 本身并不隔离 daemon 数据。[数据目录约定](../../AGENTS.md#daemon-data-directory-contract)是存储规则的唯一来源。不要停止或复用已安装的体验实例。

## 实现与验证

- 业务能力通过 daemon HTTP API 与纯 contracts DTO 对接，用户功能同时提供界面与 CLI。
- 新代码默认 TypeScript；单测放包级 tests，浏览器流程放 e2e/ui。
- 只运行受影响的聚焦测试与整合边界；未经明确要求不运行 daemon/web 全量套件。
- 发布前运行 `pnpm guard`、`pnpm typecheck`，并重建被消费的包输出。
- Bug 修复保留有意义的先红后绿证据；回放与假进程结果不冒充真实模型验收。
- 新依赖说明用途并遵循精确版本规则；本地数据和临时产物不进 git。

## 提交与审查

提交和 PR 标题使用 Conventional Commits，不添加共同作者元数据。完整填写 [PR 模板](../../.github/pull_request_template.md)，说明用户问题、实际行为、界面/CLI/API/内容影响与验证；界面改动附入口截图。审查标准见[代码审查指南](../code-review-guidelines.md)。

保留第三方许可证和作者署名。功能技能、渲染模板和插件分别遵循 [skills](../../skills/AGENTS.md)、[design-templates](../../design-templates/AGENTS.md)、[plugins](../../plugins/AGENTS.md) 的约定。已删除上游投稿与社区提交入口；仍可将插件发布到作者自己的仓库，详见[插件发布](../publishing-a-plugin.zh-CN.md)。
