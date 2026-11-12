import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isRecipeRelativePath } from '@openpixo/contracts';

/** Check every existing ancestor so project links cannot redirect reads or writes outside the root. */
export async function recipePath(root: string, relative: string): Promise<string> {
  if (!isRecipeRelativePath(relative)) throw new Error('Path must be project-relative and contain no ..');
  const canonical = await realpath(root);
  const parts = relative.replaceAll('\\', '/').split('/').filter(part => part && part !== '.');
  if (!parts.length) return canonical;
  let target = canonical;
  for (const part of parts) {
    if (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error('Invalid filename');
    target = path.join(target, part);
    try { await lstat(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const resolved = await realpath(target);
    const rel = path.relative(canonical, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes project root');
  }
  return target;
}

export function recipeFileName(value: string): string {
  if (!value || value === '.' || /[\\/<>:"|?*\x00-\x1f]/.test(value) || value.includes('..') || /[. ]$/.test(value)) throw new Error('Invalid recipe output name');
  return value;
}
