# OpenPixo Phase 7：官网与发布实施规格

状态：2026-10-26 切片 1（隐私、支持页，导航与 zh.html 链接修复）、2（`tools-release openpixo metadata|publish|rollback`）、3（更新源与 What's new 默认关闭、拒绝上游域名）、5（`.github/workflows/openpixo-release.yml`，未实跑）、6（`tools-release site generate` 生成下载/更新日志/配方/商店页）已在源码落地；v0.3 页面为草稿未挂导航。切片 4 签名证书、域名、Pages/R2 接入未做。随 v0.2–v0.4 分批上线，每个版本只上线它需要的页面和下载。上游：路线文档 §4 Phase 7 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`)、[ADR 0005](../../docs/adr/0005-openpixo-fork.md)（不得指向上游的更新源）、[ADR 0006](../../docs/adr/0006-full-hard-fork.md)（上游发布流水线不再适用）。

## 1. 目标

1. 官网（Cloudflare Pages，零构建静态页）讲清产品、提供 Windows 下载、价格与规则、法律页面和支付结果页。
2. Windows 安装包有正式的签名、版本化下载地址和 SHA256 校验。
3. 应用内自动更新从 OpenPixo 自己的更新源获取，只接受独立身份与明确配置的更新源。
4. 发布有一条可重复的流水线，替代上游的 beta/prerelease/preview/stable 和飞书通知。

不在本阶段：macOS 安装包、网页版应用、网页端账号中心、营销分析平台。

## 2. 现状与接缝

| 接缝 | 现状 | 本阶段动作 |
| --- | --- | --- |
| `docs/openpixo-site/` | 中英双语静态页，无构建、无 JS、无远程字体；还没有下载按钮 | 直接作为 Pages 根目录，补页面 |
| `tools/pack/src/win/` | NSIS 安装器、payload、`sign.ts`（signtool） | 复用；接入正式证书 |
| `tools/release/src/storage/s3-upload.ts` 等 | 上游按 S3 协议发布元数据和产物 | R2 兼容 S3 协议，复用上传逻辑，换成 OpenPixo 的桶和元数据格式 |
| `apps/desktop/src/main/updater/config.ts` | 默认无更新源；只有显式 `PIXO_UPDATE_METADATA_URL` 才启用 | 默认值改为 OpenPixo 更新源；未配置时禁用 |
| What's new | daemon 默认不请求；可显式设置 `PIXO_WHATS_NEW_URL`（见 `tools/pack/AGENTS.md`） | 改为 OpenPixo 地址或默认关闭 |
| `.github/workflows/release-*.yml`、`notify-*.yml` | 上游多渠道流水线与飞书通知 | 删除，换成 OpenPixo 单一流水线 |
| Alpha 产物 | 本地 `output/releases/0.1.0-alpha.*`，未公开 | 新流水线产出的第一个公开版本另起编号 |

## 3. 设计

### 3.1 域名与托管

| 用途 | 托管 | 说明 |
| --- | --- | --- |
| 官网 `<site-host>` | Cloudflare Pages，根目录 `docs/openpixo-site/` | HTTPS，中英页面互链 |
| 下载 `<download-host>` | R2 公开桶 + 自定义域名 | 安装包超过 Pages 单文件 25 MiB 上限，不能放 Pages |
| 更新源 | 同下载域名，`/updates/<channel>/latest/metadata.json` | 元数据小文件，CDN 短缓存 |
| 商店 registry | Phase 6 的 `<registry-host>` | 可与下载共用一个域名的不同路径 |

具体域名待定。DNS 托管在 Cloudflare（用户已在配置，见仓库根目录的截图，不随交付提交）。

### 3.2 官网页面

在现有 `index.html`/`zh.html` 基础上新增，均为中英两份：

