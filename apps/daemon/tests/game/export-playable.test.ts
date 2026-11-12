/**
 * A built web game as one HTML file that plays from `file://`.
 *
 * 2026-11-10 beginner audit: the game could not leave OpenPixo without a public link.
 * Its dist/index.html opened from disk was blank (an absolute `/assets/` module script,
 * which Chromium also refuses under file://), and the export menu offered PDF and image
 * exports from the design tool. The file this builds was played from file:// in GPU
 * Chromium during the fix (Phaser 3.90, WebGL and Web Audio).
 */
import { describe, expect, it } from 'vitest';
import { buildPlayableHtml, GameExportError } from '../../src/game/export-playable.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const index = `<!doctype html><html><head><meta charset="UTF-8" /><title>火星农场</title>
<link rel="icon" href="/favicon.png" />
<link rel="modulepreload" crossorigin href="/assets/vendor.js">
<link rel="stylesheet" crossorigin href="/assets/index.css">
<script type="module" crossorigin src="/assets/index.js"></script>
</head><body><div id="game"></div><img src="./art/logo.png" alt=""></body></html>`;

function files(code: string): Map<string, Buffer> {
  return new Map([
    ['assets/index.js', Buffer.from(code)],
    ['assets/index.css', Buffer.from('body{background:url(../art/bg.png)}')],
    ['art/logo.png', png], ['art/bg.png', png], ['art/potato-sheet.png', png], ['favicon.png', png],
  ]);
}

describe('a playable single-file export', () => {
  const { html, embedded } = buildPlayableHtml(index, files('this.load.image("potato","art/potato-sheet.png");const s="</script>";'));

  it('inlines the game script, keeping it a module, and loads nothing from disk', () => {
    expect(html).toContain('<script type="module">this.load.image("potato","art/potato-sheet.png")');
    expect(html).not.toMatch(/<script[^>]*\bsrc=/);
    expect(html).not.toContain('modulepreload');
    expect(html).not.toContain('crossorigin');
  });

  it('escapes a closing script tag inside the game code', () => {
    expect(html).toContain('const s="<\\/script>"');
  });

  it('embeds stylesheets and static references as data', () => {
    expect(html).toContain('<style>body{background:url(data:image/png;base64,');
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="">/);
    expect(html).toMatch(/<link rel="icon" href="data:image\/png;base64,/);
  });

  it('serves the files the game loads at run time from the page itself', () => {
    // Six built files: the script and the stylesheet are inline, the four images embedded.
    expect(embedded).toBe(4);
    expect(html).toContain('"art/potato-sheet.png":["image/png"');
    // The loader runs before the game script.
    expect(html.indexOf('XMLHttpRequest.prototype.open')).toBeLessThan(html.indexOf('this.load.image'));
  });

  it('refuses a game split into several script files, which file:// cannot load', () => {
    const split = files('import{a}from"./vendor.js";a();');
    split.set('assets/vendor.js', Buffer.from('export const a=()=>{};'));
    expect(() => buildPlayableHtml(index, split)).toThrow(GameExportError);
    try { buildPlayableHtml(index, split); } catch (error) { expect((error as GameExportError).code).toBe('GAME_EXPORT_SPLIT_SCRIPTS'); }
  });

  it('moves a deferred classic script to the end of the page, where it still finds the body', () => {
    const page = '<html><head><script defer src="game.js"></script></head><body><canvas></canvas></body></html>';
    const out = buildPlayableHtml(page, new Map([['game.js', Buffer.from('document.body.dataset.ok="1"')]])).html;
    expect(out.indexOf('document.body.dataset.ok')).toBeGreaterThan(out.indexOf('<canvas>'));
  });

  it('finds the real </body> and <head>, not the ones inside the game code', () => {
    const page = '<html><head><script type="module" src="main.js"></script></head><body><script defer src="late.js"></script></body></html>';
    const out = buildPlayableHtml(page, new Map([
      ['main.js', Buffer.from('const tpl = "<head></head><body></body>";')],
      ['late.js', Buffer.from('window.late = 1')],
    ])).html;
    expect(out).toContain('const tpl = "<head></head><body></body>";');
    expect(out.lastIndexOf('window.late = 1')).toBeGreaterThan(out.indexOf('const tpl'));
    expect(out.indexOf('XMLHttpRequest.prototype.open')).toBeLessThan(out.indexOf('const tpl'));
  });
});
