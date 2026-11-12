/**
 * OPEND-2807 · 报错卡上那颗常驻按钮从〔联系支持〕改成〔联系我们〕,2 语齐。
 *
 * 工单逐字给的是「联系我们」。这条改的**只有值**,`chat.runError.contactSupportCta`
 * 这个键本身早就在 `i18n/types.ts` 里,按钮位置、行为、testid 都不动。
 *
 * ⚠️ 稿子 `body-scene.html:302` 的 `data-tip` 写的还是「联系支持」——**工单较新,
 * 以工单为准**(同一条裁决也写在 `w124-chat-tooltips-and-panel-head.test.tsx` 里)。
 *
 * 这条扫**全部 2 个 locale**,不是只测 en:文案回归最常见的形状就是「英文改了、
 * 中文还留着旧词」。反向对照钉住旧值 —— 光断言新值,一个把整本词典
 * 塞成英文占位的回归也能过。
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

/**
 * 工单要求的最终值,逐字。**不是重译** —— 2 语的译文由 OPEND-2807 那次评审
 * 定稿,这里只是把定稿抄成判据。
 */
const CONTACT_US: Record<Locale, string> = {
  en: 'Contact us',
  'zh-CN': '联系我们',
};

/** 改之前那一版「联系支持」。命中说明这个语言被漏掉了。 */
const OLD_CONTACT_SUPPORT: Record<Locale, string> = {
  en: 'Contact support',
  'zh-CN': '联系支持',
};

describe('OPEND-2807 · 〔联系我们〕2 语齐', () => {
  it('清点:确实是 2 本词典', () => {
    expect(LOCALES.length).toBe(2);
    expect(Object.keys(CONTACT_US).length).toBe(2);
    expect(Object.keys(OLD_CONTACT_SUPPORT).length).toBe(2);
  });

  it.each(LOCALES)('%s 的值就是工单定稿那一句', async (locale) => {
    const dict = await loadDict(locale);
    expect(dict['chat.runError.contactSupportCta']).toBe(CONTACT_US[locale]);
  });

  it.each(LOCALES)('%s 不许留着旧的〔联系支持〕', async (locale) => {
    const dict = await loadDict(locale);
    expect(dict['chat.runError.contactSupportCta']).not.toBe(
      OLD_CONTACT_SUPPORT[locale],
    );
  });

  /*
   * 真空探针:上面那条 `not.toBe` 只有在「旧值确实是这些字」时才有意义。
   * 这里证明这张旧值表不是空话 —— 它和新值一一不同。
   */
  it('新旧两张表逐语言都不一样 —— 反向对照不是摆设', () => {
    LOCALES.forEach((locale) => {
      expect(CONTACT_US[locale], `${locale} 新旧值写成了同一句`).not.toBe(
        OLD_CONTACT_SUPPORT[locale],
      );
    });
  });

});
