import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const designFilesCss = readFileSync(
  new URL('../../src/styles/workspace/files.css', import.meta.url),
  'utf8',
);
const routinesCss = readFileSync(
  new URL('../../src/styles/viewer/routines.css', import.meta.url),
  'utf8',
);

function cssDeclarations(css: string, selector: string): string {
  const blocks: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
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

describe('Files preview list styles', () => {
  // The two preview-split cases that used to live here are gone with the
  // pane itself (#5517: a click opens the file in a workspace tab). They
  // asserted the `.df-panel:not(.no-preview)` grid and the name-cell rules
  // that only existed to keep rows readable beside that pane; keeping them
  // would pin CSS whose subject no longer renders. The invariants below are
  // independent of the preview and stay.
  it('collapses toolbar actions to icons-only on a narrow list column', () => {
    const main = cssDeclarations(designFilesCss, '.df-main');
    // The list column is its own query container so the toolbar reacts to
    // the column width (chat/preview split), not the viewport.
    expect(ruleValue(main, 'container-type')).toBe('inline-size');
    // Below the labelled-actions wrap threshold the button text is hidden
    // (icons remain) so the toolbar stays on one row instead of wrapping
    // the actions below the breadcrumb.
    expect(designFilesCss).toMatch(
      /@container[^{]*max-width:\s*470px[^{]*\{[\s\S]*?\.df-actions button\s*>\s*span\s*\{\s*display:\s*none/,
    );
  });

  it('scrolls the batch bar with the content and colors the glyph row checkboxes', () => {
    const batchBar = cssDeclarations(designFilesCss, '.df-batch-bar');
    const row = cssDeclarations(designFilesCss, '.df-row');
    const selectedRow = cssDeclarations(designFilesCss, '.df-row.selected');
    const rowCheck = cssDeclarations(designFilesCss, '.df-row-check');
    const checkedRowCheck = cssDeclarations(
      designFilesCss,
      '.df-row-check[aria-checked="true"]',
    );
    const rowSize = cssDeclarations(designFilesCss, '.df-row-size');

    // The batch bar scrolls with the content (320a36ac1); the category tab
    // bar it used to share that rule with is gone with the 资源库 merge.
    expect(batchBar).not.toMatch(/position\s*:/);
    expect(ruleValue(row, 'grid-template-columns')).toContain('minmax(56px, auto)');
    expect(ruleValue(selectedRow, 'border-radius')).toBe('8px');
    expect(ruleValue(rowCheck, 'border-radius')).toBe('7px');
    // The Remix checkbox glyph carries the box shape; the check span colors it.
    expect(ruleValue(checkedRowCheck, 'color')).toBe('var(--accent-strong)');
    expect(ruleValue(rowSize, 'text-align')).toBe('right');
  });

  it('opens the working directory menu below the top chrome instead of behind it', () => {
    const menu = cssDeclarations(routinesCss, '.app .working-dir-pill-menu');

    expect(ruleValue(menu, 'top')).toBe('calc(100% + 6px)');
    expect(ruleValue(menu, 'right')).toBe('0');
    expect(ruleValue(menu, 'z-index')).toBe('220');
  });

  
});
