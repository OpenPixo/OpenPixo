import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readGamePlaytestScript } from '../../src/game/playtest-cli.js';

// An agent on Windows writes its playtest script from PowerShell 5.1:
// `Set-Content -Encoding UTF8` adds a UTF-8 byte order mark and `>` writes
// UTF-16 LE with one. A hosted run lost minutes and credits retrying on
// "Unexpected token '﻿'" before it found the mark itself.
const SCRIPT = [{ wait: 3000 }, { key: 'Enter', press: true, holdMs: 100 }, { capture: 'run-1' }];
const TEXT = JSON.stringify(SCRIPT);

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'pixo-playtest-script-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function scriptFile(name: string, bytes: Buffer): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

function utf16be(text: string): Buffer {
  const le = Buffer.from(text, 'utf16le');
  for (let i = 0; i < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1]!, le[i]!];
  return le;
}

describe('reading a playtest script file', () => {
  it('reads plain UTF-8', async () => {
    expect(await readGamePlaytestScript(await scriptFile('plain.json', Buffer.from(TEXT, 'utf8')))).toEqual(SCRIPT);
  });

  it('reads UTF-8 with a byte order mark (Set-Content -Encoding UTF8)', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXT, 'utf8')]);
    expect(await readGamePlaytestScript(await scriptFile('bom.json', bytes))).toEqual(SCRIPT);
  });

  it('reads UTF-16 LE with a byte order mark (PowerShell 5.1 `>`)', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${TEXT}\r\n`, 'utf16le')]);
    expect(await readGamePlaytestScript(await scriptFile('utf16le.json', bytes))).toEqual(SCRIPT);
  });

  it('reads UTF-16 BE with a byte order mark', async () => {
    const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be(TEXT)]);
    expect(await readGamePlaytestScript(await scriptFile('utf16be.json', bytes))).toEqual(SCRIPT);
  });
});
