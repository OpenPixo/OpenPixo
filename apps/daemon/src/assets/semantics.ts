import path from 'node:path';
import { open, readFile, stat } from 'node:fs/promises';
import type { AssetFrame, AssetSemantics, EngineAssetMeta } from '@openpixo/contracts';

export interface AssetEvidence {
  /** Project-relative asset described by this evidence file. */
  target: string;
  semantics: AssetSemantics;
  engineMeta?: EngineAssetMeta;
}

function reference(source: string, ref: string): string | null {
  const target = path.posix.normalize(ref.startsWith('res://') ? ref.slice(6) : path.posix.join(path.posix.dirname(source), ref.replace(/\\/g, '/')));
  return !target.startsWith('../') && target !== '..' && !path.posix.isAbsolute(target) && !target.includes(':') ? target : null;
}

function framesFromJson(value: unknown): AssetFrame[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, entry]) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const rect = item.frame as Record<string, unknown> | undefined;
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(v => typeof v === 'number' && Number.isFinite(v))
      || Number(rect.w) <= 0 || Number(rect.h) <= 0) return [];
    return [{ name: typeof item.filename === 'string' ? item.filename : name,
      x: Number(rect.x), y: Number(rect.y), width: Number(rect.w), height: Number(rect.h),
      ...(typeof item.duration === 'number' ? { durationMs: item.duration } : {}) }];
  });
}

/** Small evidence parsers, deliberately refusing filename/size heuristics. */
export function parseAssetEvidence(source: string, bytes: string | Buffer): AssetEvidence[] {
  const ext = path.posix.extname(source).toLowerCase();
  const text = typeof bytes === 'string' ? bytes : bytes.toString(ext === '.ogg' ? 'latin1' : 'utf8');
  const result: AssetEvidence[] = [];
  const add = (target: string | null, semantics: AssetSemantics, engineMeta?: EngineAssetMeta) => {
    if (target) result.push({ target, semantics, ...(engineMeta ? { engineMeta } : {}) });
  };
  if (ext === '.json') {
    try {
      const data = JSON.parse(text) as { frames?: unknown; meta?: { image?: string; app?: string; frameTags?: unknown } };
      const frames = framesFromJson(data.frames);
      if (frames.length && typeof data.meta?.image === 'string') {
        const aseprite = /aseprite/i.test(data.meta.app ?? '') || Array.isArray(data.meta.frameTags);
        add(reference(source, data.meta.image), [{ type: aseprite ? 'sprite-sheet' : 'atlas', source, frames }]);
      }
    } catch { /* Ordinary project JSON is not necessarily an atlas. */ }
  } else if (ext === '.atlas' && /^\s*(?:xy|bounds):\s*\d+/m.test(text)) {
    for (const match of text.matchAll(/^([^\s\r\n].*\.(?:png|jpe?g|webp))\r?\n(?=\s*(?:size|format|filter|pma|repeat):)/gmi)) {
      add(reference(source, match[1]!.trim()), [{ type: 'atlas', source }]);
    }
  } else if (ext === '.meta') {
    const target = source.slice(0, -5);
    const guid = /^guid:\s*([a-f\d]{32})\s*$/mi.exec(text)?.[1];
    const importer = /^(\w+Importer):/m.exec(text)?.[1];
    const semantics: AssetSemantics = [];
    if (/^\s*spriteMode:\s*2\s*$/m.test(text) && /^\s*spriteSheet:/m.test(text)) semantics.push({ type: 'sprite-sheet', source });
    const border = /spriteBorder:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*z:\s*([\d.]+),\s*w:\s*([\d.]+)\s*\}/.exec(text);
    if (border && border.slice(1).some(v => Number(v) > 0)) semantics.push({ type: 'nine-slice', source,
      border: { left: Number(border[1]), bottom: Number(border[2]), right: Number(border[3]), top: Number(border[4]) } });
    add(target, semantics, { engine: 'unity', source, ...(guid ? { guid } : {}), ...(importer ? { importer } : {}) });
  } else if (ext === '.import') {
    const uid = /^uid\s*=\s*"([^"]+)"/m.exec(text)?.[1];
    const importer = /^importer\s*=\s*"([^"]+)"/m.exec(text)?.[1];
    const looping = /^\s*(?:loop|loop_mode|loop\/mode|loop\/enabled)\s*=\s*(?:true|[1-9]\d*)\s*$/m.test(text);
    add(source.slice(0, -7), looping ? [{ type: 'loop', source }] : [], {
      engine: 'godot', source, ...(uid ? { uid } : {}), ...(importer ? { importer } : {}),
    });
  } else if (ext === '.tres' || ext === '.tscn') {
    const semantics: AssetSemantics = [];
    if (/\btype="SpriteFrames"/.test(text)) semantics.push({ type: 'sprite-sheet', source });
    if (/\btype="AtlasTexture"/.test(text)) semantics.push({ type: 'atlas', source });
    if (/\btype="TileSet"/.test(text)) semantics.push({ type: 'tileset', source });
    const textures = new Map<string, string>();
    for (const match of text.matchAll(/\[ext_resource\s+([^\]]+)\]/g)) {
      const ref = /\bpath="([^"]+)"/.exec(match[1]!)?.[1];
      const id = /\bid="([^"]+)"/.exec(match[1]!)?.[1];
      const target = ref && reference(source, ref);
      if (target && id) textures.set(id, target);
    }
    if (semantics.length) {
      add(source, semantics);
      for (const target of new Set(textures.values())) if (/\.(?:png|jpe?g|webp|svg)$/i.test(target)) add(target, semantics);
    }
    for (const match of text.matchAll(/\[node\s+[^\]]*\btype="NinePatchRect"[^\]]*\]([^]*?)(?=\[node|$)/g)) {
      const id = /\btexture\s*=\s*ExtResource\(\s*"([^"]+)"\s*\)/.exec(match[1]!)?.[1];
      if (id && textures.has(id)) add(textures.get(id)!, [{ type: 'nine-slice', source }]);
    }
  } else if ((ext === '.tsx' || ext === '.tmx') && /<tileset\b/.test(text)) {
    add(source, [{ type: 'tileset', source }]);
    for (const match of text.matchAll(/<image\b[^>]*\bsource\s*=\s*["']([^"']+)["']/g)) add(reference(source, match[1]!), [{ type: 'tileset', source }]);
  } else if (ext === '.wav' && Buffer.isBuffer(bytes)) {
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const size = bytes.readUInt32LE(offset + 4);
        if (bytes.toString('ascii', offset, offset + 4) === 'smpl' && size >= 60 && offset + 68 <= bytes.length
          && bytes.readUInt32LE(offset + 8 + 28) > 0) {
          add(source, [{ type: 'loop', source, loop: { start: bytes.readUInt32LE(offset + 52), end: bytes.readUInt32LE(offset + 56) } }]);
          break;
        }
        offset += 8 + size + (size % 2);
      }
    }
  } else if (ext === '.ogg') {
    const start = /LOOPSTART=(\d+)/i.exec(text)?.[1];
    const end = /LOOPEND=(\d+)/i.exec(text)?.[1];
    if (start && text.startsWith('OggS')) add(source, [{ type: 'loop', source,
      loop: { start: Number(start), ...(end ? { end: Number(end) } : {}) } }]);
  }
  return result;
}

