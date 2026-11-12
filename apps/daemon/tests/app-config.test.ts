import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { agentCliEnvForAgent, readAppConfig, readMetricsConsent, writeAppConfig } from '../src/app-config.js';
import { isLocalSameOrigin } from '../src/origin-validation.js';

// The daemon and browser require an explicit telemetry opt-in.
const DEFAULT_TELEMETRY = {
  metrics: false,
} as const;

describe('app-config', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-appconfig-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  describe('strict metrics consent', () => {
    it('distinguishes a missing first-install config from damaged and unreadable preferences', async () => {
      expect(await readMetricsConsent(dataDir)).toEqual({ status: 'missing', metrics: false });
      const file = path.join(dataDir, 'app-config.json');
      await writeAppConfig(dataDir, { telemetry: { metrics: false, } });
      expect(await readMetricsConsent(dataDir)).toEqual({ status: 'available', metrics: false });
      for (const damaged of ['{"telemetry":{"metrics":false}', 'null', '[]', '42', '{"telemetry":null}', '{"telemetry":{"metrics":"true"}}']) {
        await writeFile(file, damaged);
        expect(await readMetricsConsent(dataDir)).toEqual({ status: 'unavailable', metrics: false });
      }
      await rm(file);
      await mkdir(file);
      expect(await readMetricsConsent(dataDir)).toEqual({ status: 'unavailable', metrics: false });
    });

    it('preserves defaults on valid older configs without telemetry', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), '{"onboardingCompleted":true}');
      expect(await readMetricsConsent(dataDir)).toEqual({ status: 'available', metrics: false });
    });
  });

  describe('readAppConfig', () => {
    it('returns default telemetry when config file does not exist', async () => {
      expect(await readAppConfig(dataDir)).toEqual({
        telemetry: DEFAULT_TELEMETRY,
      });
    });

    it('returns parsed config from existing file (with default telemetry)', async () => {
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ onboardingCompleted: true }),
      );
      const cfg = await readAppConfig(dataDir);
      expect(cfg.onboardingCompleted).toBe(true);
      expect(cfg.telemetry).toEqual(DEFAULT_TELEMETRY);
    });

    it('returns default telemetry for corrupted JSON without crashing', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), '{not valid');
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({ telemetry: DEFAULT_TELEMETRY });
    });

    it('returns default telemetry when file contains a JSON array', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), '[1,2,3]');
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({ telemetry: DEFAULT_TELEMETRY });
    });

    it('returns default telemetry when file contains a JSON primitive', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), '"hello"');
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({ telemetry: DEFAULT_TELEMETRY });
    });

    it('filters out unknown keys from stored file', async () => {
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ agentId: 'claude', rogue: 'value', __proto: 'x' }),
      );
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({ agentId: 'claude', telemetry: DEFAULT_TELEMETRY });
      expect(cfg).not.toHaveProperty('rogue');
      expect(cfg).not.toHaveProperty('__proto');
    });

    it('filters out invalid scalar values from stored file', async () => {
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({
          onboardingCompleted: 'yes',
          agentId: 123,
          skillId: { id: 'bad' },
        }),
      );
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({ telemetry: DEFAULT_TELEMETRY });
    });

    it('preserves an explicit telemetry opt-out across reads', async () => {
      // Regression guard: the `applyTelemetryDefaults` helper must only
      // fill in defaults when the saved config has NO telemetry field.
      // A user who explicitly opted out (toggled metrics off in
      // Settings → Privacy) keeps `metrics: false`; we never silently
      // re-enable it on read.
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({
          telemetry: { metrics: false, },
        }),
      );
      const cfg = await readAppConfig(dataDir);
      expect(cfg.telemetry).toEqual({
        metrics: false,
      });
    });

    it('preserves and validates the silent update preference', async () => {
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ allowSilentUpdates: true }),
      );

      expect((await readAppConfig(dataDir)).allowSilentUpdates).toBe(true);
      expect((await writeAppConfig(dataDir, { allowSilentUpdates: false })).allowSilentUpdates).toBe(false);
      expect((await writeAppConfig(dataDir, { allowSilentUpdates: 'yes' })).allowSilentUpdates).toBeUndefined();
    });

    it('preserves a partial explicit telemetry (metrics on, content off)', async () => {
      // The user picked a non-default combo (e.g. metrics on for funnel,
      // content off for privacy). We hand back exactly what they saved
      // — defaults never overwrite explicit per-field choices.
      await writeFile(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ telemetry: { metrics: true, } }),
      );
      const cfg = await readAppConfig(dataDir);
      expect(cfg.telemetry).toEqual({ metrics: true, });
    });












  });

  describe('writeAppConfig', () => {
    it('round-trips the Cocos Creator executable with the other engine paths', async () => {
      await writeAppConfig(dataDir, { gameEnginePaths: { cocosCreator: ' C:\\Cocos\\Creator.exe ', godot: 'godot', unknown: 'bad' } });
      expect((await readAppConfig(dataDir)).gameEnginePaths).toEqual({ cocosCreator: 'C:\\Cocos\\Creator.exe', godot: 'godot' });
      await writeAppConfig(dataDir, { gameEnginePaths: { cocosCreator: 'bad\0path' } });
      expect((await readAppConfig(dataDir)).gameEnginePaths).toEqual({});
    });

    it('persists per-runtime approval modes and drops unsupported values', async () => {
      await writeAppConfig(dataDir, { agentApprovalModes: { claude: 'skip', codex: 'in-app', opencode: 'invalid' } });
      expect((await readAppConfig(dataDir)).agentApprovalModes).toEqual({ claude: 'skip', codex: 'in-app' });
      await writeAppConfig(dataDir, { agentApprovalModes: { claude: 'in-app' } });
      expect((await readAppConfig(dataDir)).agentApprovalModes).toEqual({ claude: 'in-app' });
    });
    it('creates data directory if missing', async () => {
      const nested = path.join(dataDir, 'sub', 'dir');
      await writeAppConfig(nested, { onboardingCompleted: true });
      const cfg = await readAppConfig(nested);
      expect(cfg.onboardingCompleted).toBe(true);
    });

    it('only persists ALLOWED_KEYS, filtering unknown keys', async () => {
      await writeAppConfig(dataDir, {
        onboardingCompleted: true,
        unknownKey: 'should be dropped',
        agentId: 'claude',
      });
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({
        onboardingCompleted: true,
        agentId: 'claude',
        telemetry: DEFAULT_TELEMETRY,
      });
      expect(cfg).not.toHaveProperty('unknownKey');
    });

    it('does not persist invalid scalar values', async () => {
      await writeAppConfig(dataDir, {
        onboardingCompleted: 'yes',
        agentId: 123,
        skillId: false,
      });
      const cfg = await readAppConfig(dataDir);
      expect(cfg).toEqual({ telemetry: DEFAULT_TELEMETRY });
    });

    it('merges with existing config', async () => {
      await writeAppConfig(dataDir, { agentId: 'claude' });
      await writeAppConfig(dataDir, { skillId: 'coder' });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentId).toBe('claude');
      expect(cfg.skillId).toBe('coder');
    });

    it('clears a key when null is sent', async () => {
      await writeAppConfig(dataDir, { agentId: 'claude', skillId: 'coder' });
      await writeAppConfig(dataDir, { agentId: null });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentId).toBeNull();
      expect(cfg.skillId).toBe('coder');
    });

    it('clears agentModels when null is sent', async () => {
      await writeAppConfig(dataDir, {
        agentModels: { a: { model: 'gpt-4' } },
        onboardingCompleted: true,
      });
      expect((await readAppConfig(dataDir)).agentModels).toBeDefined();
      await writeAppConfig(dataDir, { agentModels: null });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentModels).toBeUndefined();
      expect(cfg.onboardingCompleted).toBe(true);
    });

    it('clears agentModels when empty object is sent', async () => {
      await writeAppConfig(dataDir, {
        agentModels: { a: { model: 'gpt-4' } },
      });
      await writeAppConfig(dataDir, { agentModels: {} });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentModels).toBeUndefined();
    });

    it('validates agentModels entries, dropping invalid shapes', async () => {
      await writeAppConfig(dataDir, {
        agentModels: {
          validAgent: { model: 'gpt-4', reasoning: 'fast', serviceTier: 'priority' },
          invalidAgent: 'not-an-object',
          arrayAgent: [1, 2, 3],
          badKeys: { model: 'ok', extra: 42 },
        },
      });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentModels).toEqual({
        validAgent: { model: 'gpt-4', reasoning: 'fast', serviceTier: 'priority' },
      });
    });

    it('drops agentModels entirely when no entries are valid', async () => {
      await writeAppConfig(dataDir, {
        onboardingCompleted: true,
        agentModels: { bad: 'string-value' },
      });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.onboardingCompleted).toBe(true);
      expect(cfg.agentModels).toBeUndefined();
    });

    it('preserves a saved retired runtime id without rewriting its config', async () => {
      const file = path.join(dataDir, 'app-config.json');
      const saved = JSON.stringify({
        agentId: 'gemini',
        agentModels: {
          gemini: { model: 'gemini-2.5-pro' },
          codex: { model: 'gpt-5-codex' },
        },
        agentCliEnv: { gemini: { GEMINI_BIN: '~/bin/gemini' } },
      });
      await writeFile(file, saved);

      const cfg = await readAppConfig(dataDir);

      // Selection resolves this opaque id against available runtimes later.
      expect(cfg.agentId).toBe('gemini');
      expect(cfg.agentModels).toEqual({
        gemini: { model: 'gemini-2.5-pro' },
        codex: { model: 'gpt-5-codex' },
      });
      expect(cfg.agentCliEnv).toBeUndefined();
      expect(await readFile(file, 'utf8')).toBe(saved);
    });

    it('persists supported per-agent CLI env keys and drops everything else', async () => {
      await writeAppConfig(dataDir, {
        agentCliEnv: {
          claude: {
            CLAUDE_CONFIG_DIR: '  ~/.claude-2  ',
            ANTHROPIC_BASE_URL: '  https://proxy.example/anthropic  ',
            ANTHROPIC_API_KEY: '  sk-proxy-anthropic  ',
            ANTHROPIC_AUTH_TOKEN: '  sk-proxy-token  ',
            MMD_MODEL_ROUTES_FILE: '  ~/.config/mms/model-routes.json  ',
          },
          codex: {
            CODEX_HOME: '~/.codex-alt',
            CODEX_BIN: '~/bin/codex-next',
            OPENAI_BASE_URL: '  https://proxy.example/openai  ',
            OPENAI_API_KEY: '  sk-proxy-openai  ',
          },
          opencode: {
            OPENCODE_BIN: '  ~/bin/opencode  ',
          },
          'byok-opencode': {
            OPENCODE_BIN: '  ~/bin/byok-opencode  ',
          },
          __proto__: {
            CLAUDE_CONFIG_DIR: 'bad',
          },
        },
      });

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toEqual({
        claude: { CLAUDE_CONFIG_DIR: '~/.claude-2', ANTHROPIC_BASE_URL: 'https://proxy.example/anthropic', ANTHROPIC_API_KEY: 'sk-proxy-anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-proxy-token', MMD_MODEL_ROUTES_FILE: '~/.config/mms/model-routes.json' },
        codex: { CODEX_HOME: '~/.codex-alt', CODEX_BIN: '~/bin/codex-next', OPENAI_BASE_URL: 'https://proxy.example/openai', OPENAI_API_KEY: 'sk-proxy-openai' },
        opencode: { OPENCODE_BIN: '~/bin/opencode' },
      });
      expect(agentCliEnvForAgent(cfg.agentCliEnv, 'byok-opencode')).toEqual({
        OPENCODE_BIN: '~/bin/opencode',
      });
    });

    it('drops legacy standalone Claude and Codex auth keys without base URLs or CLI intent', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({
        agentCliEnv: {
          claude: {
            CLAUDE_CONFIG_DIR: '~/.claude-2',
            ANTHROPIC_API_KEY: 'sk-legacy-anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-legacy-token',
          },
          codex: {
            CODEX_HOME: '~/.codex-alt',
            CODEX_API_KEY: 'sk-legacy-codex',
            OPENAI_API_KEY: 'sk-legacy-openai',
          },
        },
      }));

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toEqual({
        claude: { CLAUDE_CONFIG_DIR: '~/.claude-2' },
        codex: { CODEX_HOME: '~/.codex-alt' },
      });
      expect(cfg.agentCliEnvIntent).toBeUndefined();
    });

    it('keeps explicit CLI API key overrides without requiring base URLs', async () => {
      await writeAppConfig(dataDir, {
        agentCliEnv: {
          claude: { ANTHROPIC_API_KEY: 'sk-anthropic' },
          codex: { CODEX_API_KEY: 'sk-codex', OPENAI_API_KEY: 'sk-openai' },
        },
        agentCliEnvIntent: {
          claude: { apiKeyOverride: true },
          codex: { apiKeyOverride: true },
        },
      });

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toEqual({
        claude: { ANTHROPIC_API_KEY: 'sk-anthropic' },
        codex: { CODEX_API_KEY: 'sk-codex', OPENAI_API_KEY: 'sk-openai' },
      });
      expect(cfg.agentCliEnvIntent).toEqual({
        claude: { apiKeyOverride: true },
        codex: { apiKeyOverride: true },
      });
    });

    it('infers CLI API key override intent for explicit agentCliEnv writes', async () => {
      await writeAppConfig(dataDir, {
        agentCliEnv: {
          claude: { ANTHROPIC_AUTH_TOKEN: 'sk-anthropic-token' },
          codex: { CODEX_API_KEY: 'sk-codex' },
        },
      });

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toEqual({
        claude: { ANTHROPIC_AUTH_TOKEN: 'sk-anthropic-token' },
        codex: { CODEX_API_KEY: 'sk-codex' },
      });
      expect(cfg.agentCliEnvIntent).toEqual({
        claude: { apiKeyOverride: true },
        codex: { apiKeyOverride: true },
      });
    });

    it('does not infer CLI API key override intent when reading legacy disk config', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({
        agentCliEnv: {
          codex: { CODEX_API_KEY: 'sk-legacy-codex' },
        },
      }));

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toBeUndefined();
      expect(cfg.agentCliEnvIntent).toBeUndefined();
    });

    it('drops orphan CLI env intent entries when the agent env is empty', async () => {
      await writeAppConfig(dataDir, {
        agentCliEnv: {
          claude: { CLAUDE_CONFIG_DIR: '~/.claude-2' },
        },
        agentCliEnvIntent: {
          codex: { apiKeyOverride: true },
        },
      });

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toEqual({
        claude: { CLAUDE_CONFIG_DIR: '~/.claude-2' },
      });
      expect(cfg.agentCliEnvIntent).toBeUndefined();
    });

    it('drops agentCliEnv entries that collide with Object.prototype keys', async () => {
      await writeAppConfig(dataDir, {
        agentCliEnv: {
          toString: {
            CODEX_HOME: '~/.codex-prototype',
          },
          hasOwnProperty: {
            CLAUDE_CONFIG_DIR: '~/.claude-prototype',
          },
          claude: {
            CLAUDE_CONFIG_DIR: '~/.claude-2',
          },
        },
      });

      const cfg = await readAppConfig(dataDir);

      expect(cfg.agentCliEnv).toEqual({
        claude: { CLAUDE_CONFIG_DIR: '~/.claude-2' },
      });
    });

    it('clears agentCliEnv when null or an empty object is sent', async () => {
      await writeAppConfig(dataDir, {
        agentCliEnv: {
          claude: { CLAUDE_CONFIG_DIR: '~/.claude-2' },
        },
        onboardingCompleted: true,
      });
      expect((await readAppConfig(dataDir)).agentCliEnv).toBeDefined();

      await writeAppConfig(dataDir, { agentCliEnv: null });
      let cfg = await readAppConfig(dataDir);
      expect(cfg.agentCliEnv).toBeUndefined();
      expect(cfg.onboardingCompleted).toBe(true);

      await writeAppConfig(dataDir, {
        agentCliEnv: {
          codex: { CODEX_HOME: '~/.codex-alt' },
        },
      });
      await writeAppConfig(dataDir, { agentCliEnv: {} });
      cfg = await readAppConfig(dataDir);
      expect(cfg.agentCliEnv).toBeUndefined();
    });

    it('handles corrupted existing file gracefully on write', async () => {
      await writeFile(path.join(dataDir, 'app-config.json'), 'CORRUPT');
      await writeAppConfig(dataDir, { agentId: 'test' });
      const cfg = await readAppConfig(dataDir);
      expect(cfg.agentId).toBe('test');
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP-layer origin guard
// ---------------------------------------------------------------------------

function httpRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode!, body: data }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('app-config disabled lists', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-disabled-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists disabledSkills as string array', async () => {
    await writeAppConfig(dataDir, { disabledSkills: ['skill-a', 'skill-b'] });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.disabledSkills).toEqual(['skill-a', 'skill-b']);
  });

  it('drops disabledSkills when not a string array', async () => {
    await writeAppConfig(dataDir, { disabledSkills: 'not-array' } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.disabledSkills).toBeUndefined();
  });

  it('drops disabledSkills with non-string elements', async () => {
    await writeAppConfig(dataDir, { disabledSkills: [1, 2, 3] } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.disabledSkills).toBeUndefined();
  });

  it('clears disabledSkills when empty array is sent', async () => {
    await writeAppConfig(dataDir, { disabledSkills: ['a'] });
    await writeAppConfig(dataDir, { disabledSkills: [] });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.disabledSkills).toEqual([]);
  });

  it('keeps the game experience answer, refuses unknown values and clears it with null', async () => {
    await writeAppConfig(dataDir, { gameExperience: 'first' });
    expect((await readAppConfig(dataDir)).gameExperience).toBe('first');
    // An unrelated write leaves it alone; a value outside the list does not replace it.
    await writeAppConfig(dataDir, { onboardingCompleted: true, gameExperience: 'expert' } as any);
    expect((await readAppConfig(dataDir)).gameExperience).toBe('first');
    await writeAppConfig(dataDir, { gameExperience: null });
    expect((await readAppConfig(dataDir)).gameExperience).toBeUndefined();
  });

  it('saves the agent image model under its current id, refuses unknown ones and clears it with auto', async () => {
    await writeAppConfig(dataDir, { agentImageModel: ' codex-image ' });
    expect((await readAppConfig(dataDir)).agentImageModel).toBe('codex-image');
    // An older saved id resolves to the model it became.
    await writeAppConfig(dataDir, { agentImageModel: 'flux-dev-fal' });
    expect((await readAppConfig(dataDir)).agentImageModel).toBe('flux-dev-gateway');
    for (const bad of ['not-a-model', 'openpixo-image-edit', 'doubao-seedance-2-0-260128']) {
      await expect(writeAppConfig(dataDir, { agentImageModel: bad })).rejects.toMatchObject({ code: 'INVALID_APP_CONFIG_VALUE', key: 'agentImageModel' });
    }
    expect((await readAppConfig(dataDir)).agentImageModel).toBe('flux-dev-gateway');
    for (const automatic of ['auto', '', null]) {
      await writeAppConfig(dataDir, { agentImageModel: 'codex-image' });
      await writeAppConfig(dataDir, { agentImageModel: automatic } as any);
      expect((await readAppConfig(dataDir)).agentImageModel).toBeUndefined();
    }
  });

  it('keeps accepting whole-config writes that carry a saved image model this version no longer knows', async () => {
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({ agentImageModel: 'retired-model' }), 'utf8');
    expect((await readAppConfig(dataDir)).agentImageModel).toBe('retired-model');
    // What `pixo config set <other key>` sends: the whole config back, plus one change.
    await writeAppConfig(dataDir, { ...(await readAppConfig(dataDir)), onboardingCompleted: true });
    expect(await readAppConfig(dataDir)).toMatchObject({ agentImageModel: 'retired-model', onboardingCompleted: true });
  });
});

