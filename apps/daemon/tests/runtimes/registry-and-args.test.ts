import { test } from 'vitest';
import {
  AGENT_DEFS, assert, chmodSync, claude, codex, detectAgents, join, mkdtempSync, rmSync, tmpdir, withEnvSnapshot, withPlatform, writeFileSync,
} from './helpers/test-helpers.js';
import { codexNeedsDangerFullAccessSandbox } from '../../src/runtimes/defs/codex.js';
import { isKnownServiceTier } from '../../src/runtimes/models.js';
import { getAgentDef } from '../../src/runtimes/registry.js';

const windowsFixtureTest = process.platform === 'win32' ? test.skip : test;

test('AGENT_DEFS ids are unique', () => {
  const ids = AGENT_DEFS.map((a) => a.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate agent ids: ${JSON.stringify(dupes)}`);
});

test('retired saved runtime ids resolve to the normal no-agent state', () => {
  for (const id of [
    'aider', 'amp', 'antigravity', 'atomcode', 'codebuddy', 'copilot',
    'cursor-agent', 'deepseek', 'deepseek-harness', 'devin', 'gemini',
    'grok-build', 'hermes', 'kilo', 'kimi', 'kiro', 'mimo', 'pi',
    'qoder', 'qwen', 'reasonix', 'trae-cli', 'vibe',
  ]) {
    assert.equal(getAgentDef(id), null, id);
  }
});

test('codex args disable plugins when PIXO_CODEX_DISABLE_PLUGINS is 1', () => {
  withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX'], () => {
    process.env.PIXO_CODEX_DISABLE_PLUGINS = '1';
    delete process.env.PIXO_CODEX_SANDBOX;

    withPlatform('darwin', () => {
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });

      assert.deepEqual(args.slice(0, 9), [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true',
        '--disable',
        'plugins',
      ]);
    });
  });
});

test('codex args disable plugins for an externally attributed Local Codex run', () => {
  withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX'], () => {
    delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
    delete process.env.PIXO_CODEX_SANDBOX;

    withPlatform('darwin', () => {
      const args = codex.buildArgs('', [], [], {}, {
        cwd: '/tmp/pixo-project',
        disablePlugins: true,
      });

      assert.deepEqual(args.slice(0, 9), [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true',
        '--disable',
        'plugins',
      ]);
    });
  });
});

test('codex args use workspace-write sandbox on macOS and Linux', () => {
  withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX', 'WSL_DISTRO_NAME'], () => {
    delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
    delete process.env.PIXO_CODEX_SANDBOX;

    for (const platform of ['darwin', 'linux'] as const) {
      withPlatform(platform, () => {
        delete process.env.WSL_DISTRO_NAME;
        const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });
        assert.equal(args.includes('--full-auto'), false);
        assert.deepEqual(args.slice(0, 5), [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--sandbox',
          'workspace-write',
        ]);
        assert.equal(
          args.includes('-c'),
          true,
        );
        assert.equal(args.some((arg) => arg.includes('default_permissions')), false);
      });
    }
  });
});

test('codex keeps workspace-write as the default sandbox on WSL', () => {
  withPlatform('linux', () => {
    withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX', 'WSL_DISTRO_NAME'], () => {
      delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
      delete process.env.PIXO_CODEX_SANDBOX;
      process.env.WSL_DISTRO_NAME = 'Ubuntu';
      assert.equal(codexNeedsDangerFullAccessSandbox('linux', process.env), false);
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });
      assert.deepEqual(args.slice(0, 5), [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
      ]);
      assert.equal(args.some((arg) => arg.includes('default_permissions')), false);
    });
  });
});

test('codex args allow PIXO_CODEX_SANDBOX danger-full-access override on Linux', () => {
  withPlatform('linux', () => {
    withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX', 'WSL_DISTRO_NAME'], () => {
      delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
      process.env.PIXO_CODEX_SANDBOX = 'danger-full-access';
      delete process.env.WSL_DISTRO_NAME;

      assert.equal(codexNeedsDangerFullAccessSandbox('linux', process.env), true);
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });
      assert.deepEqual(args.slice(0, 5), [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'danger-full-access',
      ]);
      assert.equal(
        args.includes('sandbox_workspace_write.network_access=true'),
        false,
      );
    });
  });
});

test('codex args ignore unknown PIXO_CODEX_SANDBOX values', () => {
  withPlatform('linux', () => {
    withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX', 'WSL_DISTRO_NAME'], () => {
      delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
      process.env.PIXO_CODEX_SANDBOX = 'workspace-write';
      delete process.env.WSL_DISTRO_NAME;

      assert.equal(codexNeedsDangerFullAccessSandbox('linux', process.env), false);
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });
      assert.deepEqual(args.slice(0, 5), [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
      ]);
    });
  });
});

test('codex keeps workspace-write as the default sandbox on Windows', () => {
  // Platform detection never widens the default sandbox.
  withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX'], () => {
    delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
    delete process.env.PIXO_CODEX_SANDBOX;

    withPlatform('win32', () => {
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });

      assert.deepEqual(args.slice(0, 5), [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
      ]);

      assert.equal(args.includes('workspace-write'), true);
      assert.equal(
        args.includes('sandbox_workspace_write.network_access=true'),
        true,
      );
      assert.equal(args.some((arg) => arg.includes('default_permissions')), false);
    });
  });
});

test('codex args keep plugins enabled when PIXO_CODEX_DISABLE_PLUGINS is unset', () => {
  withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX'], () => {
    delete process.env.PIXO_CODEX_DISABLE_PLUGINS;
    delete process.env.PIXO_CODEX_SANDBOX;

    withPlatform('darwin', () => {
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });

      assert.equal(args.includes('--disable'), false);
      assert.equal(args.includes('plugins'), false);
    });
  });
});

test('codex args keep plugins enabled when PIXO_CODEX_DISABLE_PLUGINS is not 1', () => {
  withEnvSnapshot(['PIXO_CODEX_DISABLE_PLUGINS', 'PIXO_CODEX_SANDBOX'], () => {
    process.env.PIXO_CODEX_DISABLE_PLUGINS = 'true';
    delete process.env.PIXO_CODEX_SANDBOX;

    withPlatform('darwin', () => {
      const args = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });

      assert.equal(args.includes('--disable'), false);
      assert.equal(args.includes('plugins'), false);
    });
  });
});

windowsFixtureTest('codex model picker includes current OpenAI choices in priority order', async () => {
  const expectedModels = [
    'default',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.1',
    'gpt-5.1-codex-mini',
    'gpt-5-codex',
    'gpt-5',
    'o3',
    'o4-mini',
  ];

  assert.deepEqual(codex.fallbackModels.map((m) => m.id), expectedModels);
  assert.deepEqual(
    codex.fallbackModels.find((m) => m.id === 'gpt-5.5')?.serviceTierOptions,
    [{ id: 'priority', label: 'Fast' }],
  );
  assert.ok(codex.reasoningOptions, 'codex must define reasoningOptions');
  assert.deepEqual(codex.reasoningOptions.map((o) => o.id), [
    'default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ]);

  const args = codex.buildArgs(
    '',
    [],
    [],
    { model: 'gpt-5.5', reasoning: 'xhigh' },
    { cwd: '/tmp/pixo-project' },
  );
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('gpt-5.5'));
  assert.ok(args.includes('model_reasoning_effort="xhigh"'));

  const fastArgs = codex.buildArgs(
    '',
    [],
    [],
    { model: 'gpt-5.5', serviceTier: 'priority' },
    { cwd: '/tmp/pixo-project' },
  );
  assert.ok(fastArgs.includes('service_tier="priority"'));

  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-codex-models-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      const codexBin = join(dir, 'codex');
      writeFileSync(
        codexBin,
        '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex 1.0.0"; exit 0; fi\nexit 0\n',
      );
      chmodSync(codexBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      delete process.env.CODEX_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'codex');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.version, 'codex 1.0.0');
      assert.deepEqual(detected.models.map((m: { id: string }) => m.id), expectedModels);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('codex derives service tiers from live speed tiers when service_tiers is absent', () => {
  assert.ok(codex.listModels, 'codex must define live model discovery');
  const parsed = codex.listModels.parse(JSON.stringify({
    models: [
      {
        slug: 'gpt-5.5',
        display_name: 'GPT 5.5',
        visibility: 'list',
        additional_speed_tiers: ['fast'],
      },
    ],
  }));

  assert.deepEqual(parsed, [
    { id: 'default', label: 'Default (CLI config)' },
    {
      id: 'gpt-5.5',
      label: 'GPT 5.5',
      additionalSpeedTiers: ['fast'],
      serviceTierOptions: [{ id: 'priority', label: 'Fast' }],
    },
  ]);
});

test('codex preserves explicit live service tiers from debug models JSON', () => {
  assert.ok(codex.listModels, 'codex must define live model discovery');
  const parsed = codex.listModels.parse(JSON.stringify({
    models: [
      {
        slug: 'gpt-6-codex',
        display_name: 'GPT-6 Codex',
        visibility: 'list',
        service_tiers: [
          { id: 'priority', name: 'Fast' },
          { id: 'standard', name: 'Standard' },
        ],
      },
    ],
  }));

  assert.deepEqual(parsed, [
    { id: 'default', label: 'Default (CLI config)' },
    {
      id: 'gpt-6-codex',
      label: 'GPT-6 Codex',
      serviceTierOptions: [
        { id: 'priority', label: 'Fast' },
        { id: 'standard', label: 'Standard' },
      ],
    },
  ]);
});

test('codex live model metadata falls back to static service tiers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-codex-live-tier-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      const codexBin = join(dir, 'codex');
      writeFileSync(
        codexBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\\n' '{"models":[{"slug":"gpt-5.5","display_name":"GPT 5.5","visibility":"list"}]}'
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
exit 2
`,
      );
      chmodSync(codexBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      delete process.env.CODEX_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'codex');
      const model = detected?.models.find((m: { id: string }) => m.id === 'gpt-5.5');

      assert.deepEqual(model?.serviceTierOptions, [{ id: 'priority', label: 'Fast' }]);
      assert.equal(isKnownServiceTier(codex, 'gpt-5.5', 'priority'), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

windowsFixtureTest('claude probes auth status so rescans reflect CLI auth changes', async () => {
  assert.deepEqual(claude.authProbe, {
    args: ['auth', 'status'],
    timeoutMs: 5000,
  });

  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-claude-auth-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CLAUDE_BIN'], async () => {
      const claudeBin = join(dir, 'claude');
      writeFileSync(
        claudeBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.168 (Claude Code)"; exit 0; fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then echo "--include-partial-messages --add-dir"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"authenticated":true,"source":"claude.ai"}'; exit 0; fi
exit 0
`,
      );
      chmodSync(claudeBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      delete process.env.CLAUDE_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'claude');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.authStatus, 'ok');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

windowsFixtureTest('claude API key env satisfies auth probe without requiring local login', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-claude-api-key-auth-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CLAUDE_BIN', 'ANTHROPIC_API_KEY'], async () => {
      const claudeBin = join(dir, 'claude');
      writeFileSync(
        claudeBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.168 (Claude Code)"; exit 0; fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then echo "--include-partial-messages --add-dir"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"authenticated":false}'; exit 1; fi
exit 0
`,
      );
      chmodSync(claudeBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      process.env.ANTHROPIC_API_KEY = 'sk-anthropic';
      delete process.env.CLAUDE_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'claude');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.authStatus, 'ok');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

windowsFixtureTest('codex probes login status so rescans reflect CLI auth changes', async () => {
  assert.deepEqual(codex.authProbe, {
    args: ['login', 'status'],
    timeoutMs: 5000,
  });

  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-codex-auth-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      const codexBin = join(dir, 'codex');
      writeFileSync(
        codexBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
exit 0
`,
      );
      chmodSync(codexBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      delete process.env.CODEX_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'codex');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.authStatus, 'ok');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

windowsFixtureTest('codex API key env satisfies auth probe without requiring local login', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-codex-api-key-auth-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN', 'CODEX_API_KEY'], async () => {
      const codexBin = join(dir, 'codex');
      writeFileSync(
        codexBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then echo '{"models":[]}'; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Not logged in"; exit 1; fi
exit 0
`,
      );
      chmodSync(codexBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      process.env.CODEX_API_KEY = 'sk-codex';
      delete process.env.CODEX_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'codex');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.authStatus, 'ok');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('codex parses live model catalog from debug models JSON', () => {
  assert.ok(codex.listModels, 'codex must define live model discovery');
  const parsed = codex.listModels.parse(JSON.stringify({
    models: [
      {
        slug: 'gpt-6-codex',
        display_name: 'GPT-6 Codex',
        visibility: 'list',
      },
      {
        slug: 'gpt-6-codex-mini',
        display_name: 'GPT-6 Codex Mini',
        visibility: 'list',
      },
      {
        slug: 'gpt-hidden-internal',
        display_name: 'Hidden internal',
        visibility: 'hidden',
      },
    ],
  }));

  assert.deepEqual(parsed, [
    { id: 'default', label: 'Default (CLI config)' },
    { id: 'gpt-6-codex', label: 'GPT-6 Codex' },
    { id: 'gpt-6-codex-mini', label: 'GPT-6 Codex Mini' },
  ]);
});

test('codex derives service tiers from live speed tiers when service_tiers is absent', () => {
  assert.ok(codex.listModels, 'codex must define live model discovery');
  const parsed = codex.listModels.parse(JSON.stringify({
    models: [
      {
        slug: 'gpt-5.5',
        display_name: 'GPT-5.5',
        visibility: 'list',
        additional_speed_tiers: ['fast'],
      },
    ],
  }));

  assert.deepEqual(parsed, [
    { id: 'default', label: 'Default (CLI config)' },
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      additionalSpeedTiers: ['fast'],
      serviceTierOptions: [{ id: 'priority', label: 'Fast' }],
    },
  ]);
});

test('codex preserves explicit live service tiers from debug models JSON', () => {
  assert.ok(codex.listModels, 'codex must define live model discovery');
  const parsed = codex.listModels.parse(JSON.stringify({
    models: [
      {
        slug: 'gpt-6-codex',
        display_name: 'GPT-6 Codex',
        visibility: 'list',
        service_tiers: [
          { id: 'priority', name: 'Fast' },
          { id: 'standard', name: 'Standard' },
        ],
      },
    ],
  }));

  assert.deepEqual(parsed, [
    { id: 'default', label: 'Default (CLI config)' },
    {
      id: 'gpt-6-codex',
      label: 'GPT-6 Codex',
      serviceTierOptions: [
        { id: 'priority', label: 'Fast' },
        { id: 'standard', label: 'Standard' },
      ],
    },
  ]);
});

test('codex preserves service tier labels from bare-array debug models JSON', () => {
  assert.ok(codex.listModels, 'codex must define live model discovery');
  const parsed = codex.listModels.parse(JSON.stringify([
    {
      slug: 'gpt-5.5',
      display_name: 'GPT-5.5',
      visibility: 'list',
      service_tiers: [{ id: 'priority', label: 'Fast' }],
    },
  ]));

  assert.deepEqual(parsed, [
    { id: 'default', label: 'Default (CLI config)' },
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      serviceTierOptions: [{ id: 'priority', label: 'Fast' }],
    },
  ]);
});

windowsFixtureTest('codex detection surfaces live debug models separately from fallback models', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-codex-live-models-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      const codexBin = join(dir, 'codex');
      writeFileSync(
        codexBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\\n' '{"models":[{"slug":"gpt-6-codex","display_name":"GPT-6 Codex","visibility":"list"}]}'
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
exit 2
`,
      );
      chmodSync(codexBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      delete process.env.CODEX_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'codex');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.modelsSource, 'live');
      assert.deepEqual(detected.models.map((m: { id: string }) => m.id), [
        'default',
        'gpt-6-codex',
      ]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

windowsFixtureTest('codex detection enriches sparse live GPT-5.5 metadata from fallback tiers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixo-agents-codex-sparse-live-models-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      const codexBin = join(dir, 'codex');
      writeFileSync(
        codexBin,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\\n' '{"models":[{"slug":"gpt-5.5","display_name":"GPT-5.5","visibility":"list"}]}'
  exit 0
fi
exit 2
`,
      );
      chmodSync(codexBin, 0o755);
      process.env.PIXO_AGENT_HOME = dir;
      process.env.PATH = dir;
      delete process.env.CODEX_BIN;

      const agents = await detectAgents();
      const detected = agents.find((agent) => agent.id === 'codex');
      const gpt55 = detected?.models.find((model) => model.id === 'gpt-5.5');

      assert.ok(detected);
      assert.equal(detected.available, true);
      assert.equal(detected.modelsSource, 'live');
      assert.deepEqual(gpt55, {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        additionalSpeedTiers: ['fast'],
        serviceTierOptions: [{ id: 'priority', label: 'Fast' }],
      });
      assert.equal(isKnownServiceTier(codex, 'gpt-5.5', 'priority'), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('codex picker includes gpt-5.1 model family', () => {
  const pickerModels = new Set(codex.fallbackModels.map((model) => model.id));

  assert.equal(pickerModels.has('gpt-5.1'), true);
  assert.equal(pickerModels.has('gpt-5.1-codex-mini'), true);
});

// Recent Codex CLI versions reject a bare `-` argv sentinel; passing it
// alongside the stdin pipe causes `error: unexpected argument '-' found`
// and exit code 2 before any prompt is read. We deliver the prompt via
// stdin pipe alone (gated by `promptViaStdin: true`). Regression of #237.
test('codex args do not include the literal `-` stdin sentinel (regression of #237)', () => {
  delete process.env.PIXO_CODEX_DISABLE_PLUGINS;

  const baseArgs = codex.buildArgs('', [], [], {}, { cwd: '/tmp/pixo-project' });
  assert.equal(baseArgs.includes('-'), false);

  const withModel = codex.buildArgs(
    '',
    [],
    [],
    { model: 'gpt-5-codex' },
    { cwd: '/tmp/pixo-project' },
  );
  assert.equal(withModel.includes('-'), false);

  const withReasoning = codex.buildArgs(
    '',
    [],
    [],
    { reasoning: 'high' },
    { cwd: '/tmp/pixo-project' },
  );
  assert.equal(withReasoning.includes('-'), false);

  process.env.PIXO_CODEX_DISABLE_PLUGINS = '1';
  const withDisablePlugins = codex.buildArgs(
    '',
    [],
    [],
    {},
    { cwd: '/tmp/pixo-project' },
  );
  assert.equal(withDisablePlugins.includes('-'), false);
});

test('codex args pass valid extraAllowedDirs with repeatable --add-dir flags', () => {
  delete process.env.PIXO_CODEX_DISABLE_PLUGINS;

  const args = codex.buildArgs(
    '',
    [],
    ['/repo/skills', '', null, '/tmp/codex/generated_images', undefined] as unknown as string[],
    {},
    { cwd: '/tmp/pixo-project' },
  );

  assert.deepEqual(
    args.filter((arg, index) => arg === '--add-dir' || args[index - 1] === '--add-dir'),
    ['--add-dir', '/repo/skills', '--add-dir', '/tmp/codex/generated_images'],
  );
});
