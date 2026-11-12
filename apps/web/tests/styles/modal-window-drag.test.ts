import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODAL_WINDOW_DRAG_BACKDROP_SELECTOR } from '../../src/hooks/useModalWindowDragGuard';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

describe('modal window drag strip styles', () => {
  it('binds the height and draggable pseudo-element to every guarded backdrop', () => {
    const css = readFileSync(new URL('../../src/styles/modal-window-drag.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/:where\(([^)]+)\)(::before)?\s*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(2);
    const backdrop = rules.find((rule) => rule[2] === undefined);
    const strip = rules.find((rule) => rule[2] === '::before');
    expect(backdrop?.[3]).toContain('--modal-window-drag-strip-height: 56px;');
    expect(strip?.[3]).toContain('-webkit-app-region: drag !important;');
    for (const selector of MODAL_WINDOW_DRAG_BACKDROP_SELECTOR.split(',')) {
      expect((backdrop?.[1] ?? '').split(',').map((value) => value.trim())).toContain(selector);
      expect((strip?.[1] ?? '').split(',').map((value) => value.trim())).toContain(selector);
    }
  });

  it('covers shared full-screen modal backdrops', () => {
    const css = readExpandedIndexCss();

    for (const selector of MODAL_WINDOW_DRAG_BACKDROP_SELECTOR.split(',')) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('--modal-window-drag-strip-height: 56px;');
    expect(css).toContain('-webkit-app-region: drag !important;');
  });
});