| 页面 | 首次上线版本 | 内容 |
| --- | --- | --- |
| 下载 `download` | v0.2 | 最新版本号、发布日期、安装包链接、SHA256、系统要求（Windows 10/11 x64）、SmartScreen 说明、历史版本列表 |
| 更新日志 `changelog` | v0.2 | 从 `CHANGELOG.md` 生成 |
| 隐私 `privacy` | v0.2 | 本地优先、哪些数据会发给哪些供应商（用户自带 Key 时）、遥测默认关闭 |
| 配方画廊 `recipes` | v0.2 | 从 Phase 4 的内置配方生成静态卡片（预览图 + 说明），不需要登录 |
| 价格与积分规则 `pricing` | v0.3 | 积分包、每类生成的积分消耗、有效期、失败退回规则 |
| 服务条款 `terms`、退款 `refund` | v0.3 | 正式收款前由账户所有者确认文本 |
| 支付结果 `checkout/success`、`checkout/cancel` | v0.3 | 只提示「回到应用查看到账」，不登录、不写余额（与 CLOUD-CREDITS 计划一致） |
| 商店目录 `store` | v0.4 | 从 registry 的 `marketplace.json` 生成，付费条目显示积分价格，购买在应用内完成 |
| 支持 `support` | v0.2 | 反馈渠道、客服邮箱（待专用账号）、订单/任务参考号说明 |

生成方式：页面主体保持手写静态 HTML；changelog、配方画廊、商店目录、下载页由一个小的 TS 脚本在发布时生成（放在 `tools/release` 下，作为新的子命令），输出到 `docs/openpixo-site/` 并提交。线上不运行脚本，保持零构建部署。

分析：默认不加任何统计。如需流量数据，只考虑 Cloudflare Web Analytics（无 cookie），上线前需用户确认。

修复已知问题：`zh.html` 中指向站外相对路径的文档链接（CLOUD-CREDITS 计划 §7 提到的 `zh.html:118`），以及 Alpha.2 的旧版本文案。

### 3.3 版本与渠道

- 版本号：`MAJOR.MINOR.PATCH`，预发布用 `-beta.N`。公开版本从 `0.2.0-beta.1` 开始；本地的 `0.1.0-alpha.*` 不公开。
- 渠道只有两个：`beta`（早期测试用户）和 `stable`。不沿用上游的 prerelease/preview。
- 应用身份：沿用现有 OpenPixo Windows 身份（`openpixo-internal/docs/coordination/PACKAGING.md`）。如果 beta 与 stable 需要并存安装，beta 使用不同的应用名和 namespace，规则写进该文档。

### 3.4 构建、签名与上传流水线

新工作流 `.github/workflows/openpixo-release.yml`，手动触发，输入版本号和渠道：

1. `windows-latest` runner，使用仓库固定的 Node/pnpm 版本，`pnpm install`、`pnpm guard`、`pnpm typecheck`。
2. `pnpm tools-pack win build --to nsis --portable`（正式产物参数以 `tools/pack/AGENTS.md` 为准）。
3. 签名：`tools/pack/src/win/sign.ts`。证书选项待定：OV/EV 代码签名证书，或 Azure Trusted Signing。证书和凭据放 GitHub environment secrets，签名步骤要求维护者批准。
4. 冒烟：在 runner 上静默安装 → 启动 → `pnpm tools-dev inspect`（或打包版等价检查）→ 卸载。不调用任何模型。
5. 生成 `SHA256SUMS` 和更新元数据 `metadata.json`（字段沿用 `tools/pack/AGENTS.md` 中「Release metadata shape」，去掉上游专用块）。
6. 上传到 R2：`releases/<version>/` 下放安装包、zip、`SHA256SUMS`；`updates/<channel>/latest/metadata.json` 最后写，保证元数据指向的文件已经存在。
7. 重新生成官网的下载页和 changelog，提交到仓库，由 Pages 自动部署。
8. 创建 GitHub Release（仓库公开后），附同样的产物链接和哈希。

