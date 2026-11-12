#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ffmpeg = process.argv[2];
assert(ffmpeg, 'Supply the existing bundled FFmpeg executable.');
assert(readFileSync(join(root, 'project.godot'), 'utf8').includes('OpenPixo live acceptance fixture'), 'Use only the disposable live acceptance project.');
const destination = join(root, 'derived', 'live-volume');
mkdirSync(join(destination, 'audio'), { recursive: true });
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const version = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0];
const results = ['one.wav', 'two.wav'].map(name => {
  const source = `audio/${name}`;
  const output = `derived/live-volume/audio/${name}`;
  const inputPath = join(root, source);
  const outputPath = join(root, output);
  const sourceSha256 = sha(inputPath);
  const temporary = join(destination, 'audio', `${name}-${randomUUID()}.tmp.wav`);
  try {
    if (existsSync(outputPath)) return { source, sourceSha256, output: null, status: 'skipped', reason: 'Output already exists', originalPreserved: sha(inputPath) === sourceSha256 };
    execFileSync(ffmpeg, ['-nostdin', '-n', '-i', inputPath, '-af', 'volume=0.5', '-c:a', 'pcm_s16le', temporary], { stdio: 'pipe' });
    const result = readFileSync(temporary);
    assert(result.toString('ascii', 0, 4) === 'RIFF' && result.toString('ascii', 8, 12) === 'WAVE', 'FFmpeg did not produce WAV.');
    // Atomic link creation refuses an occupied output on every supported OS.
    linkSync(temporary, outputPath);
    return { source, sourceSha256, output, outputSha256: sha(outputPath), status: 'succeeded', exitCode: 0, originalPreserved: sha(inputPath) === sourceSha256 };
  } catch (error) {
    return { source, sourceSha256, output: null, status: 'failed', exitCode: 1, error: String(error), originalPreserved: sha(inputPath) === sourceSha256 };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
});
const report = { skill: 'game-assets-batch', operation: 'volume', parameters: { multiplier: 0.5, codec: 'pcm_s16le' }, tool: { path: ffmpeg, version }, results };
writeFileSync(join(destination, 'report-live.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
assert(results.every(result => result.status === 'succeeded' && result.originalPreserved), 'The batch did not preserve and process every selected input.');
process.stdout.write('OPENPIXO_BATCH_OK: 2 inputs processed; originals preserved.\n');
