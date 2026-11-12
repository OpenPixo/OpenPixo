import { describe, expect, it } from 'vitest';

import { shareErrorMessage } from '../../../src/components/game/share-errors';
import { en } from '../../../src/i18n/locales/en';
import { zhCN } from '../../../src/i18n/locales/zh-CN';
import type { Dict } from '../../../src/i18n/types';

const zh = (key: keyof Dict) => zhCN[key];
const english = (key: keyof Dict) => en[key];

describe('shareErrorMessage', () => {
  it('shows an English UI the words the cloud wrote, because they carry the specifics', () => {
    const error = { code: 'PUBLISH_QUOTA', message: 'You reached the daily publish limit.' };
    expect(shareErrorMessage(error, english, 'en')).toBe('You reached the daily publish limit.');
  });

  it.each([
    ['PUBLISH_PAUSED', 'gameShare.error.paused'],
    ['PUBLISH_REFUSED', 'gameShare.error.refused'],
    ['PUBLISH_QUOTA', 'gameShare.error.quota'],
    ['SHARE_TERMS_REQUIRED', 'gameShare.error.termsRequired'],
    ['SHARE_NOT_FOUND', 'gameShare.error.notFound'],
    ['PUBLISH_EXTRA_GAME_REQUIRED', 'gameShare.error.extraGameRequired'],
    ['PUBLISH_FAILED', 'gameShare.error.failed'],
    ['CONFLICT', 'gameShare.error.conflict'],
    ['CLOUD_UNAVAILABLE', 'account.error.cloudUnavailable'],
    ['ACCOUNT_SIGNED_OUT', 'account.error.signedOut'],
  ] as const)('translates %s in a Chinese UI', (code, key) => {
    expect(shareErrorMessage({ code, message: 'Words in English.' }, zh, 'zh-CN')).toBe(zhCN[key]);
  });

  it('falls back to the raw words only for a code it does not know', () => {
    expect(shareErrorMessage({ code: 'SOMETHING_NEW', message: 'New words.' }, zh, 'zh-CN')).toBe('New words.');
  });

  it('keeps the build log after the translated sentence', () => {
    const error = { code: 'PUBLISH_BUILD_FAILED', message: 'The build failed.\nerror TS2304: nope' };
    expect(shareErrorMessage(error, zh, 'zh-CN')).toBe(`${zhCN['gameShare.error.buildFailed']}\nerror TS2304: nope`);
  });

  it('says nothing when there is nothing to say, so the dialog uses its generic line', () => {
    expect(shareErrorMessage(undefined, zh, 'zh-CN')).toBeNull();
    expect(shareErrorMessage({ code: null, message: null }, zh, 'zh-CN')).toBeNull();
    expect(shareErrorMessage({ code: null, message: '  ' }, english, 'en')).toBeNull();
  });

  it('falls back to the dictionary when an English reply has a code and no words', () => {
    expect(shareErrorMessage({ code: 'PUBLISH_PAUSED', message: '' }, english, 'en')).toBe(en['gameShare.error.paused']);
  });
});
