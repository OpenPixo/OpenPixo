import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

export async function folderLooksLikePlugin(folder: string) {
  const names = ['pixo.json', 'SKILL.md', path.join('.claude-plugin', 'plugin.json')];
  for (const name of names) {
    if (fs.existsSync(path.join(folder, name))) return true;
  }
  return false;
}

export async function findUploadedPluginRoot(stagedFolder: string) {
  if (await folderLooksLikePlugin(stagedFolder)) return stagedFolder;
  const entries = await fs.promises.readdir(stagedFolder, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (files.length === 0 && dirs.length === 1) {
    const nested = path.join(stagedFolder, dirs[0]!.name);
    if (await folderLooksLikePlugin(nested)) return nested;
  }
  return stagedFolder;
}

export function safeUploadRelativePath(input: unknown) {
  const value = String(input || '').replace(/\\/g, '/');
  if (!value || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
    throw new Error('invalid upload path');
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`unsafe upload path: ${value}`);
  }
  return parts.join(path.sep);
}

/** Shared by uploaded plugin packages and integrity-checked store downloads. */
export async function extractPluginZipToFolder(buffer: Buffer, stagedFolder: string, maxBytes: number) {
  if (buffer.length > maxBytes) throw new Error('zip file too large');
  const zip = await JSZip.loadAsync(buffer);
  let totalBytes = 0;
  const entries = Object.values(zip.files);
  if (entries.length === 0) throw new Error('zip contains no files');
  for (const entry of entries) {
    if (entry.dir) continue;
    const rel = safeUploadRelativePath(entry.name);
    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`zip entry is a symbolic link: ${entry.name}`);
    const content = await entry.async('nodebuffer');
    totalBytes += content.length;
    if (totalBytes > maxBytes) throw new Error('zip extracted size exceeds 50 MiB');
    const dest = path.join(stagedFolder, rel);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, content);
  }
}
