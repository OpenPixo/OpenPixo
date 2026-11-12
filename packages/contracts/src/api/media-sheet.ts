// Several small images, or the frames of one animation, made in one render and cut by
// the daemon (`pixo media generate --sheet <C>x<R>`). An image model renders at about
// 1024 px or more and charges for that render whatever size the file ends at, so a set
// of 64 px icons made one call each costs one full image per icon (owner report,
// 2026-11-11). One sheet costs one image and the pieces match.

/** At most this many cells in one sheet; more pieces take more sheets. */
export const MEDIA_SHEET_MAX_CELLS = 16;
/** At most this many columns or rows. */
export const MEDIA_SHEET_MAX_SIDE = 8;

/** `MediaGenerationRequest.sheet`. `width`/`height` on the request are each piece's size. */
export interface MediaImageSheetRequest {
  columns: number;
  rows: number;
  /**
   * One file name per cell, read left to right, then top to bottom: no folder, no
   * extension (each piece is a PNG next to the sheet). Fewer names than cells leaves
   * the rest spare. Absent: `<sheet name>-1`, `-2`, … for every cell.
   */
  names?: string[];
  /**
   * The cells are frames of one animation: every frame gets the same scale and the
   * subject's feet land on one line at the bottom centre, instead of each piece being
   * fitted on its own. Implies a transparent background.
   */
  frames?: boolean;
}

/** One piece the daemon cut from a sheet, on the task file (`file.pieces`). */
export interface MediaSheetPiece {
  /** 1-based cell number, read left to right, then top to bottom. */
  cell: number;
  /** Project-relative path of the written piece. */
  name: string;
  width: number;
  height: number;
  /** Nothing visible was drawn in this cell. */
  empty?: boolean;
  /** The drawing touches the cell's edge, so part of it may have spilled into a neighbour. */
  touchesEdge?: boolean;
}

/** Facts about the cut on the task file (`file.sheet`). */
export interface MediaSheetResult {
  columns: number;
  rows: number;
  frames: boolean;
  /** Size of one cell in the render. */
  cellWidth: number;
  cellHeight: number;
}

const SAFE_PIECE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

/** `4x2` → `{ columns: 4, rows: 2 }`, or null when it is not a grid. */
export function parseMediaSheetGrid(value: string): { columns: number; rows: number } | null {
  const match = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/iu.exec(value);
  return match ? { columns: Number(match[1]), rows: Number(match[2]) } : null;
}

export type MediaSheetValidation =
  | { ok: true; sheet: { columns: number; rows: number; names: string[] | undefined; frames: boolean } }
  | { ok: false; message: string };

/** The one validation rule for a sheet, shared by the CLI and the daemon. */
export function validateMediaImageSheet(sheet: unknown): MediaSheetValidation {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return { ok: false, message: 'sheet must be an object with columns and rows' };
  const { columns, rows, names, frames } = sheet as Record<string, unknown>;
  for (const [key, value] of [['columns', columns], ['rows', rows]] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MEDIA_SHEET_MAX_SIDE) {
      return { ok: false, message: `sheet ${key} must be a whole number from 1 to ${MEDIA_SHEET_MAX_SIDE}` };
    }
  }
  const cells = (columns as number) * (rows as number);
  if (cells < 2 || cells > MEDIA_SHEET_MAX_CELLS) {
    return { ok: false, message: `a sheet has 2 to ${MEDIA_SHEET_MAX_CELLS} cells; use more sheets for more pieces` };
  }
  if (frames !== undefined && typeof frames !== 'boolean') return { ok: false, message: 'sheet frames must be true or false' };
  if (names !== undefined) {
    if (!Array.isArray(names) || names.length < 1 || names.some((name) => typeof name !== 'string')) {
      return { ok: false, message: 'sheet names must be a list of file names' };
    }
    const trimmed = names.map((name) => (name as string).trim().replace(/\.png$/iu, ''));
    if (trimmed.length > cells) return { ok: false, message: `${trimmed.length} names for ${cells} cells; use a bigger grid or another sheet` };
    const bad = trimmed.find((name) => !SAFE_PIECE_NAME.test(name));
    if (bad !== undefined) return { ok: false, message: `piece name "${bad}" must be a plain file name: letters, digits, ".", "_" or "-", no folder` };
    if (new Set(trimmed.map((name) => name.toLowerCase())).size !== trimmed.length) return { ok: false, message: 'piece names must be different' };
    return { ok: true, sheet: { columns: columns as number, rows: rows as number, names: trimmed, frames: frames === true } };
  }
  return { ok: true, sheet: { columns: columns as number, rows: rows as number, names: undefined, frames: frames === true } };
}

/** Piece names for every used cell: the given names, or the sheet's name numbered. */
export function mediaSheetPieceNames(sheet: { columns: number; rows: number; names?: readonly string[] | undefined }, sheetOutput: string): string[] {
  if (sheet.names?.length) return [...sheet.names];
  const base = sheetOutput.split('/').pop() ?? 'sheet';
  const stem = base.replace(/\.[^.]+$/u, '').replace(/[-_]?sheet$/iu, '') || 'piece';
  return Array.from({ length: sheet.columns * sheet.rows }, (_, index) => `${stem}-${index + 1}`);
}

/** Shapes every image path can render: OpenPixo hosted and Codex offer only these. */
export const MEDIA_SHEET_COMMON_ASPECTS = ['1:1', '3:2', '2:3'] as const;

function ratio(aspect: string): number {
  const [width, height] = aspect.split(':').map(Number);
  return width! / height!;
}

/**
 * The offered shape closest to the grid, so cells come out as square as the model
 * allows. The daemon cuts from the size the provider actually returns, so a shape
 * the provider replaces only makes the cells less square, never misaligned.
 */
export function mediaSheetAspect(columns: number, rows: number, offered: readonly string[] = MEDIA_SHEET_COMMON_ASPECTS): string {
  const target = Math.log(columns / rows);
  return offered.reduce((best, aspect) =>
    Math.abs(Math.log(ratio(aspect)) - target) < Math.abs(Math.log(ratio(best)) - target) ? aspect : best, offered[0] ?? '1:1');
}

/**
 * The layout the provider is asked for, after the caller's own prompt. The same text
 * goes to the price quote and the render, so the quoted request is the one sent.
 */
export function mediaSheetPrompt(prompt: string, sheet: { columns: number; rows: number; frames: boolean }, names: readonly string[]): string {
  const cells = sheet.columns * sheet.rows;
  const grid = `Layout: one image split into an even grid of ${sheet.columns} columns and ${sheet.rows} rows (${cells} equal cells), read left to right, then top to bottom.`;
  const content = sheet.frames
    ? `Each cell is the next frame of one animation of the same character: the same design, size and lighting in every cell, the whole body inside its cell, feet on one shared baseline near the bottom of the cell.`
    : `Each cell holds one separate object, centred, at the same scale and lighting as the others, with clear empty space around it. Cells in order: ${names.map((name, index) => `${index + 1} ${name.replace(/[-_.]+/gu, ' ')}`).join(', ')}${names.length < cells ? `; the remaining ${cells - names.length} cell${cells - names.length === 1 ? '' : 's'} empty` : ''}.`;
  return [prompt.trim(), [grid, content, 'Nothing crosses into a neighbouring cell. No text, labels, numbers, borders, frames or grid lines.'].join(' ')]
    .filter(Boolean).join('\n\n');
}
