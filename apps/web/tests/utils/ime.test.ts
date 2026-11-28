import { describe, expect, it } from 'vitest';

import { isImeComposing, isSubmitEnter } from '../../src/utils/ime';

describe('isImeComposing', () => {
  it('reads composition from a DOM event and from a React event', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('treats keyCode 229 as composing: Safari ends composition before the keydown arrives', () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { keyCode: 229 } })).toBe(true);
  });
});

describe('isSubmitEnter', () => {
  it('is a plain Enter that is not confirming a candidate', () => {
    expect(isSubmitEnter({ key: 'Enter' })).toBe(true);
    expect(isSubmitEnter({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(false);
    expect(isSubmitEnter({ key: 'a' })).toBe(false);
  });
});
