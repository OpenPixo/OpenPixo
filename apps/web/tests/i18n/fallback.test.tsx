// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { I18nProvider, tForLanguageTag, useI18n } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

it('uses stable English translation helpers without a provider', () => {
  const { result, rerender } = renderHook(() => useI18n());
  const translator = result.current.t;
  expect(result.current.locale).toBe('en');
  expect(translator('fileViewer.uploadingFile')).toBe(en['fileViewer.uploadingFile']);
  rerender();
  expect(result.current.t).toBe(translator);
});

it('uses the complete Chinese dictionary for Chinese language tags', () => {
  const { result } = renderHook(() => useI18n(), {
    wrapper: ({ children }) => <I18nProvider initial="zh-CN">{children}</I18nProvider>,
  });
  const key = 'fileViewer.uploadingFile';
  expect(result.current.t(key)).toBe(zhCN[key]);
  expect(tForLanguageTag('zh-Hant-TW')?.(key)).toBe(zhCN[key]);
  expect(document.documentElement.getAttribute('dir')).toBe('ltr');
});

it('lets unbundled language tags fall back to the caller translation', () => {
  expect(tForLanguageTag('ja')).toBeNull();
  expect(tForLanguageTag('ar')).toBeNull();
  expect(tForLanguageTag(undefined)).toBeNull();
});