describe('app-config telemetry prefs', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-telemetry-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists installationId as string', async () => {
    await writeAppConfig(dataDir, {
      installationId: '11111111-2222-3333-4444-555555555555',
    });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.installationId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('clears installationId when null is sent', async () => {
    await writeAppConfig(dataDir, { installationId: 'abc' });
    await writeAppConfig(dataDir, { installationId: null });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.installationId).toBeNull();
  });

  it('drops installationId of wrong type', async () => {
    await writeAppConfig(dataDir, { installationId: 12345 } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.installationId).toBeUndefined();
  });

  it('persists privacyDecisionAt as a timestamp', async () => {
    await writeAppConfig(dataDir, { privacyDecisionAt: 1778244000000 });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.privacyDecisionAt).toBe(1778244000000);
  });

  it('clears privacyDecisionAt when null is sent', async () => {
    await writeAppConfig(dataDir, { privacyDecisionAt: 1778244000000 });
    await writeAppConfig(dataDir, { privacyDecisionAt: null });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.privacyDecisionAt).toBeNull();
  });

  it('drops privacyDecisionAt of wrong type', async () => {
    await writeAppConfig(dataDir, { privacyDecisionAt: 'yesterday' } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.privacyDecisionAt).toBeUndefined();
  });

  it('persists full telemetry prefs', async () => {
    await writeAppConfig(dataDir, {
      telemetry: { metrics: true, },
    });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.telemetry).toEqual({
      metrics: true,
    });
  });

  it('persists partial telemetry prefs and omits absent keys', async () => {
    await writeAppConfig(dataDir, { telemetry: { metrics: true } });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.telemetry).toEqual({ metrics: true });
  });

  it('drops telemetry inner values that are not booleans', async () => {
    await writeAppConfig(dataDir, {
      telemetry: {
        metrics: 'yes' as any,
      },
    } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.telemetry).toEqual({ metrics: false });
  });

  it('drops invalid telemetry entirely from the on-disk file (read backfills the default)', async () => {
    // Pre-default era: a bad-shaped `telemetry` write got stripped and
    // `readAppConfig` returned `cfg.telemetry === undefined`. After the
    // 2026-05-22 default-on switch, the same read backfills the
    // default — telemetry is never undefined for callers, but the
    // user's invalid value still didn't make it to disk. The
    // assertion now tracks "what the gate sees" (the default), since
    // that's the actually observable behavior; the write-validation
    // invariant the test was guarding is still in force (nothing of
    // the bad input survives).
    await writeAppConfig(dataDir, {
      onboardingCompleted: true,
      telemetry: { metrics: 'yes' } as any,
    } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.onboardingCompleted).toBe(true);
    expect(cfg.telemetry).toEqual(DEFAULT_TELEMETRY);
  });

  it('drops unknown keys nested inside telemetry', async () => {
    await writeAppConfig(dataDir, {
      telemetry: { metrics: true, rogue: true } as any,
    } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.telemetry).toEqual({ metrics: true });
    expect(cfg.telemetry).not.toHaveProperty('rogue');
  });

  it('drops telemetry when value is not a plain object (read backfills default)', async () => {
    await writeAppConfig(dataDir, { telemetry: [true] } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.telemetry).toEqual(DEFAULT_TELEMETRY);
  });

  it('clearing telemetry by sending null resets to default (read backfills)', async () => {
    // Sending `null` for telemetry erases the on-disk field. Read
    // path then backfills the default because the absence of a value
    // is treated the same as a fresh install. If the user really
    // wants to opt out, the PrivacySection writes
    // `{ metrics: false, content: false, ... }` explicitly — that
    // shape persists and is preserved across reads (see "preserves
    // an explicit telemetry opt-out across reads" above).
    await writeAppConfig(dataDir, {
      telemetry: { metrics: true, },
    });
    await writeAppConfig(dataDir, { telemetry: null } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.telemetry).toEqual(DEFAULT_TELEMETRY);
  });

  it('merges telemetry without disturbing other keys', async () => {
    await writeAppConfig(dataDir, {
      installationId: 'install-1',
      telemetry: { metrics: true },
      agentId: 'claude',
    });
    await writeAppConfig(dataDir, { telemetry: { metrics: false } });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.installationId).toBe('install-1');
    expect(cfg.agentId).toBe('claude');
    // telemetry is replaced (not deep-merged) — matches the agentModels semantics.
    expect(cfg.telemetry).toEqual({ metrics: false });
  });
});

