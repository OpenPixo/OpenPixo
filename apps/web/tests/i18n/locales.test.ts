import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveSystemLocale } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { LOCALES, LOCALE_LABEL, type Dict, type Locale } from '../../src/i18n/types';

const DICTS: Record<Locale, Dict> = { en, 'zh-CN': zhCN };

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]!).sort();
}

function explicitLocaleKeys(locale: Locale): string[] {
  const source = readFileSync(new URL(`../../src/i18n/locales/${locale}.ts`, import.meta.url), 'utf8');
  return Array.from(source.matchAll(/^\s*['"]([^'"]+)['"]:/gm), (match) => match[1] ?? '').filter(Boolean);
}

describe('i18n locales', () => {
  it.each(LOCALES)('names fal in %s only as one choice for the user\'s own image key', (locale) => {
    const naming = Object.entries(DICTS[locale]).filter(([, value]) => /\bfal\b|fal\.(?:ai|run|media)|fal-ai/i.test(String(value)));
    expect(naming.map(([key]) => key)).toEqual(['onboarding.imageKeyBody']);
  });

  it('resolves the initial locale from supported browser language preferences', () => {
    expect(resolveSystemLocale(['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh-Hant-HK', 'en-US'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh-TW'])).toBe('zh-CN');
    expect(resolveSystemLocale(['EN-gb'])).toBe('en');
    expect(resolveSystemLocale(['pt-PT', 'en-US'])).toBe('en');
    expect(resolveSystemLocale(['es-MX', 'en-US'])).toBe('en');
    expect(resolveSystemLocale(['nl-NL'])).toBeNull();
    expect(resolveSystemLocale(['ar', 'de', 'fa', 'ja', 'ko'])).toBeNull();
  });

  it('registers only English and Simplified Chinese in the language menu', () => {
    expect(LOCALES).toEqual(['en', 'zh-CN']);
    expect(LOCALE_LABEL).toEqual({ en: 'English', 'zh-CN': '简体中文' });
  });

  it('labels game and legacy fallback projects in every supported locale', () => {
    expect(en['designs.tagPrototype']).toBe('Game');
    expect(zhCN['designs.tagPrototype']).toBe('游戏');
    expect(en['homeHero.chip.prototype']).toBe('Game');
    expect(zhCN['homeHero.chip.prototype']).toBe('游戏');
  });

  it('requires complete dictionaries with matching keys and placeholders', () => {
    const englishKeys = Object.keys(en).sort();
    for (const locale of LOCALES) {
      const dict = DICTS[locale];
      expect(Object.keys(dict).sort()).toEqual(englishKeys);
      for (const key of englishKeys) {
        const dictKey = key as keyof Dict;
        expect(placeholders(dict[dictKey]), `${locale}.${key}`).toEqual(placeholders(en[dictKey]));
      }
    }
  });

  it('keeps Chinese integrations copy translated', () => {
    const translatedKeys: Array<keyof Dict> = [
      'entry.navIntegrations', 'integrations.kicker', 'integrations.lede', 'integrations.agentReady',
      'integrations.tabLabel.mcp', 'integrations.tabLabel.skills', 'integrations.tabHint.mcp',
      'integrations.tabHint.useEverywhere', 'integrations.skillsTitle', 'integrations.skillsBody',
      'mcpClient.title', 'mcpClient.subtitle', 'mcpClient.addServer', 'mcpClient.emptyTitle',
      'mcpClient.emptyBody', 'mcpClient.saveChanges', 'mcpClient.storedAt', 'mcpClient.daemonError',
      'mcpClient.saveFailed', 'tasks.comingSoon',
    ];
    for (const key of translatedKeys) expect(zhCN[key], `zh-CN.${key}`).not.toBe(en[key]);
  });

  it('explains API provider draft activation in English and Chinese', () => {
    expect(en['settings.byokDraftNotice']).toBe(
      'Complete the required fields to save this provider. Your current setup will remain active.',
    );
    expect(zhCN['settings.byokDraftNotice']).toBe(
      '填写必填项后即可保存此提供商；当前配置将继续保持生效。',
    );
  });

  it('keeps zh-CN explicitly translated for every English key', () => {
    expect(explicitLocaleKeys('zh-CN').sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps the zh-CN locale source free of the `...en` spread fallback', () => {
    const source = readFileSync(new URL('../../src/i18n/locales/zh-CN.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.\.\.en\b/);
  });

  it('translates the integrity label: it is a word, not a brand', () => {
    expect(DICTS.en['plugins.availableDetails.integrity']).toBe('Integrity');
    expect(DICTS['zh-CN']['plugins.availableDetails.integrity']).toBe('完整性校验');
  });

  // This dormant key still describes first output, so preserve its non-empty
  // text and guard the previously observed input/output direction mix-up.
  it('never says "waiting for first INPUT" in any locale (assistant.waitingFirstOutput)', () => {
    for (const locale of LOCALES) {
      const value = DICTS[locale]['assistant.waitingFirstOutput'];
      expect(value.trim(), `${locale}.assistant.waitingFirstOutput must not be blank`).not.toBe('');
      if (locale === 'en') expect(value).not.toMatch(/\binput\b/i);
    }
  });
});
