import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScreenshotPdf, buildArtifactRenderInput, decodeRenderedImageDataUrls, readRenderedImageFiles } from '../../src/artifacts/html-render.js';

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

// 1x1 JPEG.
const JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';


describe('decodeRenderedImageDataUrls', () => {
  it('decodes base64 PNG data URLs into tagged buffers', () => {
    const img = decodeRenderedImageDataUrls([PNG_DATA_URL])[0]!;
    expect(Buffer.isBuffer(img.buffer)).toBe(true);
    expect(img.jpeg).toBe(false);
    // PNG magic number.
    expect(img.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('decodes base64 JPEG data URLs and tags them as jpeg', () => {
    const img = decodeRenderedImageDataUrls([JPEG_DATA_URL])[0]!;
    expect(img.jpeg).toBe(true);
    // JPEG SOI marker.
    expect(img.buffer.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('rejects a non-image data URL', () => {
    expect(() => decodeRenderedImageDataUrls(['data:text/plain;base64,aGk='])).toThrow();
  });

  it('rejects a value that is not a data URL', () => {
    expect(() => decodeRenderedImageDataUrls(['not-a-data-url'])).toThrow();
  });
});


describe('readRenderedImageFiles', () => {
  let dir = '';
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pixo-slide-files-'));
    await writeFile(path.join(dir, 'slide-0.png'), Buffer.from(PNG_BASE64, 'base64'));
    await writeFile(
      path.join(dir, 'slide-1.jpeg'),
      Buffer.from(JPEG_DATA_URL.split(',')[1]!, 'base64'),
    );
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads files into tagged buffers (jpeg flag from extension)', async () => {
    const [png, jpeg] = await readRenderedImageFiles([
      path.join(dir, 'slide-0.png'),
      path.join(dir, 'slide-1.jpeg'),
    ]);
    expect(png!.jpeg).toBe(false);
    expect(png!.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(jpeg!.jpeg).toBe(true);
    expect(jpeg!.buffer.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('throws when a path is empty', async () => {
    await expect(readRenderedImageFiles([''])).rejects.toThrow();
  });

  it('throws when a file does not exist', async () => {
    await expect(readRenderedImageFiles([path.join(dir, 'missing.png')])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});


describe('buildArtifactRenderInput', () => {
  it('injects a deck-stage fallback runtime before desktop rendering', async () => {
    const projectsRoot = mkdtempSync(path.join(tmpdir(), 'pixo-deck-render-input-'));
    const projectId = 'project-1';
    const projectDir = path.join(projectsRoot, projectId);
    mkdirSync(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'broken-deck.html'),
      `<!doctype html>
<html>
  <body>
    <deck-stage width="1920" height="1080">
      <section class="slide">One</section>
      <section class="slide">Two</section>
    </deck-stage>
    <script>
    /**
     * Original runtime was truncated while documenting a speaker notes tag.
     * Example marker: <script type="application/json" id="speaker-notes">
    []
    </script>
  </body>
</html>`,
    );

    try {
      const request = await buildArtifactRenderInput({
        daemonUrl: 'http://127.0.0.1:60636',
        fileName: 'broken-deck.html',
        projectId,
        projectsRoot,
      });

      expect(request.input.html).toContain('data-pixo-deck-stage-fallback');
      expect(request.input.html).toContain("window.customElements.define('deck-stage'");
      expect(request.input.html).toContain('type: "pixo:slide-state"');
      expect(request.input.html).toContain('protocolVersion: 1');
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('uses supplied sourceHtml for version exports instead of reading the current file', async () => {
    const projectsRoot = mkdtempSync(path.join(tmpdir(), 'pixo-deck-render-input-'));
    const projectId = 'project-1';
    const projectDir = path.join(projectsRoot, projectId);
    mkdirSync(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'deck.html'), '<html><body>Current deck</body></html>');

    try {
      const request = await buildArtifactRenderInput({
        daemonUrl: 'http://127.0.0.1:60636',
        fileName: 'deck.html',
        projectId,
        projectsRoot,
        sourceHtml: '<html><body>Historical deck version</body></html>',
      });

      expect(request.input.html).toContain('Historical deck version');
      expect(request.input.html).not.toContain('Current deck');
      expect(request.input.baseHref).toBe('http://127.0.0.1:60636/api/projects/project-1/raw/');
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });
});


describe('buildScreenshotPdf', () => {
  it('produces a %PDF document', async () => {
    const pngs = decodeRenderedImageDataUrls([PNG_DATA_URL]);
    const out = await buildScreenshotPdf(pngs);
    expect(out.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('normalizes page size to points (not raw capture pixels, so DPR cannot bloat it)', async () => {
    const pngs = decodeRenderedImageDataUrls([PNG_DATA_URL]); // a 1x1 px image
    const out = await buildScreenshotPdf(pngs);
    const doc = await PDFDocument.load(out);
    const { width, height } = doc.getPage(0).getSize();
    // aspect 1 => normalized 960x960 pt (PowerPoint-ish), NOT the 1x1 pixel size.
    expect(Math.round(width)).toBe(960);
    expect(Math.round(height)).toBe(960);
  });

  it('throws when there are no slides', async () => {
    await expect(buildScreenshotPdf([])).rejects.toThrow(/no slides/i);
  });
});
