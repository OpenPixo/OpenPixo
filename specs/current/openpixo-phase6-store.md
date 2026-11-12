# OpenPixo Phase 6：商店实施规格

状态：2026-10-26 切片 1、3、4 已在源码落地（签名目录、默认源替换、18 条免费离线快照、项目扩展 manifest v2、免费商店 HTTP/CLI/UI），未做打包验收；切片 2 发布流水线以 `tools-release openpixo registry build|sign|keygen` 形式放在本仓库，独立仓库未建；切片 5–6（付费、entitlement、签名下载）等 v0.3 积分账本。registry 域名与签名公钥未定：`OPENPIXO_REGISTRY`（`packages/contracts/src/product.ts`）为空时只用离线快照。所属版本 v0.4。上游：路线文档 §4 Phase 6 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`)。已定：首版只卖官方条目，用积分购买，与生成共用积分账本；创作者分成后置（决策记录 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`) 第 7 项）。依赖：v0.3 的账号与积分账本（CLOUD-CREDITS-LAUNCH-PLAN.md (openpixo-internal: `docs/CLOUD-CREDITS-LAUNCH-PLAN.md`)）；Phase 4 的配方格式。

## 1. 目标

用户在应用里浏览 OpenPixo 官方目录，一键安装 skill、配方、MCP 接入、项目模板、素材包和角色卡，在项目里启用、更新、卸载。付费条目用积分购买，购买后可以在同一账号的任何设备下载。

不在本阶段：第三方上架和分成、订阅制条目、商店网页端购买（官网只展示目录）、团队授权。

## 2. 现状与接缝

| 接缝 | 现状 | 本阶段动作 |
| --- | --- | --- |
| 市场源 `plugins/marketplaces.ts` + 表 `plugin_marketplaces` | 可添加多个目录源，信任分级 `official/trusted/restricted` | 复用；默认源换成 OpenPixo |
| 默认源 `marketplace-seed.ts` | 内置官方目录来自仓库本地；公开源与网站为空 | 替换为 OpenPixo registry；移除上游地址 |
| 预装 `plugins/registry/official/openpixo-marketplace.json` | 游戏相关离线条目，预装数量以当前清单为准 | 换成精选的游戏条目 |
| 安装器 `plugins/installer.ts` | 支持 `github:` tarball 和归档，带 `archiveIntegrity`（sha256）校验，拒绝路径穿越和链接 | 复用；新增「签名 URL 下载」来源 |
| 已装记录 `installed_plugins` | 记录来源、版本、digest、所属市场和信任 | 复用 |
| 权限 `plugins/trust.ts` | 按信任等级授予能力（`prompt:inject`、`fs:write` 等） | 复用 |
| 项目扩展 `services/project-extensions.ts` | 自己维护每个项目的 manifest JSON，自己复制 skill 目录 | 改为引用已装插件 |
| UI `MarketplaceView.tsx`、`PluginDetailView.tsx` | 上游市场界面 | 改造为 OpenPixo 商店 |
| CLI `pixo plugin *`、`pixo marketplace *` | 30 余个子命令 | 复用，补付费相关命令 |

## 3. 设计

### 3.1 Registry

- 托管：Cloudflare R2 + 自定义域名（域名待定，下文写作 `<registry-host>`），经 CDN 缓存。
- 结构：

```text
<registry-host>/v1/marketplace.json        目录（marketplace.v1 schema + OpenPixo 扩展）
<registry-host>/v1/marketplace.json.sig    目录签名
<registry-host>/v1/previews/<item>/<ver>/… 预览图
<registry-host>/v1/free/<item>/<ver>.zip   免费包（公开）
R2 私有前缀 paid/<item>/<ver>.zip           付费包（不公开，只能用签名 URL 下载）
```

- 目录条目扩展字段（在现有 `MarketplacePluginEntry` 上 passthrough）：

