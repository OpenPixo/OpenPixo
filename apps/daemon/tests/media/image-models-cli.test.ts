import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AgentImageModelsResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// `pixo media image-models` lists what the Settings select and the composer chip
// list, from the same endpoint; `pixo config set agentImageModel` writes the same pref.
const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const exec = promisify(execFile);
const list: AgentImageModelsResponse = {
  selected: 'gpt-image-2',
  automatic: 'codex-image',
  options: [
    { id: 'codex-image', label: 'codex-image', provider: 'codex-cli', providerLabel: 'Codex (ChatGPT sign-in)', hosted: false, available: true },
    { id: 'gpt-image-2', label: 'gpt-image-2', provider: 'openai', providerLabel: 'OpenAI', hosted: false, available: true },
  ],
};
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-image-models-cli-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function runCli(args: string[]) {
  const fetchMock = 'data:text/javascript,' + encodeURIComponent(`
    globalThis.fetch = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (String(url) === 'http://offline.invalid/api/media/agent-image-models' && method === 'GET') {
        return new Response(${JSON.stringify(JSON.stringify(list))}, { status: 200 });
      }
      if (String(url) === 'http://offline.invalid/api/app-config' && method === 'GET') {
        return new Response(JSON.stringify({ config: { onboardingCompleted: true } }), { status: 200 });
      }
      if (String(url) === 'http://offline.invalid/api/app-config' && method === 'PUT') {
        process.stderr.write('PUT ' + init.body + '\\n');
        return new Response(JSON.stringify({ config: JSON.parse(init.body) }), { status: 200 });
      }
      throw new Error('Unexpected endpoint: ' + method + ' ' + url);
    };
  `);
  const result = await exec(process.execPath, ['--import', 'tsx', '--import', fetchMock, cliEntry, ...args, '--daemon-url', 'http://offline.invalid/'], {
    cwd: daemonRoot,
    timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: '', PIXO_DATA_DIR: dataDir, PIXO_PROJECT_ID: '', FAL_KEY: '', PIXO_FAL_KEY: '' },
  });
  return result;
}

describe('pixo media image-models', () => {
  it('prints the shared list as JSON', async () => {
    const result = await runCli(['media', 'image-models', '--json']);
    expect(JSON.parse(result.stdout)).toEqual(list);
  });

  it('marks the pick and says how to change it', async () => {
    const result = await runCli(['media', 'image-models']);
    expect(result.stdout).toContain('selected: gpt-image-2');
    expect(result.stdout).toContain('* gpt-image-2  gpt-image-2 · OpenAI');
    expect(result.stdout).toContain('config set agentImageModel <id|auto>');
  });

  it('config set agentImageModel writes the top-level pref', async () => {
    const result = await runCli(['config', 'set', 'agentImageModel', 'codex-image']);
    expect(result.stdout).toContain('[config] set agentImageModel');
    expect(result.stderr).toContain('"agentImageModel":"codex-image"');
  });
});
