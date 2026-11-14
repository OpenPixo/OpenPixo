import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATE_REFERENCE_DIR, type GenerateReferenceResponse, type RecipeDetail, type RecipeQuoteRequest } from '@openpixo/contracts';

/**
 * The 生成 page's own folder under the daemon data root (`RUNTIME_DATA_DIR/generate`). A run
 * with no game reads its references from here, the way a game's run reads them from the
 * game. Only uploaded pictures live in it; results stay in `recipe-runs/` as for every run.
 */
export const GENERATE_AREA_DIR = 'generate';
/** An uploaded reference nobody has uploaded again for this long is removed. Runs keep their own copies. */
export const GENERATE_REFERENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const GENERATE_REFERENCE_MAX_BYTES = 16 * 1024 * 1024;

const REFERENCE_INPUTS = new Set(['image-ref', 'asset-ref', 'file']);

/**
 * What a run with no game may ask for: no code (that starts an agent in a game), no
 * character (characters live in a game), and references only from the uploaded pictures.
 */
export function assertNoGameRequest(detail: RecipeDetail, request: RecipeQuoteRequest): void {
  const recipe = detail.manifest.pixo!.recipe!;
  if (recipe.surface === 'code') throw new Error('This recipe changes a game; pick a game first.');
  for (const field of recipe.inputs) {
    const value = request.inputs?.[field.name];
    if (value === undefined || value === null || value === '') continue;
    if (field.type === 'character-ref') throw new Error('Characters belong to a game; pick a game to use one.');
    if (REFERENCE_INPUTS.has(field.type ?? '') && !(typeof value === 'string' && value.startsWith(`${GENERATE_REFERENCE_DIR}/`) && !value.includes('..'))) {
      throw new Error(`With no game, ${field.name} must be a picture uploaded to 生成.`);
    }
  }
}

/** The picture type a file really is, by its first bytes, or null for anything else. */
export function pictureType(bytes: Buffer): { ext: string; mime: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/**
 * Keeps one uploaded picture under its content hash, so the same picture twice is one file
 * and one ref. Uploading it again keeps it for another retention period.
 */
export async function saveGenerateReference(root: string, bytes: Buffer): Promise<GenerateReferenceResponse> {
  const type = pictureType(bytes);
  if (!type) throw Object.assign(new Error('A reference must be a PNG, JPEG or WebP picture.'), { code: 'UNSUPPORTED' });
  const dir = path.join(root, GENERATE_REFERENCE_DIR);
  await mkdir(dir, { recursive: true });
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${type.ext}`;
  const file = path.join(dir, name);
  const now = new Date();
  try { await stat(file); await utimes(file, now, now); }
  catch { await writeFile(file, bytes); }
  void sweepGenerateReferences(root).catch(error => console.warn('[generate] reference sweep failed:', error instanceof Error ? error.message : error));
  return { ref: `${GENERATE_REFERENCE_DIR}/${name}`, mime: type.mime, size: bytes.length };
}

export async function sweepGenerateReferences(root: string, now = Date.now()): Promise<void> {
  const dir = path.join(root, GENERATE_REFERENCE_DIR);
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const entry of entries) {
    const file = path.join(dir, entry);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs > GENERATE_REFERENCE_RETENTION_MS) await rm(file, { force: true });
  }
}