describe('app-config projectLocations', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-projectLocations-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists valid projectLocations and reads them back', async () => {
    const locs = [
      { id: 'ext-one', name: 'One', path: path.join(tmpdir(), 'pixo-loc-one') },
      { id: 'ext-two', name: 'Two', path: path.join(tmpdir(), 'pixo-loc-two') },
    ];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toEqual(locs);
  });

  it('normalizes ~/ paths via expandHomePrefix', async () => {
    const home = homedir();
    const locs = [{ id: 'home-loc', name: 'Home', path: '~/pixo-projects' }];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(1);
    const first = cfg.projectLocations![0]!;
    expect(first.path).toBe(path.join(home, 'pixo-projects'));
    expect(path.isAbsolute(first.path)).toBe(true);
  });

  it('drops relative paths that cannot be resolved to absolute', async () => {
    const locs = [
      { id: 'good', name: 'Good', path: '/tmp/pixo-good' },
      { id: 'bad-relative', name: 'Bad Rel', path: './relative/path' },
    ];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(1);
    const first = cfg.projectLocations![0]!;
    expect(first.id).toBe('good');
  });

  it('drops entries without a string path', async () => {
    const locs = [
      { id: 'good', name: 'Good', path: '/tmp/pixo-good' },
      { id: 'no-path', name: 'No Path' },
    ];
    await writeAppConfig(dataDir, { projectLocations: locs as any });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(1);
    const first = cfg.projectLocations![0]!;
    expect(first.id).toBe('good');
  });

  it('deduplicates paths (case-sensitive on unix)', async () => {
    const locs = [
      { id: 'first', name: 'First', path: '/tmp/pixo-same' },
      { id: 'second', name: 'Second', path: '/tmp/pixo-same' },
    ];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    // Single canonical entry, second deduplicated
    expect(cfg.projectLocations).toHaveLength(1);
    const first = cfg.projectLocations![0]!;
    expect(first.path).toBe(path.normalize('/tmp/pixo-same'));
  });

  it('deduplicates by resolved path after normalization', async () => {
    const locs = [
      { id: 'first', name: 'First', path: '/tmp/pixo-dup/../pixo-dup' },
      { id: 'second', name: 'Second', path: '/tmp/pixo-dup' },
    ];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(1);
    const first = cfg.projectLocations![0]!;
    expect(first.path).toBe(path.normalize('/tmp/pixo-dup'));
  });

  it('rejects reserved id "default" and falls back to auto-generated id', async () => {
    const locs = [{ id: 'default', name: 'Hijack', path: '/tmp/pixo-hijack' }];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(1);
    // The stored id must NOT be 'default'
    const first = cfg.projectLocations![0]!;
    expect(first.id).not.toBe('default');
    // The auto-generated id follows the hash-backed base64url pattern
    expect(first.id).toMatch(/^loc_[A-Za-z0-9_-]{1,16}$/);
    expect(first.path).toBe(path.normalize('/tmp/pixo-hijack'));
  });

  it('generates distinct ids for sibling paths with long shared prefixes', async () => {
    const locs = [
      { path: '/tmp/openpixo-project-locations/shared-prefix-one' },
      { path: '/tmp/openpixo-project-locations/shared-prefix-two' },
    ];
    await writeAppConfig(dataDir, { projectLocations: locs });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(2);
    const ids = cfg.projectLocations!.map((location) => location.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => /^loc_[A-Za-z0-9_-]{1,16}$/.test(id))).toBe(true);
  });

  it('persists a defaultProjectLocationId preference', async () => {
    await writeAppConfig(dataDir, {
      projectLocations: [{ id: 'external-default', name: 'External', path: '/tmp/pixo-default-location' }],
      defaultProjectLocationId: 'external-default',
    });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.defaultProjectLocationId).toBe('external-default');
  });

  it('normalizes invalid defaultProjectLocationId values', async () => {
    await writeAppConfig(dataDir, { defaultProjectLocationId: '../bad' });
    let cfg = await readAppConfig(dataDir);
    expect(cfg.defaultProjectLocationId).toBe('default');

    await writeAppConfig(dataDir, { defaultProjectLocationId: null });
    cfg = await readAppConfig(dataDir);
    expect(cfg.defaultProjectLocationId).toBeNull();
  });

  it('drops invalid scalar projectLocations (not an array)', async () => {
    await writeAppConfig(dataDir, { projectLocations: 'not-array' } as any);
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toBeUndefined();
  });

  it('clears projectLocations when empty array is sent', async () => {
    await writeAppConfig(dataDir, {
      projectLocations: [{ id: 'ext', name: 'ext', path: '/tmp/pixo-ext' }],
      onboardingCompleted: true,
    });
    expect((await readAppConfig(dataDir)).projectLocations).toHaveLength(1);
    await writeAppConfig(dataDir, { projectLocations: [] });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toEqual([]);
    expect(cfg.onboardingCompleted).toBe(true);
  });

  it('clears projectLocations when null is sent', async () => {
    await writeAppConfig(dataDir, {
      projectLocations: [{ id: 'ext', name: 'ext', path: '/tmp/pixo-ext' }],
      onboardingCompleted: true,
    });
    expect((await readAppConfig(dataDir)).projectLocations).toHaveLength(1);
    await writeAppConfig(dataDir, { projectLocations: null as any });
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toBeUndefined();
    expect(cfg.onboardingCompleted).toBe(true);
  });

  it('validates projectLocations on read (filters corrupted stored data)', async () => {
    // Write raw JSON with invalid entries
    await writeFile(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({
        projectLocations: [
          { id: 'good', name: 'Good', path: '/tmp/pixo-good' },
          { id: 'bad-relative', name: 'Bad', path: 'relative' },
          { id: 'no-path', name: 'No Path' },
          'not-an-object',
          null,
          { id: 'good2', name: 'Dup Path', path: '/tmp/pixo-good' },
          { id: 'default', name: 'Reserved', path: '/tmp/pixo-reserved' },
        ],
      }),
    );
    const cfg = await readAppConfig(dataDir);
    expect(cfg.projectLocations).toHaveLength(2);
    const ids = cfg.projectLocations!.map((l) => l.id);
    expect(ids).not.toContain('default');
    expect(ids).not.toContain('bad-relative');
    expect(ids).not.toContain('no-path');
  });
});

