import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const rail = postcss.parse(readFileSync(new URL('../../src/components/EntryNavRail.module.css', import.meta.url), 'utf8'));
const row = postcss.parse(readFileSync(new URL('../../src/components/entry-nav-rail/RailRecentRow.module.css', import.meta.url), 'utf8'));

function value(root: postcss.Root, selector: string, property: string): string | undefined {
  let result: string | undefined;
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (declaration) => { result = declaration.value; });
  });
  return result;
}

describe('approved light sidebar foundation', () => {
  it('uses the theme-aware light rail, strong ink and filled active destination', () => {
    expect(value(rail, '.rail:global(.entry-nav-rail)', 'background')).toBe('var(--sidebar-bg)');
    expect(value(rail, '.rail:global(.entry-nav-rail)', 'border-right')).toBe('1px solid var(--line)');
    expect(value(rail, '.group .navButton', 'height')).toBe('36px');
    expect(value(rail, '.group .navButton', 'color')).toBe('var(--ink-2)');
    expect(value(rail, '.group .navButton:hover:not(:disabled)', 'background')).toBe('var(--sidebar-hover)');
    expect(value(rail, '.group .navButton.active', 'background')).toBe('var(--bg-muted)');
    expect(value(rail, '.active .navIcon', 'color')).toBe('var(--violet)');
    expect(value(rail, '.active::after', 'width')).toBe('6px');
    expect(value(rail, '.active::after', 'background')).toBe('var(--lime)');
  });

  it('keeps the recent label mono and compact rows aligned with 20px covers', () => {
    expect(value(rail, '.recentTitle', 'font')).toBe('500 11px var(--mono)');
    expect(value(rail, '.recentTitle', 'text-transform')).toBe('uppercase');
    expect(value(rail, '.recentTitle', 'letter-spacing')).toBe('.12em');
    expect(value(row, '.item.item', 'height')).toBe('32px');
    expect(value(row, '.item.item', 'color')).toBe('var(--ink-2)');
    expect(value(row, '.thumbnail.thumbnail', 'width')).toBe('20px');
    expect(value(row, '.thumbnail.thumbnail', 'height')).toBe('20px');
    expect(value(row, '.time', 'font')).toBe('400 11px/1 var(--mono)');
    expect(value(row, '.time', 'color')).toBe('var(--text-muted)');
  });

  it('preserves the row menu affordance and asymmetric motion with reduced-motion support', () => {
    expect(value(row, '.more.more', 'opacity')).toBe('0');
    expect(value(row, '.row:focus-within .more', 'opacity')).toBe('1');
    expect(value(rail, '.group .navButton', 'transition')).toContain('140ms var(--ease-out)');
    expect(value(rail, '.group .navButton:hover:not(:disabled)', 'transition-duration')).toBe('200ms');
    for (const stylesheet of [rail, row]) {
      let reducedMotion = false;
      stylesheet.walkAtRules('media', (rule) => {
        if (rule.params === '(prefers-reduced-motion: reduce)') {
          rule.walkDecls('transition', (declaration) => { if (declaration.value === 'none') reducedMotion = true; });
        }
      });
      expect(reducedMotion).toBe(true);
    }
  });
});
