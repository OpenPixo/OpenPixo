import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { codexAgentDef, withCodexTransport } from '../../src/runtimes/defs/codex.js';
import { CODEX_PROVIDER_AUTH_PROGRAM, CODEX_PROVIDER_KEY_ENV, nativeCodexProviderSupportsVersion, prepareNativeCodexProvider } from '../../src/runtimes/codex-provider.js';

const execute = promisify(execFile);
let dataDir: string | undefined;
afterEach(async () => { if (dataDir) await rm(dataDir, { recursive: true, force: true }); dataDir = undefined; });
const config = { protocol: 'openai' as const, baseUrl: 'https://api.deepseek.com', apiKey: 'provider-fixture-key-A' };
async function prepare(overrides: Partial<Parameters<typeof prepareNativeCodexProvider>[0]> = {}) {
  dataDir ??= await mkdtemp(path.join(os.tmpdir(), 'openpixo-provider-'));
  return prepareNativeCodexProvider({ config, model: 'deepseek-flash', dataDir, nodeExecutable: process.execPath, ...overrides });
}

it('creates credential-free DeepSeek metadata and isolated process configuration on both transports', async () => {
  const prepared = await prepare();
  expect(prepared.env[CODEX_PROVIDER_KEY_ENV]).toBe(config.apiKey);
  expect(prepared.env.OPENAI_API_KEY).toBeUndefined();
  expect(prepared.env.CODEX_API_KEY).toBeUndefined();
  expect(prepared.env.CODEX_HOME).toMatch(/agent-runtime-homes/);
  const catalog = JSON.parse(await readFile(path.join(prepared.env.CODEX_HOME!, 'models.json'), 'utf8')) as { models: Array<Record<string, unknown>> };
  expect(catalog.models.map((entry) => [entry.slug, entry.input_modalities])).toEqual([['deepseek-flash', ['text', 'image']], ['deepseek-v4-pro', ['text']]]);
  expect(catalog.models.every((entry) => entry.supports_reasoning_summary_parameter === false)).toBe(true);
  expect(JSON.stringify(catalog)).not.toContain(config.apiKey);
  expect(await readdir(prepared.env.CODEX_HOME!)).toEqual(['models.json']);
  for (const transport of ['app-server', 'exec-json'] as const) {
    const def = withCodexTransport(codexAgentDef, transport);
    const args = def.buildArgs('fixture', [], [], { model: prepared.model, reasoning: 'max' }, { codexProviderArgs: prepared.configArgs, codexSuppressReasoningSummary: prepared.suppressReasoningSummary });
    expect(args).toContain('model_provider="openpixo_deepseek"');
    expect(args).toContain('model_reasoning_summary="none"');
    expect(args).not.toContain('model_reasoning_summary="detailed"');
    expect(args.join(' ')).not.toContain(config.apiKey);
    const include = args.find((value) => value.startsWith('shell_environment_policy.include_only='))!;
    expect(include).toContain('ELECTRON_RUN_AS_NODE');
    expect(include).not.toContain(CODEX_PROVIDER_KEY_ENV);
    expect(args).toContain('shell_environment_policy.exclude=["OPENPIXO_CODEX_PROVIDER_KEY","OPENAI_API_KEY","CODEX_API_KEY"]');
  }
});

it('binds persistent home and resume identity to provider, endpoint, model and account', async () => {
  const first = await prepare();
  const repeated = await prepare();
  const changedKey = await prepare({ config: { ...config, apiKey: 'provider-fixture-key-B' } });
  const changedModel = await prepare({ model: 'deepseek-v4-pro' });
  const changedProvider = await prepare({ config: { ...config, baseUrl: 'https://openrouter.ai/api/v1' }, model: 'deepseek/deepseek-flash' });
  expect(repeated.env.CODEX_HOME).toBe(first.env.CODEX_HOME);
  expect(repeated.sessionIdentity).toBe(first.sessionIdentity);
  expect(new Set([first, changedKey, changedModel, changedProvider].map((value) => value.sessionIdentity)).size).toBe(4);
  expect(new Set([first, changedKey, changedModel, changedProvider].map((value) => value.env.CODEX_HOME)).size).toBe(4);
  expect(first.sessionIdentity).not.toContain(config.apiKey);
});

it('uses the supported OpenRouter command auth raw-token contract with a fixed executable vector', async () => {
  const prepared = await prepare({ config: { ...config, baseUrl: 'https://openrouter.ai/api/v1' }, model: 'organization/image-model', imagePaths: ['fixture.png'] });
  const provider = prepared.configArgs.find((value) => value.startsWith('model_providers.'))!;
  expect(provider).toContain('auth={command=');
  expect(provider).toContain(JSON.stringify(process.execPath));
  expect(provider).not.toContain('env_key=');
  expect(provider).toContain('requires_openai_auth=false');
  expect(provider).toContain('wire_api="responses"');
  expect(provider).not.toContain(config.apiKey);
  expect(await readdir(prepared.env.CODEX_HOME!)).toEqual([]);
  const { stdout } = await execute(process.execPath, ['-e', CODEX_PROVIDER_AUTH_PROGRAM], { env: { ...process.env, ...prepared.env, ELECTRON_RUN_AS_NODE: '1' } });
  expect(stdout).toBe(config.apiKey);
});

it.each([
  [{ config: { ...config, apiKey: '' } }, 'API key is required'],
  [{ config: { ...config, baseUrl: 'https://example.test/v1' } }, 'canonical DeepSeek'],
  [{ model: 'deepseek-v4-flash' }, 'current model'],
  [{ model: 'deepseek-v4-pro', imagePaths: ['image.png'] }, 'accepts text input'],
  [{ reasoning: 'xhigh' }, 'low, high or max'],
  [{ config: { ...config, baseUrl: 'https://openrouter.ai/api/v1' }, model: 'model-without-organization' }, 'organization/model'],
])('rejects unsupported or incomplete provider input before writing a home: %j', async (overrides, message) => {
  await expect(prepare(overrides)).rejects.toThrow(message);
  expect(await readdir(dataDir!)).toEqual([]);
});

it('requires the actually validated native config generation', () => {
  expect(nativeCodexProviderSupportsVersion('codex-cli 0.160.0')).toBe(true);
  expect(nativeCodexProviderSupportsVersion('codex-cli 0.161.2')).toBe(true);
  expect(nativeCodexProviderSupportsVersion('codex-cli 0.159.9')).toBe(false);
  expect(nativeCodexProviderSupportsVersion(null)).toBe(false);
});
