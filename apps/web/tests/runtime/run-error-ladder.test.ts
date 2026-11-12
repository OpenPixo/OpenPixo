// 红测(E1 / E4 / E6):报错卡的主按钮必须由「失败的性质」推导,而不是每一档手挑一颗。
//
// 权威:`docs/coordination/archive/run-error-catalog.md` §6.Z(阶梯)、§6.T(阶梯 ↔ F0–F10)、
// §6.X(逐条裁决);`docs/design/run-errors/error-ux-design.md`(32 个场景 + 频次表)。
//
// 在补映射之前这一整份都是红的:
//   - `primaryActionForFailure` / `RunFailureNature` 不存在(阶梯函数没写);
//   - `'contact-support'` 不是 `RunFailurePrimaryAction` 的成员(第 4 档没有出口);
//   - S19(进程异常退出,每月 20,868 次、第二大类)三张表里一档都没有,整个落兜底;
//   - `account_suspended`(封号)没有分类,落兜底 → 拿到一颗必然白点的〔重试〕。
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * en/zh-CN 语言包的路径 —— 从磁盘数,不写死清单。
 *
 * 不用 `import.meta.glob`:那是 Vite 的编译期语法,`tsc` 不认(`apps/web` 的
 * typecheck 里 `ImportMeta` 上没有 `glob`),会在 CI 上红成类型错。读目录既能
 * 通过类型检查,也保留了「新增一个语种自动进覆盖」的性质。
 */
const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/i18n/locales');

function localeModulePaths(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => join(LOCALES_DIR, name));
}

async function loadLocaleDict(path: string): Promise<Record<string, string>> {
  const mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
  return (mod.default ?? Object.values(mod)[0]) as Record<string, string>;
}

import { resolveRunFailureUi, RUN_FAILURE_FALLBACK_MESSAGE_KEY } from '../../src/runtime/failure-guidance';




describe('原则四:重试只在有用时出现', () => {
  // 设计原则四逐字点名的三类。§6.Z:「第 4 档正好兜住原则四:额度用完、
  // 账号被封、CPU 不支持这三类拿不到重试」。这三条各自的依据:
  //   - 额度用完  hard_quota            → §6.Z 点名裁决(S08,每月 23,333 次、P0 最大类)
  //   - 账号被封  account_suspended     → §6.Z 原则四那一句 + 主表 R-064(「卡(联系支持,不给 Retry)」)
  //   - CPU 不支持 cpu_unsupported      → §6.Z 原则四那一句
  it.each([
    ['hard_quota' as const],
    ['account_suspended' as const],
    ['cpu_unsupported' as const],
  ])('%s 拿不到任何形态的重试', (detail) => {
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', detail, 'claude');
    expect(ui.primaryAction).not.toBe('retry');
    expect(ui.secondaryRetry).toBe(false);
  });

  

  // R-031 主表:「后续流程 F10 反馈」「可重试:不可」。文案本来就写着
  // 「请更新到最新版本或联系支持」,今天给的却是一颗重试 —— 按钮和句子对不上。
  it('运行时定义非法落第 4 档,不再给一颗白点的重试', () => {
    const ui = resolveRunFailureUi('AGENT_RUNTIME_DEF_INVALID', null, 'claude');
    expect(ui.primaryAction).toBe('contact-support');
    expect(ui.secondaryRetry).toBe(false);
  });
});



describe('兜底不许把上游原文摊在卡面(E2)', () => {
  // 兜底文案是一条真实存在的 i18n 键,不是 `null`。ChatPane 拿它替掉
  // 「没命中映射表就直接渲染 rawError」那条路。
  it('导出了一条兜底文案键', () => {
    expect(RUN_FAILURE_FALLBACK_MESSAGE_KEY).toBe('chat.runError.fallbackMessage');
  });
});

describe('新文案进了 en/zh-CN 语言包', () => {
  // 新键必须在全部 两个 locale 里都有真值 —— 缺一个,那个语种的用户会在卡上
  // 看到一条裸键名。顺带:这条会把 两个 locale 文件全 import 一遍,所以它同时
  // 是一次语法体检。
  const NEW_KEYS = [
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
    'chat.runError.title.accountSuspended',
    'chat.runError.accountSuspendedMessage',
    'chat.runError.fallbackMessage',
  ] as const;

  // 显式给宽超时:这一条要现场 transform 两个 locale 文件,机器忙的时候
  // 会逼近 vitest 默认的 5s —— 那种红是环境噪音,不是回归。
  it('每个语种都有这五条,且都不是空串', { timeout: 30_000 }, async () => {
    const paths = localeModulePaths();
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const dict = await loadLocaleDict(path);
      for (const key of NEW_KEYS) {
        expect(typeof dict[key], `${path} → ${key}`).toBe('string');
        expect(dict[key]!.trim().length, `${path} → ${key}`).toBeGreaterThan(0);
      }
    }
  });

  // 这一条以前钉的是反面:旧稿 S19 那句写作「{智能体} 意外退出了」,插值位不能
  // 在翻译里掉。产品 2026-09-06 的《报错文案｜精简版》把这一格重写成
  // 「任务意外中断 / 请尝试重新生成，或更换模型后重试。如果问题持续出现，请联系支持。」
  // —— 新句子里**没有**任何插值位,所以现在要钉的是它别被某个语种偷偷加回来:
  // 半退回的旧译文正是这条文案最可能的回归形状(参见 locales.test.ts 里
  // `cliSessionRefusedMessage` 的 `{version}` 守卫,同一个手法)。
  it('S19 文案每个语种都不带插值位', { timeout: 30_000 }, async () => {
    for (const path of localeModulePaths()) {
      const dict = await loadLocaleDict(path);
      expect(dict['chat.runError.agentCrashedMessage'], path).not.toMatch(/\{\w+\}/);
    }
  });
});


