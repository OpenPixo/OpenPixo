import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createPcmWav(samples: readonly number[]): Buffer {
  const result = Buffer.alloc(44 + samples.length * 2);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8); result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22); result.writeUInt32LE(8000, 24); result.writeUInt32LE(16000, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => result.writeInt16LE(value, 44 + index * 2));
  return result;
}

export async function createOpenPixoCodex(root: string) {
  await mkdir(root, { recursive: true });
  const receipt = join(root, 'receipts.jsonl');
  await writeFile(receipt, '');
  const script = fileURLToPath(new URL('../resources/openpixo-codex.ts', import.meta.url));
  const bin = join(root, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(bin, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" --receipt-log "${receipt}" %*\r\n`
    : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} --receipt-log ${shellQuote(receipt)} "$@"\n`);
  if (process.platform !== 'win32') await chmod(bin, 0o755);
  return { bin, receipt };
}

export async function createOpenPixoGame(root: string) {
  await mkdir(join(root, 'assets'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const wav = createPcmWav(Array.from({ length: 800 }, (_, index) => Math.round(Math.sin(index / 16 * Math.PI) * 12000)));
  await Promise.all([
    writeFile(join(root, 'assets', 'sprite.png'), png),
    writeFile(join(root, 'assets', 'jump.wav'), wav),
    writeFile(join(root, 'project.godot'), '[application]\nconfig/name="OpenPixo acceptance fixture"\n'),
    writeFile(join(root, 'game.ts'), 'export const playerSpeed = 120;\n'),
  ]);
  return { root, png, wav };
}
