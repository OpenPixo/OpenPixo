import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { injectDeckStageFallback } from '@openpixo/contracts/runtime/deck-stage-fallback';
import type { DesktopRenderSlidesInput } from '@openpixo/sidecar-proto';
import { readProjectFile } from '../projects.js';

export interface BuildArtifactRenderInputOptions {
  baseHref?: string;
  daemonUrl: string;
  // Explicit page-vs-deck signal (the web knows whether the artifact is a deck).
  deck?: boolean;
  fileName: string;
  index?: number;
  // Directory the desktop renderer writes the rendered images into (returned as
  // file paths) instead of base64 data URLs — keeps large images off the IPC.
  // Project metadata. Imported-folder projects keep their workspace under
  // `metadata.baseDir`; without it readProjectFile falls back to
  // `<data>/projects/:id` and 404s for those projects (see resolveProjectDir).
  metadata?: Record<string, unknown> | null;
  outputDir?: string;
  pageImageFormat?: 'png' | 'jpeg';
  projectId: string;
  projectsRoot: string;
  sourceHtml?: string;
  stitch?: boolean;
  width?: number;
  height?: number;
  // Page mode only: split a long non-deck page into one image per viewport
  // (multi-page PDF). Ignored when the artifact renders as a deck.
  paginate?: boolean;
  title?: string;
}

export interface ArtifactRenderRequest {
  defaultFilename: string;
  input: DesktopRenderSlidesInput;
  title: string;
}

/**
 * Reads a deck HTML file and prepares the {@link DesktopRenderSlidesInput} the
 * desktop renderer needs. Mirrors {@link buildDesktopPdfExportInput} in
 * pdf-export.ts: the default `<base href>` resolves relative assets through
 * `/raw/`; authorized callers can supply a narrower renderer-only base.
 */
export async function buildArtifactRenderInput(
  options: BuildArtifactRenderInputOptions,
): Promise<ArtifactRenderRequest> {
  const html = options.sourceHtml ?? (await readProjectFile(
    options.projectsRoot,
    options.projectId,
    options.fileName,
    options.metadata ?? undefined,
  )).buffer.toString('utf8');
  const title = displayTitle(options.title, options.fileName);
  return {
    defaultFilename: safeDisplayFilename(title, 'deck'),
    title,
    input: {
      baseHref: options.baseHref ?? rawBaseHref(options.daemonUrl, options.projectId, options.fileName),
      html: injectDeckStageFallback(html),
      ...(options.deck == null ? {} : { deck: options.deck }),
      ...(options.index == null ? {} : { index: options.index }),
      ...(options.outputDir == null ? {} : { outputDir: options.outputDir }),
      ...(options.pageImageFormat == null ? {} : { pageImageFormat: options.pageImageFormat }),
      ...(options.stitch == null ? {} : { stitch: options.stitch }),
      ...(options.paginate == null ? {} : { paginate: options.paginate }),
      ...(options.width == null ? {} : { width: options.width }),
      ...(options.height == null ? {} : { height: options.height }),
    },
  };
}

export interface RenderedImage {
  buffer: Buffer;
  jpeg: boolean;
}

/**
 * Decodes the `data:image/(png|jpeg);base64,...` URLs the desktop renderer
 * returns into raw image buffers tagged with their format. Rejects anything that
 * is not a base64 PNG/JPEG data URL so a malformed renderer response surfaces as
 * an export failure rather than a corrupt file.
 */
/**
 * Reads the image files the desktop renderer wrote (the `outputDir` handoff)
 * into raw buffers tagged with their format (by extension). The companion to
 * {@link decodeRenderedImageDataUrls} for the file-path path, which avoids shuttling
 * base64 image bytes through the JSON IPC channel for large images.
 */
export async function readRenderedImageFiles(paths: string[]): Promise<RenderedImage[]> {
  return Promise.all(
    paths.map(async (filePath, index) => {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error(`slide ${index + 1} has no file path`);
      }
      const buffer = await readFile(filePath);
      return { buffer, jpeg: /\.jpe?g$/i.test(filePath) };
    }),
  );
}

export function decodeRenderedImageDataUrls(urls: string[]): RenderedImage[] {
  return urls.map((url, index) => {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(url ?? '');
    if (!match) {
      throw new Error(`slide ${index + 1} is not a base64 PNG/JPEG data URL`);
    }
    return { buffer: Buffer.from(match[2] ?? '', 'base64'), jpeg: match[1] === 'jpeg' };
  });
}


/**
 * Assembles per-slide images into a screenshot-based .pdf — one page per slide,
 * each page sized to its image. Pixel-perfect, raster (not selectable text).
 * Full pages render as JPEG (small); deck slides as PNG (crisp).
 */
// pdf-lib page sizes are in PDF points (1/72"), NOT pixels. Sizing a page by the
// captured image's pixel dimensions makes the nominal page size scale with the
// capture's device pixel ratio (a 2x retina capture would yield a page twice as
// large as a 1x one). Instead, normalize each page so its longest side is a
// fixed physical size and its aspect ratio matches the image; the image still
// embeds at full pixel resolution (crisp), only the page's points are sane.
const PDF_PAGE_LONGEST_PT = 960;

export async function buildScreenshotPdf(images: RenderedImage[]): Promise<Buffer> {
  if (images.length === 0) throw new Error('no slides to export');
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const image = img.jpeg ? await pdf.embedJpg(img.buffer) : await pdf.embedPng(img.buffer);
    const aspect = image.height > 0 ? image.width / image.height : 1;
    const [width, height] =
      aspect >= 1
        ? [PDF_PAGE_LONGEST_PT, PDF_PAGE_LONGEST_PT / aspect]
        : [PDF_PAGE_LONGEST_PT * aspect, PDF_PAGE_LONGEST_PT];
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function displayTitle(title: string | undefined, fileName: string): string {
  if (typeof title === 'string' && title.trim().length > 0) return title.trim();
  const base = path.posix.basename(fileName);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || 'deck';
}

function rawBaseHref(daemonUrl: string, projectId: string, fileName: string): string {
  const dir = path.posix.dirname(fileName.replace(/^\/+/, ''));
  const safeProjectId = encodeURIComponent(projectId);
  const rawBase = `${daemonUrl.replace(/\/+$/, '')}/api/projects/${safeProjectId}/raw/`;
  if (!dir || dir === '.') return rawBase;
  return `${rawBase}${encodePathSegments(dir)}/`;
}

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function safeDisplayFilename(name: string, fallback: string): string {
  const stem = (name || fallback)
    .replace(/[\/\\\0-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return stem || fallback;
}
