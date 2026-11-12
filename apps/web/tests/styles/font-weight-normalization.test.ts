import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const styleRoots = [
  fileURLToPath(new URL('../../src', import.meta.url)),
  fileURLToPath(new URL('../../../../packages/components/src', import.meta.url)),
  fileURLToPath(new URL('../../../../apps/desktop/src', import.meta.url)),
];

/**
 * The home layout still carries legacy intermediate weights and is outside
 * the foundation redesign. Remove this exemption when that owner migrates
 * it; the stale-entry check prevents exemptions from outliving their reason.
 */
const pendingNormalization = new Set([
  'apps/web/src/styles/home/entry-layout.css',
]);

function cssFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) return cssFiles(path);
    return ['.css', '.scss', '.less'].includes(extname(entry.name)) ? [path] : [];
  });
}

function withoutFontFaces(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@font-face\s*\{[^}]*\}/g, '');
}

/**
 * The approved foundation uses 300 for large stats, 400 for body copy,
 * 500/600 for controls and labels, and 700 for display headings. Font metadata
 * keeps its real registered ranges; intermediate UI weights are not new steps.
 */
function isForbiddenWeight(weight: number): boolean {
  return ![300, 400, 500, 600, 700].includes(weight);
}

function ladderViolations(file: string): string[] {
  const violations: string[] = [];
  const css = withoutFontFaces(readFileSync(file, 'utf8'));
  for (const match of css.matchAll(/font-weight\s*:\s*(\d+)\b/g)) {
    const weight = Number(match[1]);
    if (isForbiddenWeight(weight)) {
      violations.push(`${relative(repoRoot, file)}: ${weight}`);
    }
  }
  for (const match of css.matchAll(/(?:^|[;{])\s*font\s*:\s*([^;}]+)/g)) {
    const shorthand = match[1]!.trim();
    if (shorthand === 'inherit') continue;

    const explicitWeight = shorthand.match(/^(?:(?:normal|italic|oblique)\s+)?(\d{3})\b/);
    // A shorthand without an explicit weight resets it to the approved 400.
    if (!explicitWeight) continue;

    const weight = Number(explicitWeight[1]);
    if (isForbiddenWeight(weight)) {
      violations.push(`${relative(repoRoot, file)}: font shorthand ${weight}`);
    }
  }
  return violations;
}

describe('product UI font-weight normalization', () => {
  const files = styleRoots.flatMap(cssFiles);
  const isPending = (file: string) => pendingNormalization.has(relative(repoRoot, file).replace(/\\/g, '/'));

  it('keeps regular body copy and emphasized controls on separate steps', () => {
    const baseCss = withoutFontFaces(
      readFileSync(new URL('../../src/styles/base.css', import.meta.url), 'utf8'),
    );
    const primitivesCss = withoutFontFaces(
      readFileSync(new URL('../../src/styles/primitives.css', import.meta.url), 'utf8'),
    );
    const buttonModuleCss = withoutFontFaces(
      readFileSync(
        new URL('../../../../packages/components/src/button.module.css', import.meta.url),
        'utf8',
      ),
    );

    expect(baseCss).toMatch(/(?:^|\})\s*body\s*\{[^}]*font-weight:\s*400;/);
    expect(baseCss).toMatch(/h1, h2, h3, h4, h5, h6\s*\{[^}]*font-weight:\s*700;[^}]*letter-spacing:\s*-0\.025em;/);
    expect(primitivesCss).toMatch(/(?:^|\})\s*:where\(button\)\s*\{[^}]*font-weight:\s*600;/);
    expect(buttonModuleCss).toMatch(/\.button\s*\{[^}]*font-weight:\s*600;/);
  });

  it('carries no scoped stand-in for the app-wide default', () => {
    // The hero, the project composer and the portaled "+" menu each used to
    // re-declare the 600 default locally while the global one was pending.
    const standIns = files.flatMap((file) => {
      const css = readFileSync(file, 'utf8');
      return /Typography ladder stand-in/.test(css) ||
        /:where\(\.(?:home-hero|composer|plus-menu__popup)\)\s*button\s*\{[^}]*font-weight/.test(
          css.replace(/\/\*[\s\S]*?\*\//g, ''),
        )
        ? [relative(repoRoot, file)]
        : [];
    });
    expect(standIns).toEqual([]);
  });

  it('uses the consolidated weight ladder outside font metadata', () => {
    const violations = files.filter((file) => !isPending(file)).flatMap(ladderViolations);
    expect(violations).toEqual([]);
  });

  it('keeps the pending list limited to files that still need it', () => {
    const stale = files.filter((file) => isPending(file) && ladderViolations(file).length === 0);
    expect(stale.map((file) => relative(repoRoot, file))).toEqual([]);
  });

  it('loads Geist through Next font variables and only the required CJK serif weight', () => {
    const baseCss = readFileSync(new URL('../../src/styles/base.css', import.meta.url), 'utf8');
    const layout = readFileSync(new URL('../../app/layout.tsx', import.meta.url), 'utf8');

    expect(baseCss).not.toMatch(/Albert Sans|JiduMono Pro/);
    expect(layout).toMatch(/import\s*\{\s*GeistSans\s*\}\s*from\s*'geist\/font\/sans'/);
    expect(layout).toMatch(/import\s*\{\s*GeistMono\s*\}\s*from\s*'geist\/font\/mono'/);
    expect(layout).toContain('${GeistSans.variable} ${GeistMono.variable}');
    expect(layout).toMatch(/import\s*'@fontsource\/instrument-serif(?:\/400\.css)?'/);
    expect(layout).toContain("import '@fontsource/noto-serif-sc/700.css'");
    expect(layout.match(/import\s*'@fontsource\/noto-serif-sc[^']*'/g)).toHaveLength(1);
  });
});
