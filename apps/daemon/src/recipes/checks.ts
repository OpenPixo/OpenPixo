import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import type { Recipe, RecipeCandidate } from '@openpixo/contracts';
import { renderRecipeParams } from './template.js';

const execute = promisify(execFile);
export async function checkRecipeFile(file: string, check: NonNullable<Recipe['checks']>[number], variables: Record<string, unknown>): Promise<RecipeCandidate['checks'][number]> {
  try {
    const params = renderRecipeParams(check.params, variables);
    let ok = false;
    let detail = '';
    if (check.check === 'duration-range' || check.check === 'loudness-range') {
      const args = ['-hide_banner', '-i', file, ...(check.check === 'loudness-range' ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'] : []), '-f', 'null', '-'];
      const { stderr } = await execute(ffmpeg.path, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
      const duration = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      const volume = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
      const value = check.check === 'duration-range' && duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : volume ? Number(volume[1]) : NaN;
      const min = Number(params.min ?? params.minSeconds ?? params.minLufs ?? (params.minMs === undefined ? -Infinity : Number(params.minMs) / 1000));
      const max = Number(params.max ?? params.maxSeconds ?? params.maxLufs ?? (params.maxMs === undefined ? Infinity : Number(params.maxMs) / 1000));
      ok = Number.isFinite(value) && value >= min && value <= max;
      detail = `${value} ${check.check === 'duration-range' ? 'seconds' : 'LUFS'}`;
    } else {
      const image = sharp(file);
      const meta = await image.metadata();
      if (check.check === 'has-alpha') {
        const stats = await image.stats();
        ok = meta.hasAlpha === true && (stats.channels.at(-1)?.min ?? 255) < 255;
        detail = ok ? 'Transparent pixels present' : 'No transparent pixels';
      } else if (check.check === 'dimensions') {
        if (params.width === undefined && params.height === undefined) throw new Error('dimensions requires width or height');
        ok = (params.width === undefined || meta.width === Number(params.width)) && (params.height === undefined || meta.height === Number(params.height));
        detail = `${meta.width}x${meta.height}`;
      } else if (check.check === 'grid-divisible') {
        const grid = String(params.grid ?? '').match(/^(\d+)x(\d+)$/);
        if (!grid || !Number(grid[1]) || !Number(grid[2])) throw new Error('Invalid grid');
        ok = Boolean(meta.width && meta.height && meta.width % Number(grid[1]) === 0 && meta.height % Number(grid[2]) === 0);
        detail = `${meta.width}x${meta.height} / ${params.grid}`;
      } else if (check.check === 'seamless') {
        const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let delta = 0;
        for (let y = 0; y < info.height; y++) for (let c = 0; c < info.channels; c++) delta += Math.abs(data[(y * info.width) * info.channels + c]! - data[(y * info.width + info.width - 1) * info.channels + c]!);
        for (let x = 0; x < info.width; x++) for (let c = 0; c < info.channels; c++) delta += Math.abs(data[x * info.channels + c]! - data[((info.height - 1) * info.width + x) * info.channels + c]!);
        const score = delta / ((info.width + info.height) * info.channels * 255);
        ok = score <= Number(params.threshold ?? 0.05);
        detail = `Normalized opposite-edge difference: ${score.toFixed(4)}`;
      }
    }
    return { check: check.check, ok, detail };
  } catch (error) { return { check: check.check, ok: false, detail: error instanceof Error ? error.message : String(error) }; }
}
