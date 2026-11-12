# 桌面端模块

这里只统计保留产品能力。`mac.spec.ts` 中仍有条件门控的继承
Connectors/Appearance 断言，但它们不作为当前产品支持的证据；退役边界见
[ADR 0012](../../adr/0012-slim-core.md)。

## 覆盖范围

- 受环境变量控制的 mac 桌面端 smoke
- mac 打包产物安装/启动/探活生命周期
- Linux headless 与 AppImage 打包产物生命周期
- 从 desktop shell 进入设置页的关键路径

## 对应测试文件

- `e2e/specs/mac.spec.ts`
- `e2e/specs/linux.spec.ts`

## 已自动化

### Desktop shell smoke

| ID | 场景 | Gate | 来源 |
| --- | --- | --- | --- |
| DESK-001 | Desktop shell 可以打开当前 API 配置，并展示正确的 provider/model | `PIXO_DESKTOP_SMOKE=1` | `mac.spec.ts` |
| DESK-002 | 在桌面端设置里切换 API protocol 时，legacy provider tracking 保持一致 | `PIXO_DESKTOP_SMOKE=1` | `mac.spec.ts` |
| DESK-004 | Desktop shell 可以打开 Local CLI 设置，并在 BYOK / Local CLI 间切换而不丢失已保存字段 | `PIXO_DESKTOP_SMOKE=1` | `mac.spec.ts` |
| DESK-007 | Desktop shell 可以打开 Media providers 并看到 provider controls | `PIXO_DESKTOP_SMOKE=1` | `mac.spec.ts` |
| DESK-008 | Desktop shell 可以打开 About，并显示版本详情或 daemon offline 占位 | `PIXO_DESKTOP_SMOKE=1` | `mac.spec.ts` |

### 打包运行时 smoke

| ID | 场景 | Gate | 来源 |
| --- | --- | --- | --- |
| DESK-101 | 构建出的 mac 安装包可以完成安装、启动、健康检查、停止和卸载 | `PIXO_PACKAGED_E2E_MAC=1` | `mac.spec.ts` |
| DESK-201 | Linux headless 打包运行时可完成安装、启动、status/logs 检查、停止、卸载和 cleanup | `PIXO_PACKAGED_E2E_LINUX_HEADLESS=1` | `linux.spec.ts` |
| DESK-202 | Linux AppImage 可完成安装、启动、eval/截图探活、日志检查、停止和卸载 | `PIXO_PACKAGED_E2E_LINUX_APPIMAGE=1` | `linux.spec.ts` |

## 自动化候选

| ID | 场景 | 原因 |
| --- | --- | --- |
| DESK-C01 | Windows desktop smoke | 值得补，但要等对应平台 smoke 文件和执行基础设施准备好 |
| DESK-C02 | 其余桌面端设置分区，例如 notifications、language | Local CLI、Media 与 About 已有条件门控 mac desktop smoke；其余保留分区可按风险补齐 |
| DESK-C03 | 更深入的 packaged runtime 校验 | 成本较高，适合在发布链路更稳定后逐步扩展 |

## 手工保留

| ID | 场景 | 原因 |
| --- | --- | --- |
| DESK-M01 | 真机安装体验、系统权限弹窗体验 | 强依赖真实机器环境和人工判断 |
| DESK-M02 | 不同 macOS 版本下的界面细节与交互质感 | 自动化覆盖成本高，更适合人工回归 |

## 说明

- mac desktop shell smoke 保持在 `e2e/specs/mac.spec.ts`；打包运行时 smoke 按平台分别维护在 `mac.spec.ts` 与 `linux.spec.ts`。
- `e2e/lib/desktop/**` 只放 helper，不放独立可执行用例。
