// Measurement spec for the project page's chat PANE MATERIAL and SHELL
// (OPEND-3090 / OPEND-2553 S6, ported from upstream #8113 @877980fb17): the
// transparent chat card over the app wash, the 4px resize gutter with no
// painted strip in any state, the Home-style design-system trigger in the
// composer, and the agent popover surface. Values are
// pinned to the Demo's, so a drift in either direction fails here before it
// reaches a screenshot.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const shellCss = read('../../src/styles/shell.css');
const routinesCss = read('../../src/styles/viewer/routines.css');
const homeHeroCss = read('../../src/styles/home/home-hero.css');
const projectViewSource = read('../../src/components/ProjectView.tsx');
const splitLayoutSource = read('../../src/components/project-split-layout.ts');

function declarations(css: string, selector: string): string {
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  if (blocks.length === 0) throw new Error(`Missing CSS block for ${selector}`);
  return blocks.join('\n');
}

/** The declarations of `selector` inside the at-rule blocks whose prelude
 *  contains `atRule` (a file may carry several such blocks). */
function declarationsInside(css: string, atRule: string, selector: string): string {
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  let start = cssWithoutComments.indexOf(atRule);
  if (start === -1) throw new Error(`Missing at-rule ${atRule}`);
  while (start !== -1) {
    const open = cssWithoutComments.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (let index = open; index < cssWithoutComments.length; index += 1) {
      const char = cssWithoutComments[index];
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    bodies.push(cssWithoutComments.slice(open + 1, end));
    start = cssWithoutComments.indexOf(atRule, end);
  }
  const matches = bodies.flatMap((body) => {
    try {
      return [declarations(body, selector)];
    } catch {
      return [];
    }
  });
  if (matches.length === 0) throw new Error(`Missing CSS block for ${selector} inside ${atRule}`);
  return matches.join('\n');
}

describe('project chat pane material (styles/viewer/routines.css)', () => {
  it('keeps the 8px bottom/left inset slot painted with the page veil', () => {
    const slot = declarations(routinesCss, '.app .split-chat-slot');
    expect(slot).toMatch(/padding:\s*0 0 8px 8px;/);
    expect(slot).toMatch(/background:\s*var\(--veil-page, transparent\);/);
  });

  it('lets the app wash show through the card: transparent, no backdrop blur, square-cornered and clipped', () => {
    const pane = declarations(routinesCss, '.app .split-chat-slot > .pane');
    expect(pane).toMatch(/background:\s*transparent;/);
    expect(pane).toMatch(/-webkit-backdrop-filter:\s*none;/);
    expect(pane).toMatch(/(^|[^-])backdrop-filter:\s*none;/);
    expect(pane).not.toMatch(/color-mix\(in srgb, #fff 85%, transparent\)/);
    expect(pane).not.toMatch(/var\(--material-regular-backdrop\)/);
    expect(pane).toMatch(/border:\s*none;/);
    // Square on purpose: a radius on this clipping box turns it into a rounded
    // clip around `.chat-log`, which Chromium's compositor cannot hit-test on
    // its own, so every wheel notch waits on the main thread. The card paints
    // nothing, so the corner is invisible either way. Guarded from the other
    // side by tests/components/chat/chat-log-ancestor-rounded-clip.test.ts.
    expect(pane).toMatch(/border-radius:\s*0;/);
    expect(pane).not.toMatch(/border-radius:\s*var\(--radius-lg\);/);
    expect(pane).toMatch(/box-shadow:\s*none;/);
    expect(pane).toMatch(/overflow:\s*hidden;/);
  });

  it('still flattens the card to a solid surface when transparency is reduced or unsupported', () => {
    expect(
      declarationsInside(routinesCss, '@media (prefers-reduced-transparency: reduce)', '.app .split-chat-slot > .pane'),
    ).toMatch(/background:\s*var\(--bg-elevated\);/);
    expect(
      declarationsInside(
        routinesCss,
        '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
        '.app .split-chat-slot > .pane',
      ),
    ).toMatch(/background:\s*var\(--bg-elevated\);/);
  });
});

describe('project chat resize gutter (styles/shell.css + routines.css + ProjectView.tsx)', () => {
  it('registers and seeds the handle track at 4px', () => {
    expect(declarations(shellCss, '@property --project-chat-handle-width')).toMatch(
      /initial-value:\s*4px;/,
    );
    expect(declarations(shellCss, '.split')).toMatch(/--project-chat-handle-width:\s*4px;/);
  });

  it('sizes the handle from the track variable so focus mode can animate it to 0', () => {
    const shellHandle = declarations(shellCss, '.split-resize-handle');
    expect(shellHandle).toMatch(/width:\s*var\(--project-chat-handle-width, 4px\);/);
    expect(shellHandle).toMatch(/min-width:\s*0;/);
    expect(shellHandle).toMatch(/background:\s*transparent;/);

    const appHandle = declarations(routinesCss, '.app .split-resize-handle');
    expect(appHandle).toMatch(/width:\s*var\(--project-chat-handle-width, 4px\);/);
    expect(appHandle).toMatch(/min-width:\s*0;/);
    expect(appHandle).toMatch(/background:\s*transparent;/);
    expect(appHandle).not.toMatch(/width:\s*8px/);
  });

  it('paints no strip on the gutter at rest, on hover, or while dragging', () => {
    expect(declarations(routinesCss, '.app .split-resize-handle::after')).toMatch(/display:\s*none;/);
    const hover = declarations(routinesCss, '.app .split-resize-handle:hover');
    expect(hover).toMatch(/background:\s*transparent;/);
    expect(declarations(routinesCss, '.app .split.is-resizing-chat .split-resize-handle')).toMatch(
      /background:\s*transparent;/,
    );
  });

  it('keeps the layout math on the same 4px', () => {
    // The split's geometry moved to `project-split-layout.ts` (shared with
    // the creation frame, OPEND-3207); ProjectView consumes it from there.
    expect(splitLayoutSource).toMatch(/export const SPLIT_RESIZE_HANDLE_WIDTH = 4;/);
    expect(projectViewSource).toMatch(/resolveProjectSplitLayout[\s\S]*?from '\.\/project-split-layout';/);
  });
});

describe('composer agent popover (styles/shell.css)', () => {
  it('is a flat elevated surface: solid --bg, no glass backdrop', () => {
    const popover = declarations(shellCss, '.avatar-popover');
    expect(popover).toMatch(/background:\s*var\(--bg\);/);
    expect(popover).toMatch(/-webkit-backdrop-filter:\s*none;/);
    expect(popover).toMatch(/(^|[^-])backdrop-filter:\s*none;/);
    expect(popover).not.toMatch(/var\(--glass-regular\)/);
    expect(popover).not.toMatch(/var\(--glass-backdrop\)/);
  });
});