回滚：`updates/<channel>/latest/metadata.json` 指回上一个版本即可，复用 `tools/release` 里 `rollback-latest` 的思路。

上游的发布工作流（`release-beta.yml`、`release-prerelease*.yml`、`release-stable*.yml`、`release-exact.yml`、`release-gate.yml`、`release-rollback.yml`、`release-withdraw.yml`、`cut-release.yml`、`cut-patch-release.yml`、`finalize-release.yml`、`release-branch-direct-pr-guard.yml`、`main-prerelease-win-smoke.yml`、`notify-*.yml`、`bake-plugin-previews-release.yml`、`whats-new-publish.yml`）和飞书通知在本阶段删除或改写；删除清单和保留的 CI（`ci.yml` 中仍有用的检查）单独列在实施 PR 中，并按 `.github/AGENTS.md` 的规则调整拓扑检查。

### 3.5 应用内更新

- `updater/config.ts`：默认元数据地址改为 OpenPixo 更新源；构建时如果没有注入地址，更新功能禁用（不回退到上游默认值）。
- What's new：默认地址改为 `<download-host>/whats-new.json`，或在没有内容时关闭。
- 测试：`tools-serve start updater` 已提供确定性的更新元数据夹具，用它覆盖「新版本提示 → 下载 → 校验 → 打开安装器」和「元数据校验失败不更新」。

### 3.6 发布前检查清单

写进 `openpixo-internal/docs/coordination/PACKAGING.md`，每次发布逐项勾选：

- 安装包已签名，`signtool verify` 通过。
- 干净的 Windows 10 和 11 虚拟机各安装一次并首启成功。
- 网络抓包或日志确认：首启不访问继承的服务或未配置的公开地址。
- 更新源指向 OpenPixo，What's new 不指向上游。
- 官网下载页的版本号、链接和 SHA256 与 R2 上的文件一致。
- v0.3 起：生产 Stripe 和 Supabase 配置检查通过，支付结果页可访问。

## 4. 实施切片

1. Pages 项目接入 `docs/openpixo-site/`、域名、隐私和支持页、修复站外链接。
2. R2 桶与域名、`tools/release` 中的 OpenPixo 元数据和上传子命令。
3. 更新源与 What's new 默认值改造，加 updater 夹具测试。
4. 签名证书接入（等证书到位）。
5. `openpixo-release.yml` 流水线 + 冒烟，删除上游发布工作流。
6. 下载页、changelog、配方画廊生成脚本。
7. v0.3 页面（价格、条款、退款、支付结果）；v0.4 商店目录页。

## 5. 测试

- 生成脚本：给定版本元数据和 CHANGELOG，输出的 HTML 与快照一致；链接全部为站内或白名单域名。
- 更新：用 `tools-serve` 夹具测试新版本、相同版本、元数据被篡改（sha256 不匹配）、元数据地址为空时禁用。
- 流水线：在 fork 或测试仓库里用测试桶跑一次完整的 beta 发布和回滚。
- 静态页：链接检查，以及 1280/768/390/320 px 下的视觉检查（沿用已有的官网验收方法）。

## 6. 验收

1. 官网通过 HTTPS 访问，中英页面互通，下载页的安装包可下载且 SHA256 一致。
2. 干净的 Windows 机器下载、安装、首启成功，SmartScreen 提示符合所用证书的预期（使用 EV 证书时不应出现警告）。
3. 已安装的 `0.2.0-beta.1` 能通过应用内更新升级到 `0.2.0-beta.2`；把更新元数据改坏后，应用拒绝更新。
4. 整个首启和更新过程中没有访问上游域名的请求。

## 7. 开放问题

- 官网、下载和 registry 的域名。
- 代码签名证书类型（OV、EV 或 Azure Trusted Signing）和费用。
- 公开源码仓库的位置（与 ADR 0006 中的开放问题相同）。
- 官网是否需要统计。