describe('app-config recentLinkedDirs', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'pixo-recentdirs-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists a clean list of working directories', async () => {
    const cfg = await writeAppConfig(dataDir, {
      recentLinkedDirs: ['/home/a/project', '/home/b/site'],
    });
    expect(cfg.recentLinkedDirs).toEqual(['/home/a/project', '/home/b/site']);
    expect((await readAppConfig(dataDir)).recentLinkedDirs).toEqual([
      '/home/a/project',
      '/home/b/site',
    ]);
  });

  it('trims, drops empty entries, and de-dupes preserving order', async () => {
    const cfg = await writeAppConfig(dataDir, {
      recentLinkedDirs: ['  /home/a  ', '', '/home/a', '   ', '/home/b'],
    });
    expect(cfg.recentLinkedDirs).toEqual(['/home/a', '/home/b']);
  });

  it('caps the list at RECENT_LINKED_DIRS_MAX entries', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `/home/dir${i}`);
    const cfg = await writeAppConfig(dataDir, { recentLinkedDirs: many });
    expect(cfg.recentLinkedDirs).toEqual(many.slice(0, 5));
  });

  it('ignores a non-array value without touching other prefs', async () => {
    await writeAppConfig(dataDir, { onboardingCompleted: true });
    const cfg = await writeAppConfig(dataDir, {
      recentLinkedDirs: 'not-an-array' as unknown as string[],
    });
    expect(cfg.recentLinkedDirs).toBeUndefined();
    expect(cfg.onboardingCompleted).toBe(true);
  });

  it('updates recentLinkedDirs without clobbering unrelated prefs', async () => {
    await writeAppConfig(dataDir, { skillId: 'keep-me' });
    const cfg = await writeAppConfig(dataDir, {
      recentLinkedDirs: ['/home/a'],
    });
    expect(cfg.recentLinkedDirs).toEqual(['/home/a']);
    expect(cfg.skillId).toBe('keep-me');
  });
});

