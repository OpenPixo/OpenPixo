import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// On Windows the desktop shell hides the native caption and Windows draws its
// minimise / maximise / close buttons over the page's top-right corner. The
// update-ready button floats in that same corner, so every rule that pins it
// to the right edge has to step left by the system buttons' width.

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

const INSET = 'var(--pixo-window-controls-inset, 0px)';

describe('window title bar corner', () => {
  it('sets the inset to the system buttons only under the custom title bar', () => {
    const titlebar = read('../../src/styles/window-titlebar.css');
    expect(block(titlebar, 'html.pixo-custom-titlebar')).toContain(
      '--pixo-window-controls-inset: var(--pixo-window-controls-width);',
    );
    expect(block(titlebar, ':root')).not.toContain('--pixo-window-controls-inset');
  });

  it.each([
    ['Home', '../../src/components/EntryShell.module.css', ':global(.workspace-shell):has(.shell) :global(.workspace-chrome-account-actions)'],
    [
      'a project',
      '../../src/components/ProjectSidebar.module.css',
      ':global(.workspace-shell):has(> :global(.workspace-shell__body) > .layout) :global(.workspace-chrome-account-actions)',
    ],
  ])('keeps the update button left of the system buttons on %s', (_view, path, selector) => {
    expect(block(read(path), selector)).toContain(`right: calc(${INSET} + 12px);`);
  });

  it('reserves room for the update button and the system buttons in the panel header', () => {
    const projectShell = read('../../src/styles/workspace/project-shell.css');
    const rule = block(projectShell, '.workspace-shell:has(.entry-top-right-cluster) .app .ws-tabs-shell');
    expect(rule).toContain(`padding-right: calc(${INSET} + 136px);`);
  });
});
