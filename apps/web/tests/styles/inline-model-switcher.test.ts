import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const switcherCss = readFileSync(new URL('../../src/components/InlineModelSwitcher.module.css', import.meta.url), 'utf8');

function cssDeclarations(selector: string): string {
  const blocks: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(switcherCss)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  if (blocks.length === 0) throw new Error(`Missing CSS block for ${selector}`);
  return blocks.join('\n');
}

function ruleValue(block: string, property: string): string {
  const matches = [...block.matchAll(new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*([^;]+);`, 'g'))];
  const match = matches.at(-1);
  if (!match) throw new Error(`Missing CSS property ${property}`);
  return match[1]!.trim();
}

describe('InlineModelSwitcher styles', () => {
  it('clips long model labels inside the compact chip', () => {
    const chip = cssDeclarations('.chip');
    expect(ruleValue(chip, 'overflow')).toBe('hidden');

    const modelName = cssDeclarations('.modelName');
    expect(ruleValue(modelName, 'min-width')).toBe('0');
    expect(ruleValue(modelName, 'overflow')).toBe('hidden');
    expect(ruleValue(modelName, 'text-overflow')).toBe('ellipsis');
    expect(ruleValue(modelName, 'white-space')).toBe('nowrap');
  });

  it('positions the scrollable model menu against the viewport', () => {
    const menu = cssDeclarations('.menu');
    expect(ruleValue(menu, 'position')).toBe('fixed');
    expect(ruleValue(menu, 'overflow')).toBe('auto');
  });
});