describe('app-config origin guard', () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        const app = express();
        app.use(express.json());
        app.get('/api/app-config', (req, res) => {
          if (!isLocalSameOrigin(req, port)) {
            return res
              .status(403)
              .json({ error: 'cross-origin request rejected' });
          }
          res.json({ config: {} });
        });
        app.put('/api/app-config', (req, res) => {
          if (!isLocalSameOrigin(req, port)) {
            return res
              .status(403)
              .json({ error: 'cross-origin request rejected' });
          }
          res.json({ config: req.body });
        });
        server = app.listen(0, '127.0.0.1', () => {
          port = (server.address() as { port: number }).port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      }),
  );

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('allows GET from same-origin (no Origin header)', async () => {
    const res = await httpRequest(`${baseUrl}/api/app-config`, {
      headers: { Host: `127.0.0.1:${port}` },
    });
    expect(res.status).toBe(200);
  });

  it('allows PUT from same-origin', async () => {
    const res = await httpRequest(`${baseUrl}/api/app-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects GET with cross-origin Origin header', async () => {
    const res = await httpRequest(`${baseUrl}/api/app-config`, {
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.com',
      },
    });
    expect(res.status).toBe(403);
  });

  it('rejects PUT with cross-origin Origin header', async () => {
    const res = await httpRequest(`${baseUrl}/api/app-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.com',
      },
      body: JSON.stringify({ agentId: 'hacked' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects request with wrong Host header', async () => {
    const res = await httpRequest(`${baseUrl}/api/app-config`, {
      headers: { Host: 'evil.com:9999' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects no-Origin requests that only match configured deployment hosts', async () => {
    process.env.PIXO_ALLOWED_ORIGINS = 'https://pixo.example.com';
    try {
      const res = await httpRequest(`${baseUrl}/api/app-config`, {
        headers: { Host: 'pixo.example.com' },
      });
      expect(res.status).toBe(403);
    } finally {
      delete process.env.PIXO_ALLOWED_ORIGINS;
    }
  });

  it('still rejects non-loopback Origin', async () => {
    const res = await httpRequest(`${baseUrl}/api/app-config`, {
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.com',
      },
    });
    expect(res.status).toBe(403);
  });
});