/** Read small descriptors; skip audio sample data when looking for WAV loops. */
export async function readAssetEvidence(filePath: string, source: string): Promise<AssetEvidence[]> {
  const ext = path.extname(source).toLowerCase();
  if (ext === '.wav') {
    const file = await open(filePath, 'r');
    try {
      const header = Buffer.alloc(12);
      await file.read(header, 0, 12, 0);
      if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return [];
      const size = (await file.stat()).size;
      for (let offset = 12; offset + 8 <= size;) {
        const chunk = Buffer.alloc(8);
        await file.read(chunk, 0, 8, offset);
        const length = chunk.readUInt32LE(4);
        if (chunk.toString('ascii', 0, 4) === 'smpl' && length >= 60 && offset + 68 <= size) {
          const loop = Buffer.alloc(60);
          await file.read(loop, 0, 60, offset + 8);
          return parseAssetEvidence(source, Buffer.concat([header, chunk, loop]));
        }
        offset += 8 + length + (length % 2);
      }
      return [];
    } finally { await file.close(); }
  }
  if (!['.json', '.atlas', '.tres', '.tscn', '.tsx', '.tmx', '.meta', '.import', '.ogg'].includes(ext)) return [];
  if (ext !== '.ogg') return (await stat(filePath)).size <= 4 * 1024 * 1024 ? parseAssetEvidence(source, await readFile(filePath)) : [];
  const file = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return parseAssetEvidence(source, buffer.subarray(0, bytesRead));
  } finally { await file.close(); }
}
