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

async function runCapabilities(args: string[], status = 200, options: { body?: GetMediaCapabilitiesResponse; url?: string; projectId?: string } = {}) {
  const body = options.body ?? capabilities;
  const expectedUrl = options.url ?? 'http://offline.invalid/api/media/capabilities';
  const fetchMock = 'data:text/javascript,' + encodeURIComponent(`
    globalThis.fetch = async (url, init) => {
      if (String(url) !== ${JSON.stringify(expectedUrl)}) throw new Error('Unexpected media endpoint: ' + url);
      if ((init?.method ?? 'GET') !== 'GET') throw new Error('Expected GET');
      if (new Headers(init?.headers).get('authorization') !== 'Bearer test-tool-token') throw new Error('Missing tool token');
      return new Response(${JSON.stringify(JSON.stringify(body))}, { status: ${status}, headers: { 'content-type': 'application/json' } });
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
        PIXO_PROJECT_ID: options.projectId ?? '',
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

  // C11: credits are a way to make a kind, so the line says so instead of "not configured".
  it('shows hosted kinds on credits and the project art budget', async () => {
    const body: GetMediaCapabilitiesResponse = {
      capabilities: {
        t2i: { configured: true, providers: ['codex-cli'], hosted: { paidWith: 'credits', services: ['openpixo-image'] } },
        'i2v-loop': { configured: false, providers: [], hosted: { paidWith: 'credits', services: ['openpixo-walk-video'], recipesOnly: true } },
        t2v: { configured: false, providers: [] },
      },
      hosted: { paidWith: 'credits', artBudget: { state: 'set', limitCredits: 200, remainingCredits: 150, mode: 'ask' } },
    };
    const result = await runCapabilities([], 200, { body, projectId: 'game-1', url: 'http://offline.invalid/api/media/capabilities?projectId=game-1' });
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.trim().split('\n')).toEqual([
      't2i: configured (codex-cli); also on credits (openpixo-image)',
      'i2v-loop: on credits (openpixo-walk-video, through recipes only)',
      't2v: not configured',
      'art budget: 150 of 200 credits left, mode ask (spend only what the user approves on an art card)',
    ]);
  });

  it('says when the art budget still has to be set by the user', async () => {
    const body: GetMediaCapabilitiesResponse = {
      capabilities: { 'i2v-loop': { configured: false, providers: [], hosted: { paidWith: 'credits', services: ['openpixo-walk-video'], recipesOnly: true } } },
      hosted: { paidWith: 'credits', artBudget: { state: 'unset', mode: 'ask' } },
    };
    const result = await runCapabilities(['--project', 'game-1'], 200, { body, url: 'http://offline.invalid/api/media/capabilities?projectId=game-1' });
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.trim().split('\n').at(-1)).toBe('art budget: not set; only the user can set one, above the message box');
  });

  it('offers help without fetching readiness', async () => {
    const result = await runCapabilities(['--help'], 503);
    expect(result, result.stderr).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('media capabilities [--project <id>] [--json]');
  });

  it('fails when the daemon cannot report readiness', async () => {
    const result = await runCapabilities(['--json'], 503);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Media capabilities request failed (503)');
  });
});
