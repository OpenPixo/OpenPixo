# 发布 OpenPixo 插件

插件以可移植的 SKILL.md 为核心，pixo.json 提供附加清单。可以将本地插件发布到作者自己的 GitHub 仓库；产品尚未配置公开仓库，也没有内置社区目录投稿流程。

## 创建与检查

```bash
pixo plugin scaffold --id game-tools --title "Game tools" --out ./plugins/community
pixo plugin validate ./plugins/community/game-tools --no-daemon
pixo plugin pack ./plugins/community/game-tools
```

scaffold ID 使用小写字母、数字、点、下划线或连字符；目录中的 vendor/name 地址是另一层标识。补齐许可证，保留第三方署名。输出参数以各命令 --help 为准。

## 发布到自己的仓库

```bash
pixo plugin login
pixo plugin whoami --json
pixo plugin publish-repo ./plugins/community/game-tools --help
```

publish-repo 创建或更新作者选择的仓库，执行发布前检查仓库、可见性与参数。界面的 publish-github 动作调用同一项目插件 API。GitHub 认证通过 gh 完成，不把 token 写入清单或项目文件。

`pixo plugin publish --help` 列出仍支持的第三方目录目标。没有产品自己的社区提交目标或打开上游问题页的 yank 命令。自建目录由其运营者在自己的仓库或 HTTPS 清单中管理。

## 安装与核对

```bash
pixo plugin install --source ./plugins/community/game-tools
pixo plugin list --json
pixo plugin info game-tools --json
pixo marketplace list --json
```

安装记录保留来源、信任、解析内容和完整性信息。远程源需要明确配置；内置官方条目来自仓库本地，社区快照为空。详见[插件规范](plugins-spec.zh-CN.md)、[自建目录](self-hosting-a-registry.md)和[插件约定](../plugins/AGENTS.md)。
