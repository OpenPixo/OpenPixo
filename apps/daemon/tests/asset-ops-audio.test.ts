import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runAssetOp } from '../src/assets/ops/index.js';
import { runFfmpeg } from '../src/assets/ops/audio.js';

let projectRoot: string;
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), 'asset-ops-audio-'));
  await mkdir(path.join(projectRoot, 'sounds'));
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', path.join(projectRoot, 'sounds/tone.wav')]);
});
afterEach(async () => {
  if (!projectRoot.startsWith(path.join(tmpdir(), 'asset-ops-audio-'))) throw new Error('Unsafe cleanup target');
  await rm(projectRoot, { recursive: true, force: true });
});

it('normalizes an explicit LUFS target, preserves the source, and rejects a missing target', async () => {
  const report = await runAssetOp({ projectRoot }, { op: 'audio-normalize', inputs: ['sounds/tone.wav'], params: { lufs: -16 } });
  expect(report.counts.failed).toBe(0);
  expect(report.tool).toMatch(/^ffmpeg version/);
  expect(report.results[0]).toMatchObject({ status: 'succeeded', exitCode: 0, output: 'derived/audio-normalize/sounds/tone.wav' });
  expect(report.originalsPreserved).toBe(true);
  const output = path.join(projectRoot, report.results[0]!.output!);
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', output, '-f', 'null', '-']);
  const missing = await runAssetOp({ projectRoot }, { op: 'audio-normalize', inputs: ['sounds/tone.wav'] });
  expect(missing.results[0]).toMatchObject({ status: 'failed', output: null, error: expect.stringContaining('lufs') });
});

it('converts to readable OGG, trims silence and emits WAV smpl loop points', async () => {
  const report = await runAssetOp({ projectRoot }, { op: 'audio-convert', inputs: ['sounds/tone.wav'], params: { format: 'ogg', sampleRate: 44100 } });
  expect(report.counts).toEqual({ succeeded: 1, failed: 0, skipped: 0 });
  const ogg = await readFile(path.join(projectRoot, report.results[0]!.output!));
  expect(ogg.toString('ascii', 0, 4)).toBe('OggS');
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', path.join(projectRoot, report.results[0]!.output!), '-f', 'null', '-']);
  const trimmed = await runAssetOp({ projectRoot }, { op: 'audio-trim', inputs: ['sounds/tone.wav'], params: { silenceThreshold: '-50dB' } });
  expect(trimmed.counts.failed).toBe(0);
  const loop = await runAssetOp({ projectRoot }, { op: 'audio-loop', inputs: ['sounds/tone.wav'], params: { crossfadeMs: 100 } });
  expect(loop.counts.failed).toBe(0);
  const wav = await readFile(path.join(projectRoot, loop.results[0]!.output!));
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  const offset = wav.length - 68;
  expect(wav.toString('ascii', offset, offset + 4)).toBe('smpl');
  expect(wav.readUInt32LE(offset + 36)).toBe(1);
  expect(wav.readUInt32LE(offset + 52)).toBe(0);
  expect(wav.readUInt32LE(offset + 56)).toBe(43199);
  expect(loop.results[0]!.detail).toMatchObject({ loopStart: 0, loopEnd: 43199, frames: 43200 });
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', path.join(projectRoot, loop.results[0]!.output!), '-f', 'null', '-']);
});
