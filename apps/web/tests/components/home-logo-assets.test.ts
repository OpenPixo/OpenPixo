import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const homeHeroSource = read('../../src/components/HomeHero.tsx');
const entryNavRailSource = read('../../src/components/EntryNavRail.tsx');
const logoComponentSource = read('../../src/components/OpenPixoLogo.tsx');
const brandIconSvg = read('../../public/brand-icon.svg');
const vectorMarks = ['logo.svg', 'logo-mark.svg', 'app-icon.svg', 'openpixo-icon.svg', 'brand-icon.svg', 'logo-03.svg', 'logo-scan.svg', 'logo-tiles.svg']
  .map((name) => [name, read(`../../public/${name}`)] as const);
const wordmarks = vectorMarks.filter(([name]) => /^logo-(03|scan|tiles)\.svg$/.test(name));

// The site's mark: the square-cut P and its detached lime square.
const SITE_MARK_PATH = 'M6 6h17v5h5v12h-5v5H13v8H6V6Zm7 7v8h8v-8h-8Z';
// The upstream project's cursor-in-a-ring glyph, and the "Design" of its wordmark.
const UPSTREAM_MARKERS = ['M41 0.726562', 'M128 41.5103', 'M1034.01 30.0999', '#202020'];

describe('Home logo assets', () => {
  it('ships the site’s mark in every vector asset, and nothing of the upstream logo', () => {
    expect(logoComponentSource).toContain(SITE_MARK_PATH);
    for (const [name, svg] of vectorMarks) {
      expect(svg, name).toContain(SITE_MARK_PATH);
      for (const marker of UPSTREAM_MARKERS) expect(svg, `${name} ${marker}`).not.toContain(marker);
    }
  });

  it('keeps one wordmark across its three file names', () => {
    expect(new Set(wordmarks.map(([, svg]) => svg)).size).toBe(1);
  });

  it('keeps brand-icon.svg maskable (theme color comes from CSS)', () => {
    expect(brandIconSvg).toContain('currentColor');
  });

  it('ships current brand assets without retired home logo renderers', () => {
    // The hero header is a plain headline now (per product): the animated
    // pixel-scan wordmark came off it, so the hero mounts neither that
    // component nor any of the retired logotype images.
    expect(homeHeroSource).not.toContain('<PixelScanLogo');
    expect(homeHeroSource).not.toContain('src="/logo-03.svg"');
    expect(homeHeroSource).not.toContain('src="/app-icon.svg"');

    // #6156 cut the rail's signed-out brand header entirely, so the rail never
    // falls back to the raster app icon.
    expect(entryNavRailSource).not.toContain('src="/app-icon.svg"');
  });
});
