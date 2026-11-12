import { spawn } from 'node:child_process';
import path from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import type { AssetOpName } from '@openpixo/contracts';
import { choiceParam, integerParam, numberParam, writeNew } from './files.js';
import { outputStem, type OpPlan } from './images.js';

export const ffmpegPath = (): string => process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || ffmpegInstaller.path;

/** Literal argv only; bounded output and runtime, with the real exit status retained. */
export function runFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-nostdin', '-n', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let length = 0, stderr = '', failure: string | undefined;
    const timeout = setTimeout(() => { failure = 'FFmpeg timed out after 120 seconds'; child.kill(); }, 120_000);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 128 * 1024 * 1024) { failure = 'Decoded audio exceeds 128 MiB'; child.kill(); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-16_384); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0 && !failure) resolve(Buffer.concat(chunks));
      else reject(Object.assign(new Error(failure ?? `FFmpeg failed: ${stderr.trim()}`), { exitCode: code ?? 1 }));
    });
  });
}

export async function ffmpegVersion(): Promise<string> {
  const output = (await runFfmpeg(['-version'])).toString('utf8').split(/\r?\n/)[0]?.trim();
  if (!output?.startsWith('ffmpeg version')) throw new Error('Cannot determine FFmpeg version');
  return output;
}

/** Encode PCM as RIFF/WAVE with a standard smpl chunk, loop end inclusive. */
function loopWav(decoded: Buffer, crossfadeMs: number): { wav: Buffer; frames: number } {
  if (decoded.toString('ascii', 0, 4) !== 'RIFF' || decoded.toString('ascii', 8, 12) !== 'WAVE') throw new Error('FFmpeg did not produce WAV');
  let pcm: Buffer | undefined;
  for (let offset = 12; offset + 8 <= decoded.length;) {
    const size = decoded.readUInt32LE(offset + 4);
    if (decoded.toString('ascii', offset, offset + 4) === 'data') { pcm = decoded.subarray(offset + 8, Math.min(decoded.length, offset + 8 + size)); break; }
    offset += 8 + size + (size % 2);
  }
  if (!pcm?.length) throw new Error('Audio has no PCM samples');
  const rate = 48000, channels = 2, block = channels * 2;
  const inputFrames = Math.floor(pcm.length / block), fade = Math.round(crossfadeMs * rate / 1000);
  if (fade * 2 >= inputFrames) throw new Error('crossfadeMs must be shorter than half the audio duration');
  const frames = inputFrames - fade;
  const data = Buffer.alloc(frames * block);
  pcm.copy(data, 0, fade * block, (inputFrames - fade) * block);
  for (let i = 0; i < fade; i++) for (let channel = 0; channel < channels; channel++) {
    const tail = pcm.readInt16LE(((inputFrames - fade + i) * channels + channel) * 2);
    const head = pcm.readInt16LE((i * channels + channel) * 2);
    const weight = (i + 0.5) / fade;
    data.writeInt16LE(Math.round(tail * (1 - weight) + head * weight), ((inputFrames - 2 * fade + i) * channels + channel) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length + 68, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * block, 28); header.writeUInt16LE(block, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  const smpl = Buffer.alloc(68);
  smpl.write('smpl', 0); smpl.writeUInt32LE(60, 4); smpl.writeUInt32LE(Math.round(1_000_000_000 / rate), 16);
  smpl.writeUInt32LE(60, 20); smpl.writeUInt32LE(1, 36); smpl.writeUInt32LE(frames - 1, 56);
  return { wav: Buffer.concat([header, data, smpl]), frames };
}

export function planAudioOp(source: string, file: string, op: AssetOpName, params: Record<string, unknown>, out: string): OpPlan {
  // Force the selected local container: a renamed playlist cannot open other files or URLs.
  const demuxers: Record<string, string> = { '.wav': 'wav', '.wave': 'wav', '.ogg': 'ogg', '.opus': 'ogg', '.mp3': 'mp3', '.flac': 'flac', '.aac': 'aac', '.m4a': 'mov', '.aif': 'aiff', '.aiff': 'aiff' };
  const demuxer = demuxers[path.extname(source).toLowerCase()];
  if (!demuxer) throw new Error('Unsupported audio input container');
  const input = ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', file, '-map', '0:a:0', '-vn', '-map_metadata', '-1'];
  const rate = integerParam(params, 'sampleRate', 48000, 8000, 192000);
  let format: 'wav' | 'ogg' | 'mp3' = 'wav';
  let filter: string | undefined, crossfade: number | undefined;
  switch (op) {
    case 'audio-normalize': {
      // https://ffmpeg.org/ffmpeg-filters.html#loudnorm — target is always explicit.
      const lufs = numberParam(params, 'lufs', undefined, -70, -5);
      filter = `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
      break;
    }
    case 'audio-trim': {
      const raw = params.silenceThreshold;
      const threshold = typeof raw === 'string' && /^-?\d+(?:\.\d+)?(?:dB)?$/i.test(raw) ? Number(raw.replace(/dB$/i, '')) : raw;
      const db = numberParam({ threshold }, 'threshold', undefined, -100, 0);
      const remove = `silenceremove=start_periods=1:start_duration=0:start_threshold=${db}dB`;
      filter = `${remove},areverse,${remove},areverse`;
      break;
    }
    case 'audio-loop': crossfade = numberParam(params, 'crossfadeMs', undefined, 0, 60_000); break;
    case 'audio-convert': format = choiceParam(params, 'format', ['wav', 'ogg', 'mp3'] as const); break;
    default: throw new Error(`Unsupported audio operation: ${op}`);
  }
  const output = `${outputStem(out, source)}.${format}`;
  const detail: Record<string, unknown> = {};
  return { outputs: [output], detail, produce: async ([target]) => {
    if (crossfade !== undefined) {
      const decoded = await runFfmpeg([...input, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1']);
      const loop = loopWav(decoded, crossfade);
      await writeNew(target!, loop.wav);
      Object.assign(detail, { sampleRate: 48000, loopStart: 0, loopEnd: loop.frames - 1, frames: loop.frames });
    } else {
      const codec = { wav: 'pcm_s16le', ogg: 'libvorbis', mp3: 'libmp3lame' }[format];
      await runFfmpeg([...input, ...(filter ? ['-af', filter] : []), '-ar', String(rate), '-c:a', codec, '-f', format, target!]);
    }
  } };
}
