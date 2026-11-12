import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import type { AssetWaveform, ProjectAsset } from '@openpixo/contracts';

export interface AssetPreviewInput {
  runtimeDataDir: string;
  filePath: string;
  contentHash: string;
}

const pending = new Map<string, Promise<string>>();

async function cached(input: AssetPreviewInput, suffix: string, render: () => Promise<Buffer>): Promise<string> {
  if (!/^[a-f\d]{64}$/.test(input.contentHash)) throw new Error('A SHA-256 content hash is required');
  const dir = path.join(input.runtimeDataDir, 'asset-thumbnails');
  const target = path.join(dir, `${input.contentHash}-${suffix}`);
  try { if ((await stat(target)).isFile()) return target; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const active = pending.get(target);
  if (active) return active;
  const work = (async () => {
    await mkdir(dir, { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp, await render(), { flag: 'wx' }); await rename(temp, target); }
    finally { await rm(temp, { force: true }); }
    return target;
  })();
  pending.set(target, work);
  try { return await work; } finally { pending.delete(target); }
}

/** The same bundled FFmpeg / explicit override used by the media renderer. */
function ffmpeg(args: string[], onData: (data: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || ffmpegInstaller.path;
    const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-filter_threads', '1', ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Asset preview timed out')); }, 120_000);
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    child.stdout.on('data', (data: Buffer) => {
      try { onData(data); } catch (error) { child.kill(); reject(error); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg preview failed: ${stderr || code}`)); });
  });
}

export async function getAssetThumbnail(input: AssetPreviewInput & { kind: ProjectAsset['kind']; size: 256 | 1024 }): Promise<string | null> {
  if (input.kind !== 'image' && input.kind !== 'video') return null;
  if (input.size !== 256 && input.size !== 1024) throw new Error('Thumbnail size must be 256 or 1024');
  return cached(input, `${input.size}.webp`, async () => {
    let source: string | Buffer = input.filePath;
    if (input.kind === 'video') {
      const chunks: Buffer[] = []; let length = 0;
      await ffmpeg(['-i', input.filePath, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], chunk => {
        length += chunk.length;
        if (length > 64 * 1024 * 1024) throw new Error('Video poster exceeds preview budget');
        chunks.push(chunk);
      });
      source = Buffer.concat(chunks);
    }
    // Previews decode like a browser: tolerate recoverable corruption (bad CRCs etc.) found in real game folders.
    const metadata = await sharp(source, { failOn: 'none' }).metadata();
    const pixelArt = Math.max(metadata.width ?? 128, metadata.height ?? 128) < 128;
    return sharp(source, { failOn: 'none' }).rotate().resize(input.size, input.size, { fit: 'inside', kernel: pixelArt ? 'nearest' : 'lanczos3' })
      .webp({ quality: 85, ...(pixelArt ? { lossless: true } : {}) }).toBuffer();
  });
}

/** Decode incrementally: retain 50 peaks/second, never the full PCM stream. */
export async function getAssetWaveform(input: AssetPreviewInput): Promise<AssetWaveform> {
  const file = await cached(input, 'waveform.json', async () => {
    const peaks: number[] = []; let pendingBytes = Buffer.alloc(0);
    let samples = 0, inPoint = 0, peak = 0;
    await ffmpeg(['-i', input.filePath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], chunk => {
      const buffer = pendingBytes.length ? Buffer.concat([pendingBytes, chunk]) : chunk;
      const length = buffer.length - buffer.length % 4;
      for (let offset = 0; offset < length; offset += 4) {
        const sample = Math.abs(buffer.readFloatLE(offset));
        peak = Math.max(peak, Number.isFinite(sample) ? Math.min(1, sample) : 0);
        samples++; inPoint++;
        if (inPoint === 160) { peaks.push(peak); peak = 0; inPoint = 0; }
      }
      pendingBytes = Buffer.from(buffer.subarray(length));
    });
    if (inPoint) peaks.push(peak);
    const waveform: AssetWaveform = { pointsPerSecond: 50, peaks, durationMs: samples / 8 };
    return Buffer.from(JSON.stringify(waveform));
  });
  return JSON.parse(await readFile(file, 'utf8')) as AssetWaveform;
}
