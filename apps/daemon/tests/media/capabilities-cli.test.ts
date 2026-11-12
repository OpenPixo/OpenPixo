import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { GetMediaCapabilitiesResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const exec = promisify(execFile);
const capabilities: GetMediaCapabilitiesResponse = {
  capabilities: {
    t2i: { configured: true, providers: ['openai', 'custom-image'] },
    music: { configured: false, providers: [] },
  },
};
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-media-capabilities-cli-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function runCapabilities(args: string[], status = 200) {
  const fetchMock = 'data:text/javascript,' + encodeURIComponent(`
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'http://offline.invalid/api/media/capabilities') throw new Error('Unexpected media endpoint: ' + url);
      if ((init?.method ?? 'GET') !== 'GET') throw new Error('Expected GET');
      if (new Headers(init?.headers).get('authorization') !== 'Bearer test-tool-token') throw new Error('Missing tool token');
      return new Response(${JSON.stringify(JSON.stringify(capabilities))}, { status: ${status}, headers: { 'content-type': 'application/json' } });
    };
  `);
  try {
    const result = await exec(process.execPath, [
      '--import', 'tsx', '--import', fetchMock, cliEntry,
      'media', 'capabilities', '--daemon-url', 'http://offline.invalid/', ...args,
    ], {
      cwd: daemonRoot,
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        PIXO_DATA_DIR: dataDir,
        PIXO_PROJECT_ID: '',
        PIXO_TOOL_TOKEN: 'test-tool-token',
      },
    });
    return { code: 0, ...result };
  } catch (error) {
    if (!error || typeof error !== 'object' || !('stdout' in error) || !('stderr' in error)) throw error;
    return {
      code: 'code' in error ? error.code : undefined,
      stdout: String(error.stdout),
      stderr: String(error.stderr),
    };
  }
}

describe('pixo media capabilities', () => {
  it('returns the shared HTTP readiness response as JSON without requiring a project', async () => {
    const result = await runCapabilities(['--json']);
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toEqual(capabilities);
  });

  it('shows configured provider IDs and missing capabilities in human-readable output', async () => {
    const result = await runCapabilities([]);
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.trim().split('\n')).toEqual([
      't2i: configured (openai, custom-image)',
      'music: not configured',
    ]);
  });

  it('offers help without fetching readiness', async () => {
    const result = await runCapabilities(['--help'], 503);
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('media capabilities [--json]');
  });

  it('fails when the daemon cannot report readiness', async () => {
    const result = await runCapabilities(['--json'], 503);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Media capabilities request failed (503)');
  });
});
