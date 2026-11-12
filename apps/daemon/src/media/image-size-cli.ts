import { IMAGE_OUTPUT_MAX_EDGE, MEDIA_SHEET_MAX_CELLS, parseMediaSheetGrid, validateMediaImageSheet, type MediaGenerationRequest } from '@openpixo/contracts';

export const IMAGE_SIZE_CLI_STRING_FLAGS = ['width', 'height', 'size'] as const;
export const IMAGE_SIZE_CLI_BOOLEAN_FLAGS = ['transparent'] as const;

interface Flags {
  width?: string | undefined;
  height?: string | undefined;
  size?: string | undefined;
  transparent?: boolean | undefined;
  background?: string | undefined;
}

export class ImageSizeCliError extends Error {}

function pixels(value: string, flag: string): number {
  if (!/^\d+$/u.test(value.trim())) throw new ImageSizeCliError(`--${flag} must be a whole number of pixels`);
  return Number(value.trim());
}

/**
 * `--size 64` (square) or `--size 1536x864`, or `--width` / `--height`; plus
 * `--transparent` as the short form of `--background transparent`. Range limits
 * are the daemon's, so the CLI and the UI clamp identically.
 */
export function imageSizeCliRequestOptions(flags: Flags): Pick<MediaGenerationRequest, 'width' | 'height' | 'background'> {
  const options: Pick<MediaGenerationRequest, 'width' | 'height' | 'background'> = {};
  if (flags.size !== undefined) {
    if (flags.width !== undefined || flags.height !== undefined) throw new ImageSizeCliError('Use --size or --width/--height, not both');
    const match = /^(\d+)(?:\s*[x×*]\s*(\d+))?$/iu.exec(flags.size.trim());
    if (!match) throw new ImageSizeCliError('--size must be <px> or <width>x<height>, e.g. 64 or 1536x864');
    options.width = Number(match[1]);
    options.height = Number(match[2] ?? match[1]);
  } else {
    if (flags.width !== undefined) options.width = pixels(flags.width, 'width');
    if (flags.height !== undefined) options.height = pixels(flags.height, 'height');
  }
  if (flags.transparent === true) {
    if (flags.background !== undefined && flags.background !== 'transparent') {
      throw new ImageSizeCliError('--transparent conflicts with --background scene');
    }
    options.background = 'transparent';
  }
  return options;
}

export const IMAGE_SIZE_CLI_HELP = [
  `  --size <px|WxH>           Images: final pixel size, e.g. 64 (square) or 1536x864.`,
  `  --width <px> --height <px>`,
  `                            Same as --size; one side alone keeps --aspect. The long edge is`,
  `                            capped at ${IMAGE_OUTPUT_MAX_EDGE}px. The provider renders at its native size and the`,
  `                            daemon resizes to exactly this (PNG).`,
  '  --transparent             Images: PNG with real alpha on every provider (native alpha, or the',
  '                            daemon keys out a flat background). Same as --background transparent.',
].join('\n');

export const IMAGE_SHEET_CLI_STRING_FLAGS = ['sheet', 'names'] as const;
export const IMAGE_SHEET_CLI_BOOLEAN_FLAGS = ['frames'] as const;

/**
 * `--sheet 3x2 --names coin,heart,key` makes several images in one render and cuts
 * it; `--frames` makes the cells one animation's frames. Validation is the daemon's
 * (`validateMediaImageSheet`), so the CLI and the UI refuse the same sheets.
 */
export function imageSheetCliRequestOptions(flags: { sheet?: string | undefined; names?: string | undefined; frames?: boolean | undefined }): Pick<MediaGenerationRequest, 'sheet'> {
  if (flags.sheet === undefined) {
    if (flags.names !== undefined || flags.frames === true) throw new ImageSizeCliError('--names and --frames go with --sheet <columns>x<rows>');
    return {};
  }
  const grid = parseMediaSheetGrid(flags.sheet);
  if (!grid) throw new ImageSizeCliError('--sheet must be <columns>x<rows>, e.g. 3x2');
  const names = flags.names === undefined ? undefined : flags.names.split(',').map((name) => name.trim()).filter(Boolean);
  const sheet = { ...grid, ...(names ? { names } : {}), ...(flags.frames === true ? { frames: true } : {}) };
  const validated = validateMediaImageSheet(sheet);
  if (!validated.ok) throw new ImageSizeCliError(validated.message);
  return { sheet };
}

export const IMAGE_SHEET_CLI_HELP = [
  `  --sheet <C>x<R>           Images: make several small images, or one animation's frames, as ONE render`,
  `                            and cut it (one image's price). Grid of up to ${MEDIA_SHEET_MAX_CELLS} cells; the daemon picks`,
  '                            the shape and adds the layout to the prompt. --output is the sheet; each piece',
  '                            is written next to it as <name>.png. --size is each piece\'s final size.',
  '  --names a,b,c             Piece names, one per cell, left to right then top to bottom (no folder or',
  '                            extension); fewer names than cells leaves the rest empty. Default <sheet>-1, -2, …',
  '  --frames                  The cells are frames of one animation: same scale, feet on one line at the',
  '                            bottom centre, transparent. Without it each piece is fitted on its own.',
].join('\n');
