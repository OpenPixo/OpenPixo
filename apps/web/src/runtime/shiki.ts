import type { BundledLanguage, HighlighterGeneric } from 'shiki/bundle/full';

let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null;

const cache = new Map<string, string>();
const CACHE_MAX = 128;

/*
 * The full bundle, not `shiki/bundle/web`: game code is C#, GDScript, HLSL and
 * Lua, which the web bundle does not have. Every grammar is its own chunk and
 * loads on first use, so nothing is fetched until a file asks for it.
 *
 * ⚠️ This used to ask the web bundle for `rust` at startup. It has no such
 * grammar, so createHighlighter rejected, and every code block and file view
 * in the app silently went without colours.
 */
function getHighlighter(): Promise<HighlighterGeneric<any, any>> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/full').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-light-default', 'github-dark-default'],
        langs: [],
      }),
    );
    highlighterPromise.catch(() => { highlighterPromise = null; });
  }
  return highlighterPromise;
}

/** The highlighter with `lang` loaded, or null when no grammar goes by that name. */
async function highlighterFor(lang: string): Promise<HighlighterGeneric<any, any> | null> {
  const highlighter = await getHighlighter();
  if (highlighter.getLoadedLanguages().includes(lang as any)) return highlighter;
  const { bundledLanguages } = await import('shiki/bundle/full');
  if (!Object.hasOwn(bundledLanguages, lang)) return null;
  await highlighter.loadLanguage(lang as BundledLanguage);
  return highlighter;
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const dark = isDarkMode();
  const cacheKey = `${dark ? 'd' : 'l'}:${lang}:${code}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const highlighter = await highlighterFor(lang);
  if (!highlighter) return '';

  const html = highlighter.codeToHtml(code, {
    lang,
    theme: dark ? 'github-dark-default' : 'github-light-default',
  });

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(cacheKey, html);
  return html;
}

export interface CodeToken {
  content: string;
  color?: string | undefined;
}

/** Past this, a line record stays plain: highlighting would stall the chat for a log nobody reads closely. */
const TOKENS_MAX_CHARS = 120_000;

const tokenCache = new Map<string, CodeToken[][]>();

/**
 * Lines of coloured tokens, for callers that draw their own lines (a diff, a
 * command). Null when the language is unknown or the text is too long: the
 * caller keeps showing plain text, so a failed highlight costs nothing.
 */
export async function highlightTokens(code: string, lang: string): Promise<CodeToken[][] | null> {
  if (!code || code.length > TOKENS_MAX_CHARS) return null;
  const dark = isDarkMode();
  const cacheKey = `${dark ? 'd' : 'l'}:${lang}:${code}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;
  const highlighter = await highlighterFor(lang);
  if (!highlighter) return null;
  const lines = highlighter
    .codeToTokensBase(code, { lang: lang as any, theme: dark ? 'github-dark-default' : 'github-light-default' })
    .map((line) => line.map((token) => ({ content: token.content, color: token.color })));
  if (tokenCache.size >= CACHE_MAX) {
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(cacheKey, lines);
  return lines;
}
