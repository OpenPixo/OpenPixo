/**
 * The run's UI locale, as prompt text.
 *
 * Shared by the game prompt's conversation fallback and the per-turn
 * follow-up-suggestion protocol, which is also sent on resume turns.
 */

/**
 * Supported Chinese UI locale, or `null` for the English fallback.
 *
 * English is `null` on purpose rather than `'en'`: the prompts this feeds are
 * written in English, so naming it adds a rule that says nothing and moves
 * every affected prompt's bytes for no behavioural gain. Chinese regional
 * tags use Simplified Chinese; other unsupported UI locales use English.
 * This normalizes the UI fallback only, never the user's conversation language.
 */
export function normalizePromptLocale(locale: string | undefined | null): string | null {
  const normalized = typeof locale === 'string' ? locale.trim().replaceAll('_', '-').toLowerCase() : '';
  return normalized === 'zh' || normalized.startsWith('zh-') ? 'zh-CN' : null;
}

/**
 * How to name the locale to a model.
 *
 * Spell out the supported Chinese UI locale; English needs no extra rule.
 */
export function promptLanguageName(normalizedLocale: string): string {
  if (normalizedLocale === 'zh-CN') return 'Simplified Chinese';
  return normalizedLocale;
}

/**
 * The exception every locale rule in this repository carries: a localized
 * sentence still keeps the words that are names or code.
 *
 * OPEND-2765 asks for exactly this — the reported English suggestions are
 * wrong, but `localStorage` and `CTA` inside them were right. Kept as one
 * exported constant so every locale rule that needs the exception states it
 * the same way.
 */
export const PROMPT_LOCALE_EXEMPT_TERMS_SENTENCE =
  'Keep brand names, code, and technical identifiers as-is, and honor an explicit'
  + ' user request for a different output language.';
