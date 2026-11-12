import {
  IMAGE_OUTPUT_ASPECTS,
  MEDIA_SHEET_COMMON_ASPECTS,
  OPENPIXO_MEDIA_PROVIDER_ID,
  ImageOutputSizeError,
  mediaSheetAspect,
  mediaSheetPieceNames,
  mediaSheetPrompt,
  resolveImageOutputSize,
  validateMediaImageSheet,
} from '@openpixo/contracts';
import type { ImageSheetPlan } from './image-sheet.js';

/** The shapes a provider renders; the sheet's grid picks the closest. */
export function sheetAspectsFor(provider: string | undefined): readonly string[] {
  return provider === OPENPIXO_MEDIA_PROVIDER_ID || provider === 'codex-cli' ? MEDIA_SHEET_COMMON_ASPECTS : IMAGE_OUTPUT_ASPECTS;
}

export type SheetRequestResolution =
  | { ok: true; plan: ImageSheetPlan; body: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Turns a generate request with a `sheet` into the request for the render: the
 * layout written into the prompt, the grid's aspect, no size (it is each piece's) and,
 * for frames, a transparent background. The same body is priced and sent, so a quote
 * covers exactly the render. `pixelArt` is filled in once the art style is known.
 */
export function resolveSheetRequest(body: Record<string, unknown>, provider: string | undefined): SheetRequestResolution {
  if (body.surface !== 'image') return { ok: false, message: 'sheet applies to --surface image only' };
  if (body.count !== undefined && body.count !== 1) return { ok: false, message: 'a sheet is one image; drop count' };
  const validated = validateMediaImageSheet(body.sheet);
  if (!validated.ok) return validated;
  const output = typeof body.output === 'string' ? body.output.trim() : '';
  if (!output) return { ok: false, message: 'a sheet needs --output: the sheet is written there and its pieces next to it' };
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return { ok: false, message: 'a sheet needs a prompt that says what goes in the cells' };
  let pieceSize;
  try {
    pieceSize = resolveImageOutputSize({ width: body.width, height: body.height });
  } catch (error) {
    if (error instanceof ImageOutputSizeError) return { ok: false, message: error.message };
    throw error;
  }
  const { columns, rows, frames } = validated.sheet;
  const names = mediaSheetPieceNames(validated.sheet, output);
  const sheetFile = (output.split('/').pop() ?? '').replace(/\.[^.]+$/u, '').toLowerCase();
  if (names.some((name) => name.toLowerCase() === sheetFile)) {
    return { ok: false, message: `a piece is named like the sheet (${sheetFile}); name the sheet <set>-sheet.png` };
  }
  const transparent = frames || body.background === 'transparent';
  const { width: _width, height: _height, sheet: _sheet, ...rest } = body;
  return {
    ok: true,
    plan: { columns, rows, frames, names, pieceSize, transparent, pixelArt: false },
    body: {
      ...rest,
      prompt: mediaSheetPrompt(prompt, { columns, rows, frames }, names),
      aspect: mediaSheetAspect(columns, rows, sheetAspectsFor(provider)),
      ...(transparent ? { background: 'transparent' } : {}),
    },
  };
}
