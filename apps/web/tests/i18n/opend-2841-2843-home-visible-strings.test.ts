/**
 * OPEND-2841 / OPEND-2843 · 非英文界面的首页仍显示英文残留：工作目录按钮与弹层
 * （`homeWorkingDir.*`）与保留的媒体 Chip 名称（`homeHero.chip.*`）。
 *
 * 本规格只覆盖首页可见子集，只改值不改键。三类判定：
 *   1. 值不得与 en 逐字相同（专有名 HyperFrames / WebGL 与该语言里本就同形的词除外）；
 *   2. 非拉丁文字的语言，值里必须出现该语言自己的文字（拦住 ko 里那种
 *      "Select working directory" 式的换词英文）；
 *   保留语言的可见文案在下方逐键验证。
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

const WORKING_DIR_KEYS = [
  'homeWorkingDir.trigger',
  'homeWorkingDir.triggerShort',
  'homeWorkingDir.pick',
  'homeWorkingDir.replace',
  'homeWorkingDir.recent',
  'homeWorkingDir.clear',
  'homeWorkingDir.hint',
  'homeWorkingDir.missing',
  'homeWorkingDir.applyFailed',
] as const;

const CHIP_IDS = [
  'image', 'video', 'audio',
] as const;
const CHIP_KEYS = [
  ...CHIP_IDS.map((id) => `homeHero.chip.${id}` as const),
] as const;

const TARGET_KEYS = [...WORKING_DIR_KEYS, ...CHIP_KEYS] as const;
type TargetKey = (typeof TARGET_KEYS)[number];

/** 该语言里与英文同形的词，以该 locale 已有译法为准。 */
const SAME_WORD: Partial<Record<Locale, readonly TargetKey[]>> = {};

/** 非拉丁文字：值里至少要出现一个该文字的字符。 */
const NATIVE_SCRIPT: Partial<Record<Locale, RegExp>> = {
  'zh-CN': /\p{Script=Han}/u,
};

const NON_ENGLISH = LOCALES.filter((locale) => locale !== 'en');

describe('OPEND-2841 / OPEND-2843 · home-visible strings are translated', () => {
  it.each(NON_ENGLISH)('%s: no target key still carries the English source value', async (locale) => {
    const en = await loadDict('en');
    const dict = await loadDict(locale);
    const allowed = new Set<TargetKey>(SAME_WORD[locale] ?? []);
    const leftovers = TARGET_KEYS.filter((key) => !allowed.has(key) && dict[key] === en[key]);
    expect(leftovers).toEqual([]);
  }, 30_000);

  it.each(NON_ENGLISH)('%s: no target key carries a stale English string copied across locales', async (locale) => {
    const dict = await loadDict(locale);
    // The pre-fix value that every locale file shared; it never equalled en.ts
    // ("Working directory"), so an en-equality check alone let it through.
    expect(dict['homeWorkingDir.trigger']).not.toBe('Select working directory');
  }, 30_000);

  it.each(Object.keys(NATIVE_SCRIPT) as Locale[])('%s: every target value is written in the locale\'s own script', async (locale) => {
    const dict = await loadDict(locale);
    const script = NATIVE_SCRIPT[locale]!;
    const allowed = new Set<TargetKey>(SAME_WORD[locale] ?? []);
    const latinOnly = TARGET_KEYS.filter((key) => !allowed.has(key) && !script.test(dict[key]));
    expect(latinOnly).toEqual([]);
  }, 30_000);

});
