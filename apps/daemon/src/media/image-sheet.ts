import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageOutputSize, MediaSheetPiece, MediaSheetResult, ProjectMetadata } from '@openpixo/contracts';
import { resolveProjectWritePath } from '../projects.js';
import { alignFrames, cropRgba, encodePng, fitPiece, measureFrame, readRgba, sheetCells, type Rgba } from '../assets/ops/frames.js';

/** What the route resolved for a sheet before generation; the render itself carries no size. */
export interface ImageSheetPlan {
  columns: number;
  rows: number;
  frames: boolean;
  /** One per used cell, in cell order. */
  names: string[];
  /** Each piece's final size, or null to keep the cut cells as they are. */
  pieceSize: ImageOutputSize | null;
  transparent: boolean;
  pixelArt: boolean;
}

export interface CutSheet {
  sheet: MediaSheetResult;
  pieces: { cell: number; name: string; bytes: Buffer; width: number; height: number; empty: boolean; touchesEdge: boolean }[];
  warnings: string[];
}

/**
 * Cuts a rendered sheet into its pieces. The grid comes from the size the provider
 * actually returned, so an aspect it replaced only changes the cells' shape. Pieces
 * are fitted each on their own, the way one generated image is; animation frames
 * instead share one canvas, one scale and one baseline (`alignFrames`).
 */
export async function cutImageSheet(bytes: Buffer, plan: ImageSheetPlan): Promise<CutSheet> {
  const sheetImage = await readRgba(bytes);
  const cells = sheetCells(sheetImage.width, sheetImage.height, plan.columns, plan.rows).slice(0, plan.names.length);
  const cut: Rgba[] = cells.map((cell) => cropRgba(sheetImage, cell));
  const measures = cut.map(measureFrame);
  let shaped: Rgba[];
  if (plan.frames) {
    shaped = (await alignFrames(cut, { canvas: plan.pieceSize ? { width: plan.pieceSize.width, height: plan.pieceSize.height } : undefined, pixelArt: plan.pixelArt })).frames;
  } else {
    shaped = [];
    for (const cell of cut) shaped.push(await fitPiece(cell, plan.pieceSize, plan.transparent, plan.pixelArt));
  }
  const warnings: string[] = [];
  const pieces: CutSheet['pieces'] = [];
  for (let index = 0; index < shaped.length; index++) {
    const measure = measures[index]!;
    // Only alpha shows what was drawn; an opaque cell always counts as drawn.
    const empty = plan.transparent && measure.empty;
    const touchesEdge = plan.transparent && measure.touchesEdge;
    if (empty) warnings.push(`cell ${index + 1} (${plan.names[index]}) came out empty`);
    if (touchesEdge) warnings.push(`cell ${index + 1} (${plan.names[index]}) touches its cell's edge; part of it may be in the next cell`);
    pieces.push({ cell: index + 1, name: plan.names[index]!, bytes: await encodePng(shaped[index]!), width: shaped[index]!.width, height: shaped[index]!.height, empty, touchesEdge });
  }
  return {
    sheet: { columns: plan.columns, rows: plan.rows, frames: plan.frames, cellWidth: cells[0]?.width ?? 0, cellHeight: cells[0]?.height ?? 0 },
    pieces,
    warnings,
  };
}

/**
 * Cuts the sheet a generation just wrote and writes each piece next to it, under its
 * own name. The sheet file stays, so it can be cut again or shown as the one image
 * that was paid for.
 */
export async function writeImageSheetPieces(input: {
  projectsRoot: string; projectId: string; metadata?: ProjectMetadata | undefined;
  sheetName: string; plan: ImageSheetPlan;
}): Promise<{ sheet: MediaSheetResult; pieces: MediaSheetPiece[]; warnings: string[] }> {
  const source = await resolveProjectWritePath(input.projectsRoot, input.projectId, input.sheetName, input.metadata);
  const cut = await cutImageSheet(await readFile(source), input.plan);
  const folder = path.posix.dirname(input.sheetName);
  const pieces: MediaSheetPiece[] = [];
  for (const piece of cut.pieces) {
    const name = folder === '.' ? `${piece.name}.png` : `${folder}/${piece.name}.png`;
    if (name === input.sheetName) throw new Error(`piece "${piece.name}" would overwrite the sheet; give the sheet or the piece another name`);
    const target = await resolveProjectWritePath(input.projectsRoot, input.projectId, name, input.metadata);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, piece.bytes);
    await stat(target);
    pieces.push({ cell: piece.cell, name, width: piece.width, height: piece.height, ...(piece.empty ? { empty: true } : {}), ...(piece.touchesEdge ? { touchesEdge: true } : {}) });
  }
  return { sheet: cut.sheet, pieces, warnings: cut.warnings };
}

/**
 * The tool facts an agent otherwise learns too late: what the service rendered, what
 * the file became, and what it cost. Sizes and credits only; never a vendor or a link.
 */
export function imageGenerationNote(file: {
  width?: number | undefined; height?: number | undefined; renderedWidth?: number | undefined; renderedHeight?: number | undefined;
  creditsCharged?: number | undefined; pieces?: readonly MediaSheetPiece[] | undefined; sheet?: MediaSheetResult | undefined;
}): string | undefined {
  const rendered = file.renderedWidth && file.renderedHeight ? `${file.renderedWidth}x${file.renderedHeight}` : null;
  const final = file.width && file.height ? `${file.width}x${file.height}` : null;
  const cost = typeof file.creditsCharged === 'number' ? `${file.creditsCharged} credit${file.creditsCharged === 1 ? '' : 's'}` : null;
  if (file.pieces?.length && file.sheet) {
    const sizes = [...new Set(file.pieces.map((piece) => `${piece.width}x${piece.height}`))];
    const parts = [
      rendered ? `rendered ${rendered} as one sheet` : 'made as one sheet',
      `cut into ${file.pieces.length} ${file.sheet.frames ? 'frames' : 'pieces'} of ${sizes.join(' / ')}`,
      ...(cost ? [`${cost} for all ${file.pieces.length}`] : []),
    ];
    return `${parts.join(', ')}.`;
  }
  if (!rendered && !cost) return undefined;
  const parts = [
    ...(rendered ? [`rendered ${rendered}`] : []),
    ...(final && rendered && final !== rendered ? [`resized to ${final}`] : []),
    ...(cost ? [cost] : []),
  ];
  const small = file.width && file.height && Math.max(file.width, file.height) <= 256 && rendered && final !== rendered;
  return `${parts.join(', ')}${small ? '; small images in one style cost less made together as one sheet (--sheet)' : ''}.`;
}
