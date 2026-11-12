// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMockOpenPixoHost } from '@openpixo/host/testing';
import { detectInitialLocale } from '../../src/i18n';

const LS_KEY = 'pixo:locale';
const LS_SOURCE_KEY = 'pixo:locale-source';

function setStoredLocale(locale: string, source: 'manual' | 'untagged' = 'manual'): void {
  window.localStorage.setItem(LS_KEY, locale);
  if (source === 'manual') {
    window.localStorage.setItem(LS_SOURCE_KEY, 'manual');
  } else {
    window.localStorage.removeItem(LS_SOURCE_KEY);
  }
}

function setNavigatorLanguages(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    get: () => languages,
  });
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    get: () => languages[0] ?? 'en',
  });
}

// Track the installed mock so each test can swap it out without leaking
// state into the next case (installMockOpenPixoHost returns an
// uninstall callback that restores the previous value).
let uninstallHost: (() => void) | null = null;

function installHostWithOsLocale(value: unknown): void {
  uninstallHost?.();
  uninstallHost = installMockOpenPixoHost({
    host: {
      // The mock host's defaultHost() already sets client.type to
      // 'desktop'; we only override the field exercised here.
      client: { osLocale: value as string | undefined },
    },
  });
}

function clearHost(): void {
  uninstallHost?.();
  uninstallHost = null;
}

describe('detectInitialLocale priority chain', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearHost();
    setNavigatorLanguages(['en-US']);
  });

  afterEach(() => {
    window.localStorage.clear();
    clearHost();
  });

  it('prefers a manually-tagged localStorage pick over host and navigator', () => {
    setStoredLocale('en', 'manual');
    installHostWithOsLocale('zh-CN');
    setNavigatorLanguages(['fr-FR']);

    expect(detectInitialLocale()).toBe('en');
  });

  it.each(['ar', 'de', 'es-ES', 'fa', 'fr', 'hu', 'id', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'zh-TW'])(
    'ignores a saved %s locale that is no longer supported', (locale) => {
      setStoredLocale(locale, 'manual');
      setNavigatorLanguages(['en-US']);

      expect(detectInitialLocale()).toBe('en');
    },
  );

  it('detects Simplified Chinese from the browser after a removed locale was saved', () => {
    setStoredLocale('de', 'manual');
    setNavigatorLanguages(['zh-Hant-TW']);

    expect(detectInitialLocale()).toBe('zh-CN');
  });

  it('ignores an untagged localStorage value when a fresh host locale is available', () => {
    setStoredLocale('en', 'untagged');
    installHostWithOsLocale('zh-CN');

    expect(detectInitialLocale()).toBe('zh-CN');
  });

  it('falls through to navigator when an unsupported locale was stored', () => {
    setStoredLocale('xx-YY', 'manual');
    setNavigatorLanguages(['zh-Hant-TW']);

    expect(detectInitialLocale()).toBe('zh-CN');
  });

  it('uses the desktop host OS locale when no localStorage pick exists', () => {
    installHostWithOsLocale('zh-CN');
    setNavigatorLanguages(['en-US']);

    expect(detectInitialLocale()).toBe('zh-CN');
  });

  it('routes packaged OS locale strings through resolveSystemLocale (zh-Hant → zh-CN)', () => {
    installHostWithOsLocale('zh-Hant-TW');
    setNavigatorLanguages(['en-US']);

    expect(detectInitialLocale()).toBe('zh-CN');
  });

  it('falls back to navigator when host osLocale is missing or not a string', () => {
    installHostWithOsLocale(undefined);
    setNavigatorLanguages(['zh-CN']);
    expect(detectInitialLocale()).toBe('zh-CN');

    installHostWithOsLocale(42);
    setNavigatorLanguages(['en-US']);
    expect(detectInitialLocale()).toBe('en');
  });

  it('falls back to navigator when host osLocale is not in the supported set', () => {
    installHostWithOsLocale('nl-NL');
    setNavigatorLanguages(['zh-HK']);

    expect(detectInitialLocale()).toBe('zh-CN');
  });

  it('falls back to en when nothing else is available', () => {
    clearHost();
    setNavigatorLanguages([]);

    expect(detectInitialLocale()).toBe('en');
  });
});
