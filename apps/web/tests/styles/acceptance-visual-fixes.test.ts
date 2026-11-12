import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Independent visual/interaction acceptance fixes. Each `it` is scoped to
// one Feishu acceptance-sheet row and only asserts the rule(s) that row's fix
// touched, so a regression in one area fails only its own test.

const recentProjectsCss = readFileSync(
  new URL('../../src/styles/home/recent-projects.css', import.meta.url),
  'utf8',
);
const drawerCss = readFileSync(new URL('../../src/styles/workspace/drawer.css', import.meta.url), 'utf8');
const mentionHomeCss = readFileSync(
  new URL('../../src/styles/workspace/mention-home.css', import.meta.url),
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

describe('recvpYEHCwtxXX — selected recent-project checkbox degrades to outline on hover', () => {
  it('re-asserts the filled accent state at matching specificity on hover', () => {
    // The base selected style.
    const selected = cssDeclarations(recentProjectsCss, '.recent-projects__select-check[aria-pressed="true"]');
    expect(ruleValue(selected, 'background')).toBe('var(--accent)');
    expect(ruleValue(selected, 'border-color')).toBe('var(--accent)');

    // The hover override must restate the same filled look — otherwise the
    // global `button:hover:not(:disabled)` primitive (higher specificity:
    // adds the `button` type selector) wins and flattens it back to
    // bg-subtle/border-strong (a hollow-looking circle).
    const selectedHover = cssDeclarations(
      recentProjectsCss,
      '.recent-projects__select-check[aria-pressed="true"]:hover:not(:disabled)',
    );
    expect(ruleValue(selectedHover, 'background')).toBe('var(--accent)');
    expect(ruleValue(selectedHover, 'border-color')).toBe('var(--accent)');
    expect(ruleValue(selectedHover, 'color')).toBe('var(--accent-contrast, #fff)');
  });
});

describe('recvpZpbZcu4iy — design-file tab bar has no border separating it from the preview', () => {
  it('gives .ws-tabs-shell a bottom hairline', () => {
    const shell = cssDeclarations(drawerCss, '.ws-tabs-shell');
    expect(ruleValue(shell, 'border-bottom')).toBe('1px solid var(--border)');
  });
});

describe('recvq4iEq1Esno — settings full page swallowed the autosave "Saved" pill', () => {
  it('hides only the close/fullscreen chrome buttons on the full-page presentation, not the autosave pill', () => {
    // The status now lives outside `.settings-chrome`, so page-mode button
    // suppression cannot accidentally take the save confirmation with it.
    const feedbackLayer = cssDeclarations(mentionHomeCss, '.settings-autosave-layer');
    expect(feedbackLayer).not.toMatch(/display\s*:\s*none/);

    // The fix must still hide the buttons that don't belong on a full page
    // (there's a "返回首页" link instead of a floating close/fullscreen pair).
    const hiddenButtons = cssDeclarations(mentionHomeCss, '.settings-page-shell .settings-chrome-btn');
    expect(ruleValue(hiddenButtons, 'display')).toBe('none');
  });
});

describe('OPEND-2148 — Settings autosave feedback obscures Local CLI controls', () => {
  it('keeps autosave feedback in a viewport-level layer below model popovers', () => {
    const feedbackLayer = cssDeclarations(mentionHomeCss, '.settings-autosave-layer');

    expect(ruleValue(feedbackLayer, 'position')).toBe('fixed');
    expect(ruleValue(feedbackLayer, 'left')).toBe('50%');
    // The layer moved from the bottom of the viewport onto the app's top
    // chrome row. What this ticket guarantees is that passive status keeps
    // clear of the Local CLI controls in the panel's upper band and stays
    // under the model picker — not the specific edge it hangs from.
    expect(ruleValue(feedbackLayer, 'top')).toBe('0');
    expect(ruleValue(feedbackLayer, 'transform')).toBe('translateX(-50%)');
    const feedbackZIndex = Number(ruleValue(feedbackLayer, 'z-index'));
    expect(feedbackZIndex).toBeGreaterThan(1700);
    expect(feedbackZIndex).toBeLessThan(10500);

    // The feedback copy used to disappear below 720px because it shared the
    // cramped top-right close/fullscreen strip. A detached feedback layer has
    // room for the message and must keep it readable on narrow viewports.
    expect(mentionHomeCss).not.toContain('.settings-autosave.is-saved span');
  });
});
