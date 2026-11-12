// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { openFirstPartyExternalLinkFromClick } from '../src/first-party-external-link';

describe('unconfigured product site', () => {
  it('leaves external links alone without opening an empty product destination', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/help';
    const openExternal = vi.fn();
    anchor.addEventListener('click', event => {
      openFirstPartyExternalLinkFromClick(event, openExternal);
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(openExternal).not.toHaveBeenCalled();
  });
});





