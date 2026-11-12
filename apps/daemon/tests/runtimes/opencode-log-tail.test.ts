// The failure tail is read once per failed OpenCode run from a session log that
// can be far larger than the tail, because OpenCode embeds whole request bodies.
// It must read only the bytes it returns, and what it returns must be an exact
// suffix of the file: a cut through a multi-byte character may shorten the tail,
// never garble its first character.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractOpenCodeServiceFailure, readLatestOpenCodeLogTail } from '../../src/runtimes/opencode-log.js';

// The module binds `node:fs` by name, which a spy on the default export misses.
const reads = vi.hoisted(() => ({
  wholeFile: [] as string[],
  positionalBytes: 0,
  opened: 0,
  closed: 0,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const patched = {
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      reads.wholeFile.push(String(args[0]));
      return actual.readFileSync(...args);
    },
    readSync: (...args: Parameters<typeof actual.readSync>) => {
      const bytes = actual.readSync(...args);
      reads.positionalBytes += bytes;
      return bytes;
    },
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      reads.opened += 1;
      return actual.openSync(...args);
    },
    closeSync: (...args: Parameters<typeof actual.closeSync>) => {
      reads.closed += 1;
      return actual.closeSync(...args);
    },
  };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
});

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-opencode-tail-'));
  reads.wholeFile.length = 0;
  reads.positionalBytes = 0;
  reads.opened = 0;
  reads.closed = 0;
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function writeLog(name: string, content: string | Buffer) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, content);
  return file;
}

describe('readLatestOpenCodeLogTail', () => {
  it('reads only the last bytes of a large log, and closes it', () => {
    const suffix = 'ERROR service=llm error={"statusCode":429,"message":"usage limit reached"}\n';
    const content = 'x'.repeat(5_000_000) + suffix;
    writeLog('2026-01-01.log', content);
    const tail = readLatestOpenCodeLogTail(directory, { maxBytes: Buffer.byteLength(suffix) });
    expect(tail).toBe(suffix);
    expect(extractOpenCodeServiceFailure(tail!)?.code).toBe('RATE_LIMITED');
    expect(reads.wholeFile.filter((file) => file.endsWith('.log'))).toEqual([]);
    expect(reads.positionalBytes).toBe(Buffer.byteLength(suffix));
    expect(reads.closed).toBe(reads.opened);
    expect(reads.opened).toBe(1);
  });

  it.each([
    ['one byte into a two-byte character', 'é', 1, ''],
    ['one byte into a three-byte character', '界', 1, ''],
    ['two bytes into a three-byte character', '界', 2, ''],
    ['one byte into a four-byte character', '🙂', 1, ''],
    ['three bytes into a four-byte character', '🙂', 3, ''],
    ['exactly on a character', '🙂', 4, '🙂'],
  ])('does not split a multi-byte character when cutting %s', (_label, character, kept, expected) => {
    writeLog('a.log', `head${character}tail`);
    const tail = readLatestOpenCodeLogTail(directory, { maxBytes: kept + 4 });
    expect(tail).toBe(`${expected}tail`);
    expect(tail).not.toContain('�');
  });

  it('returns a suffix of the file for every cut through mixed text', () => {
    const content = 'a中文🙂é\n配額🚀 tail';
    writeLog('a.log', content);
    const total = Buffer.byteLength(content);
    for (let maxBytes = 1; maxBytes <= total + 1; maxBytes += 1) {
      const tail = readLatestOpenCodeLogTail(directory, { maxBytes })!;
      expect(content.endsWith(tail)).toBe(true);
      expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(maxBytes);
      // Never more than one partial character (at most three bytes) is given up.
      expect(Buffer.byteLength(tail)).toBeGreaterThanOrEqual(Math.min(maxBytes, total) - 3);
    }
  });

  it('returns a file within the limit whole, including an empty one', () => {
    writeLog('a.log', '中文🙂tail');
    expect(readLatestOpenCodeLogTail(directory)).toBe('中文🙂tail');
    expect(readLatestOpenCodeLogTail(directory, { maxBytes: Buffer.byteLength('中文🙂tail') })).toBe('中文🙂tail');
    writeLog('b.log', '');
    expect(readLatestOpenCodeLogTail(directory)).toBe('');
  });

  it('decodes bytes that were never UTF-8 the way a whole-file read does', () => {
    const invalid = Buffer.concat([Buffer.from('head'), Buffer.from([0xff, 0xfe]), Buffer.from('tail')]);
    writeLog('a.log', invalid);
    expect(readLatestOpenCodeLogTail(directory, { maxBytes: 6 })).toBe('��tail');
  });

  it('still takes the newest log, skips logs older than the run, and tolerates no directory', () => {
    const older = writeLog('2026-01-01.log', 'older');
    const newer = writeLog('2026-01-02.log', 'newer');
    expect(readLatestOpenCodeLogTail(directory)).toBe('newer');
    fs.utimesSync(newer, new Date(1000), new Date(1000));
    fs.utimesSync(older, new Date(5000), new Date(5000));
    expect(readLatestOpenCodeLogTail(directory, { since: 2000 })).toBe('older');
    expect(readLatestOpenCodeLogTail(directory, { since: 9000 })).toBeNull();
    expect(readLatestOpenCodeLogTail(path.join(directory, 'missing'))).toBeNull();
  });

  it('moves on to the next log when the newest cannot be read', () => {
    writeLog('2026-01-01.log', 'older');
    fs.mkdirSync(path.join(directory, '2026-01-02.log'));
    expect(readLatestOpenCodeLogTail(directory)).toBe('older');
    expect(reads.closed).toBe(reads.opened);
  });
});
