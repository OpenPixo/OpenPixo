/**
 * OPEND-3108 · 侧栏项目入口与项目列表页标题叫「我的游戏」，英文 "My games"，2 语齐。
 *
 * 撤回 OPEND-3142 的「项目」命名（G4 #8153）：Demo 877980fb17 的 `entry.navDrafts`
 * 即「我的游戏」，页面内保留 最近浏览过 / 个人项目 两个 tab。只改值，
 * 不改键：`entry.navDrafts`（入口 aria-label 与 `/drafts` 页标题）和
 * `workspaceSwitcher.draftsTooltip`（入口可见文案）。
 *
 * 反向对照钉住旧值：光断言新值，一个把词典塞回「项目」或「个人项目」的回归也能过。
 */
import { describe, expect, it } from 'vitest';

import { LOCALES, type Dict, type Locale } from '../../src/i18n/types';

async function loadDict(locale: Locale): Promise<Dict> {
  const module = await import(`../../src/i18n/locales/${locale}.ts`);
  const dict = Object.values(module).find((value): value is Dict => {
    return Boolean(value) && typeof value === 'object';
  });
  if (!dict) throw new Error(`No dictionary export found for locale ${locale}`);
  return dict;
}

const RENAMED_KEYS = ['entry.navDrafts', 'workspaceSwitcher.draftsTooltip'] as const;

/** 「我的游戏」在每个语言里的写法。 */
const MY_GAMES: Record<Locale, string> = {
  en: 'My games',
  'zh-CN': '我的游戏',
};

describe('OPEND-3108 · 「项目」→「我的游戏」', () => {
  it('English reads "My games" and Simplified Chinese reads 「我的游戏」', async () => {
    const en = await loadDict('en');
    const zh = await loadDict('zh-CN');
    for (const key of RENAMED_KEYS) {
      expect(en[key]).toBe('My games');
      expect(zh[key]).toBe('我的游戏');
    }
  }, 30_000);

  it.each(LOCALES)('%s: the entry and the page title read "My games" in that locale', async (locale) => {
    const dict = await loadDict(locale);
    for (const key of RENAMED_KEYS) {
      expect(dict[key], `${locale} ${key}`).toBe(MY_GAMES[locale]);
      // Neither the G4 「项目」 noun nor the older 「个人项目」 may come back.
      expect(dict[key], `${locale} ${key} still says "Projects"`).not.toBe(dict['entry.navProjects']);
    }
  }, 30_000);

  it.each(LOCALES)('%s: the recent collection tab is translated', async (locale) => {
    const dict = await loadDict(locale);
    expect(dict['recentProjects.collectionRecent'], `${locale} recent`).toBeTruthy();
  }, 30_000);
});
