import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Button selected paint contract', () => {
  it('keeps a visible selection ring without native borders and preserves disabled/material variants', () => {
    // jsdom cannot paint CSS Module pseudo-states. Verify the source contract
    // in the Node test layer alongside Button's DOM/ARIA behavior tests.
    const css = readFileSync(new URL('../src/button.module.css', import.meta.url), 'utf8');
    const selectedRule = css.match(/\.button:where\(\[aria-pressed='true'\][^{]*\{([^}]*)\}/)?.[0];
    expect(selectedRule).toContain(':global(.is-selected)');
    expect(selectedRule).toContain(':not(.primary, .danger, :disabled)');
    expect(selectedRule).toContain('box-shadow: inset 0 0 0 1px var(--violet');
    expect(selectedRule).toContain('var(--button-shadow)');
  });

  it('stays flat: no gradient, no drop shadow, no movement', () => {
    const css = readFileSync(new URL('../src/button.module.css', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/gradient/);
    expect(css).not.toMatch(/transform|translate|scale\(/);
    expect(css).not.toMatch(/var\(--sh-|var\(--shadow-/);
    // Offset shadows are the lift this forbids; zero-offset rings are borders.
    for (const [, shadow] of css.matchAll(/(?:--button-shadow|box-shadow):([^;]+);/g)) {
      for (const [, , y, blur] of shadow!.matchAll(/(?:^|,)\s*(?:inset\s+)?(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)/g)) {
        expect([parseFloat(y!), parseFloat(blur!)]).toEqual([0, 0]);
      }
    }
  });

  it('keeps a visible keyboard focus ring', () => {
    const css = readFileSync(new URL('../src/button.module.css', import.meta.url), 'utf8');
    expect(css.match(/\.button:focus-visible \{([^}]*)\}/)?.[1]).toContain('0 0 0 4px var(--violet-soft');
  });
});