```json
{
  "name": "openpixo/sprite-walk-8dir",
  "version": "0.2.0",
  "kind": "recipe",
  "engines": ["any"],
  "pricing": { "type": "paid", "credits": 300, "sku": "item.sprite-walk-8dir" },
  "license": "OpenPixo-Item-License-1.0",
  "assetLicense": { "commercialUse": true, "attributionRequired": false },
  "archive": { "url": "paid", "integrity": "sha256-…", "size": 123456 },
  "previews": ["previews/sprite-walk-8dir/0.2.0/1.webp"],
  "requires": { "openpixo": ">=0.4.0", "capabilities": ["media-cli"] }
}
```

- 签名：发布流水线用 Ed25519 私钥对 `marketplace.json` 签名；公钥随应用打包。daemon 拉取目录后先验签，验签失败则不更新本地缓存并显示「目录校验失败」。只有验签通过的源才能是 `official` 信任等级。
- 离线：安装包内随带一份精选目录快照和免费条目的包，首次启动无网络也能用。

### 3.2 发布流水线

独立仓库（如 `openpixo-registry`，名称待定），存放条目源文件。GitHub Actions：

1. 对每个改动条目运行 `pixo plugin validate`、`pixo plugin doctor`；配方还要检查 `evals/` 里有真实运行的记录（Phase 4 的上架门槛）。
2. 许可证与 IP 检查：必须有 `license`；素材包必须有 `assetLicense`；提示词和预览里含已知商业 IP 名称的条目阻止发布（关键词表 + 人工复核）。
3. 打包为 zip，计算 sha256，上传 R2（免费包到公开前缀，付费包到私有前缀）。
4. 生成 `marketplace.json`，签名后上传。
5. 需要维护者批准的 environment 保护发布步骤。

仓库内的现有 `plugins/registry/` 只保留离线快照的生成脚本。

### 3.3 客户端：安装、启用、更新

- 默认源：首次启动注册 `openpixo-official` 源（`<registry-host>/v1/marketplace.json`，信任 `official`）。用户仍可添加其他源，按现有规则默认 `restricted`。
- 免费条目：沿用现有安装器，从目录里的 URL 下载，校验 `integrity` 后安装。
- 付费条目：见 3.4。
- 项目启用合并：`project-extensions` 的 manifest 从 v1 升级到 v2，条目改为 `{ kind, pluginId, version, enabled }`，指向 `installed_plugins` 的记录，不再复制目录。迁移时把 v1 里以本地/GitHub 导入的 skill 先登记为已装插件（`source_kind` 保留原来源），再写 v2 引用；迁移前备份 v1 文件。MCP 条目同理。
- 更新：沿用「用户主动触发」原则。目录有新版本时显示提示；付费条目的更新在已购买的版本范围内免费。
- 卸载：从项目中移除不会删除项目产物（沿用现有规则）；卸载插件本身时，如果有项目仍在启用，先列出这些项目再确认。

### 3.4 付费购买与下载

云端（Supabase，沿用 CLOUD-CREDITS 计划的账本和事务模式）：

```sql
create table store_items (
  sku text primary key, item_name text not null, credits integer not null check (credits > 0),
  version_range text not null, active boolean not null default true, price_version integer not null
);
create table entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  sku text not null references store_items(sku),
  version_range text not null,
  ledger_entry_id uuid not null,         -- the credit debit that paid for it
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, sku)
);
```

RLS：用户只能读自己的 `entitlements`；所有写入只能由 Edge Function 用服务角色完成。

Edge Functions：

- `store-purchase`：参数 `{ sku, priceVersion, idempotencyKey }`。在一个事务里校验 SKU 有效且价格版本匹配、余额足够、尚未拥有，然后写扣费流水和 entitlement。同一幂等键重复调用返回同一结果；参数不同则拒绝。
- `store-download`：参数 `{ sku, version }`。校验 entitlement 覆盖该版本后，返回 5 分钟有效的 R2 签名 URL 和 `integrity`。不返回付费包的永久地址。

本地 daemon：

