import { describe, expect, it } from 'vitest';
import { parse } from 'postcss';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

const indexStyles = parse(readExpandedIndexCss());

function cssBlock(selector: string): string {
  let declarations: string | undefined;
  indexStyles.walkRules((rule) => {
    if (declarations === undefined && rule.selector.trim() === selector) {
      declarations = rule.nodes.map((node) => node.toString()).join(';\n') + ';';
    }
  });
  if (declarations === undefined) throw new Error(`Missing CSS block for ${selector}`);
  return declarations;
}

describe('default app background colors', () => {
  it('uses a pure white canvas by default', () => {
    const root = cssBlock(':root');

    expect(root).toMatch(/--bg:\s*#ffffff;/i);
    expect(root).toMatch(/--bg-app:\s*#ffffff;/i);
    expect(root).toMatch(/--sidebar-bg:\s*#f3f1f9;/i);
  });

  it('uses matching dark violet surfaces', () => {
    const dark = cssBlock('[data-theme="dark"]');

    expect(dark).toMatch(/--bg:\s*#14111f;/i);
    expect(dark).toMatch(/--bg-app:\s*#14111f;/i);
    expect(dark).toMatch(/--bg-panel:\s*#1d192b;/i);
  });

  it('uses Geist with the approved CJK fallbacks and serif accent', () => {
    const root = cssBlock(':root');
    const sans = /--sans:\s*([^;]+);/.exec(root)?.[1];

    expect(sans).toBeDefined();
    expect(sans).toContain('var(--font-geist-sans, "Geist")');
    expect(sans).toMatch(/"PingFang SC", "Microsoft YaHei"/);
    expect(root).toMatch(/--mono:\s*var\(--font-geist-mono, "Geist Mono"\)/);
    expect(root).toMatch(/--serif:\s*"Instrument Serif", "Noto Serif SC", "PingFang SC", "Microsoft YaHei"/);
    expect(root).not.toMatch(/Albert Sans|JiduMono Pro/);
    indexStyles.walkDecls('--sans', (declaration) => {
      expect(declaration.value).not.toContain('Albert Sans');
    });
  });

  it('keeps selection, focus and scroll chrome on theme tokens', () => {
    expect(cssBlock('body')).toMatch(/background:\s*var\(--bg-app\)/);
    expect(cssBlock('::selection')).toMatch(/background:\s*var\(--violet-soft\)/);
    expect(cssBlock(':where(button:focus-visible)')).toMatch(/box-shadow:\s*var\(--focus-shadow\)/);
    expect(cssBlock('::-webkit-scrollbar-thumb')).toMatch(/background:\s*var\(--border-hover\)/);
  });

  it('preserves custom Blink scrollbar gutters in scrollable chat records', () => {
    let standardDefaults = 0;
    indexStyles.walkRules('*', (rule) => {
      rule.walkDecls(/^scrollbar-(width|color)$/, () => {
        standardDefaults += 1;
        expect(rule.parent?.type).toBe('atrule');
        if (rule.parent?.type === 'atrule') {
          expect(rule.parent.name).toBe('supports');
          expect(rule.parent.params).toBe('not selector(::-webkit-scrollbar)');
        }
      });
    });
    expect(standardDefaults).toBe(2);
  });
});