- `POST /api/store/purchase` → 调 `store-purchase`；`POST /api/store/install` → 必要时先调 `store-download`，再走安装器（来源类型新增 `signed-url`，校验 integrity）。
- 购买前的确认界面显示条目、积分价格和购买后余额。确认只能来自 UI 点击或交互式 CLI 确认，Agent 不能代替用户购买（与 CLOUD-CREDITS 计划里「Agent 工具授权不等于支付授权」一致）。
- 已安装的付费条目离线可用，运行时不再联网校验授权。这是有意的简化：接受被复制的风险，换取离线可用和实现简单。
- 退款：按 CLOUD-CREDITS 计划的冲正流水处理；退款后 `revoked_at` 置位，客户端下次同步时把条目标为「授权已撤销」，不自动删除用户已经用它生成的项目文件。

### 3.5 HTTP 与 CLI

```text
GET  /api/store/catalog?kind&engine&q&pricing      pixo store list [--kind] [--engine] [--free|--paid] [--json]
GET  /api/store/items/:name                         pixo store info <name> [--json]
POST /api/store/purchase                            pixo store buy <name> [--yes] [--json]     # 交互确认，--yes 仅限人工终端
GET  /api/store/purchases                           pixo store purchases [--json]
POST /api/store/install                             pixo store install <name>[@version] [--project <id>] [--json]
```

`pixo store install` 对免费条目等价于 `pixo plugin install`；`--project` 表示安装后在该项目中启用。`pixo store buy` 在检测到 tool token（即由 Agent 调用）时直接拒绝。

### 3.6 UI

- 侧栏「商店」入口；分类：配方、skill、MCP 接入、项目模板、素材包、角色卡；筛选：引擎、免费/付费。
- 条目页：预览、说明、许可证摘要（可商用与否）、所需能力和依赖、版本历史、「安装」或「用 N 积分购买」。
- 已购买页：列出 entitlement 和可更新版本。
- 项目「扩展」页显示来自商店的条目和它们的版本。

## 4. 实施切片

1. registry 格式扩展 + 签名验证 + 默认源替换 + 离线快照（只含免费条目）。
2. 发布流水线（独立仓库）和首批免费条目。
3. 项目扩展 manifest v2 迁移。
4. 商店 UI 与 `pixo store` 免费部分。
5. 云端 `store_items`/`entitlements` + 两个 Edge Function + RLS 测试。
6. 付费购买、签名下载、已购买页、退款撤销同步。

切片 1–4 不依赖 v0.3，可以先做；5–6 依赖积分账本上线。

## 5. 测试

- 签名：篡改目录、换公钥、缺签名文件都拒绝更新缓存；离线快照可用。
- 安装：integrity 不匹配、路径穿越、超大包、签名 URL 过期。
- 迁移：v1 manifest 含本地导入、GitHub 导入、MCP 条目的各种组合迁移后行为一致；迁移失败可回滚到备份。
- 云端：重复购买幂等；余额不足；并发两次购买同一 SKU 只扣一次；价格版本过期；伪造 JWT；他人 entitlement 不可读；退款后下载被拒。
- CLI：`pixo store buy` 在有 tool token 时拒绝。
- e2e：用本地 `tools-serve` 起一个假 registry（扩展现有 updater fixture 服务）和假的 Supabase 函数，跑浏览、安装、启用、更新、卸载。

## 6. 验收

1. 干净安装后断网启动，离线快照里的免费条目可浏览和安装。
2. 联网后从 OpenPixo registry 安装一个免费配方，在项目里启用并成功运行。
3. 测试账号用测试积分购买一个付费配方：只扣一次积分，换一台设备登录后可以下载同一条目。
4. 退款后该条目在客户端显示「授权已撤销」，新下载被拒绝，已生成的项目文件不受影响。
5. 每个上架条目都声明了许可证；素材包都声明了是否可商用。

## 7. 开放问题

- registry 域名和独立仓库名称。
- 付费条目的定价、版本范围策略（例如「0.x 内免费更新」）和退款细则，正式收款前确认。
- 离线快照随安装包携带多少条目（影响安装包体积）。
- 将来开放第三方上架时，签名是否改为「平台签目录、作者签包」两级。
