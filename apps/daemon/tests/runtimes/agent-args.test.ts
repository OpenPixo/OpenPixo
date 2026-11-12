import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { test } from 'vitest';
import {
  AGENT_DEFS, assert, claude, codex, detectAgents, join, mkdtempSync, opencode, rmSync, spawnEnvForAgent, tmpdir, writeFileSync, chmodSync,
} from './helpers/test-helpers.js';
import { parseOpenCodeModels } from '../../src/runtimes/defs/opencode.js';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import {
  getRememberedLiveModels,
  rememberLiveModels,
} from '../../src/runtimes/models.js';
import type { TestAgentDef } from './helpers/test-helpers.js';

test('opencode args pass model-supported variants without changing the default argv', () => {
  agentCapabilities.delete('opencode');
  const prompt = 'design a dashboard';
  const baseArgs = opencode.buildArgs(prompt, [], [], {});
  assert.equal(opencode.promptViaStdin, true);
  assert.equal(opencode.reasoningOptions, undefined);
  assert.deepEqual(opencode.listModels?.args, ['models', '--verbose']);
  assert.equal(opencode.fallbackModels.find(
    (model) => model.id === 'openai/gpt-5.6-sol',
  )?.reasoningOptions, undefined);
  assert.deepEqual(opencode.helpArgs, ['run', '--help']);
  assert.equal(opencode.capabilityFlags?.['--auto'], 'autoApprove');
  assert.deepEqual(opencode.capabilityFlags?.['--dangerously-skip-permissions'], 'skipPermissions');
  assert.equal(baseArgs.includes('-'), false);
  assert.equal(baseArgs.includes(prompt), false);
  assert.deepEqual(baseArgs, [
    'run',
    '--format',
    'json',
  ]);

  const withModel = opencode.buildArgs(
    prompt,
    [],
    [],
    { model: 'anthropic/claude-sonnet-4-5' },
  );
  assert.deepEqual(withModel, [
    'run',
    '--format',
    'json',
    '-m',
    'anthropic/claude-sonnet-4-5',
  ]);
  assert.deepEqual(opencode.buildArgs(prompt, [], [], {
    model: 'anthropic/claude-sonnet-4-5',
    reasoning: 'high',
  }), withModel);
  assert.deepEqual(opencode.buildArgs(prompt, [], [], {
    model: 'openai/gpt-5.6-sol',
    reasoning: 'default',
  }), [
    'run',
    '--format',
    'json',
    '-m',
    'openai/gpt-5.6-sol',
  ]);
  assert.equal(withModel.includes('--dangerously-skip-permissions'), false);
  assert.equal(withModel.includes('--model'), false);
});

test('opencode parses live verbose variant metadata and only forwards variants advertised for that model', () => {
  const previous = getRememberedLiveModels('opencode');
  const parsed = parseOpenCodeModels([
    'openai/gpt-5.6-sol',
    '{ "variants": { "high": {} } }',
    'openai/gpt-5.6-terra',
    '{ "variants": { "high": {} } }',
    'openai/gpt-5.6-luna',
    '{ "variants": { "max": {} } }',
    'custom/reasoner',
    '{',
    '  "id": "reasoner",',
    '  "variants": {',
    '    "low": { "reasoningEffort": "low" },',
    '    "ultra": { "reasoningEffort": "ultra" }',
    '  }',
    '}',
    'custom/plain',
    '{',
    '  "id": "plain",',
    '  "variants": {}',
    '}',
  ].join('\n'));
  assert.deepEqual(parsed?.find((model) => model.id === 'custom/reasoner')?.reasoningOptions, [
    { id: 'default', label: 'Default' },
    { id: 'low', label: 'low' },
    { id: 'ultra', label: 'ultra' },
  ]);
  assert.equal(parsed?.find((model) => model.id === 'custom/plain')?.reasoningOptions, undefined);

  rememberLiveModels('opencode', parsed ?? []);
  try {
    assert.deepEqual(opencode.buildArgs('', [], [], {
      model: 'openai/gpt-5.6-sol',
      reasoning: 'high',
    }), [
      'run',
      '--format',
      'json',
      '-m',
      'openai/gpt-5.6-sol',
      '--variant',
      'high',
    ]);
    assert.deepEqual(opencode.buildArgs('', [], [], {
      model: 'openai/gpt-5.6-terra',
      reasoning: 'high',
    }), [
      'run',
      '--format',
      'json',
      '-m',
      'openai/gpt-5.6-terra',
      '--variant',
      'high',
    ]);
    assert.deepEqual(opencode.buildArgs('', [], [], {
      model: 'openai/gpt-5.6-luna',
      reasoning: 'max',
    }), [
      'run',
      '--format',
      'json',
      '-m',
      'openai/gpt-5.6-luna',
      '--variant',
      'max',
    ]);
    assert.deepEqual(opencode.buildArgs('', [], [], {
      model: 'custom/reasoner',
      reasoning: 'ultra',
    }), [
      'run',
      '--format',
      'json',
      '-m',
      'custom/reasoner',
      '--variant',
      'ultra',
    ]);
    assert.deepEqual(opencode.buildArgs('', [], [], {
      model: 'custom/plain',
      reasoning: 'ultra',
    }), [
      'run',
      '--format',
      'json',
      '-m',
      'custom/plain',
    ]);
  } finally {
    rememberLiveModels('opencode', previous);
  }
});

test.each([false, true])('opencode prefers --auto when detected (legacy available: %s)', (skipPermissions) => {
  agentCapabilities.set('opencode', { autoApprove: true, skipPermissions });
  try {
    assert.deepEqual(opencode.buildArgs('design a dashboard', [], [], {}), [
      'run',
      '--format',
      'json',
      '--auto',
    ]);
  } finally {
    agentCapabilities.delete('opencode');
  }
});

test('opencode passes --dangerously-skip-permissions when the help probe finds it', () => {
  agentCapabilities.set('opencode', { skipPermissions: true });
  try {
    const args = opencode.buildArgs('design a dashboard', [], [], {});
    assert.deepEqual(args, [
      'run',
      '--format',
      'json',
      '--dangerously-skip-permissions',
    ]);
  } finally {
    agentCapabilities.delete('opencode');
  }
});

test('opencode pins its workspace to the project cwd', () => {
  // OpenCode resolves its project by walking up to the nearest enclosing git
  // root, not by using its process cwd. A managed project directory is not a
  // repository, so a development install (daemon data dir under the checkout)
  // made OpenCode adopt the whole OpenPixo repository as the workspace: it
  // wrote the deliverable at the repository root, the project stayed empty, and
  // the Run reported `no_artifact`.
  const args = opencode.buildArgs('design a dashboard', [], [], {}, { cwd: '/projects/p1' });
  assert.deepEqual(args, ['run', '--format', 'json', '--dir', '/projects/p1']);
});

test('opencode omits --dir for a run with no project directory', () => {
  const args = opencode.buildArgs('design a dashboard', [], [], {}, {});
  assert.equal(args.includes('--dir'), false);
});

const AGY_STREAM_JSON_ARGS = [
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
];

function decodeAgyStdinFrame(stdin: string): unknown {
  assert.ok(stdin.endsWith('\n'), 'agy stream-json input must be newline-terminated');
  const lines = stdin.slice(0, -1).split('\n');
  assert.equal(lines.length, 1, 'the prompt must be exactly one NDJSON message');
  return JSON.parse(lines[0]!);
}

// ---- reasoning-effort clamp ------------------------------------------------
// Drives clampCodexReasoning through the public buildArgs surface so the
// helper stays non-exported. The wire-level `-c model_reasoning_effort="..."`
// flag is what the codex CLI (and ultimately OpenAI) actually sees.

test('codex buildArgs clamps reasoning effort per model', () => {
  const cases: Array<[string | undefined, string, string]> = [
    // [model, reasoning, expected wire-level effort]
    // gpt-5.5 family (and unknown / 'default' which we treat as 5.5):
    // minimal -> low, others pass through.
    [undefined, 'minimal', 'low'],
    ['default', 'minimal', 'low'],
    ['gpt-5.2', 'minimal', 'low'],
    ['gpt-5.3', 'minimal', 'low'],
    ['gpt-5.4', 'minimal', 'low'],
    ['gpt-5.5', 'minimal', 'low'],
    ['gpt-5.5', 'low', 'low'],
    ['gpt-5.5', 'medium', 'medium'],
    ['gpt-5.5', 'high', 'high'],
    ['vendor/gpt-5.5-foo', 'minimal', 'low'], // path-style id
    // gpt-5.1: xhigh isn't supported, others pass through.
    ['gpt-5.1', 'xhigh', 'high'],
    ['gpt-5.1', 'high', 'high'],
    // gpt-5.1-codex-mini: caps at medium / high only.
    ['gpt-5.1-codex-mini', 'minimal', 'medium'],
    ['gpt-5.1-codex-mini', 'low', 'medium'],
    ['gpt-5.1-codex-mini', 'medium', 'medium'],
    ['gpt-5.1-codex-mini', 'high', 'high'],
    ['gpt-5.1-codex-mini', 'xhigh', 'high'],
    // Unknown / future families: pass through; let the API surface its error
    // as the signal a new rule belongs in clampCodexReasoning.
    ['gpt-6', 'minimal', 'minimal'],
  ];
  for (const [model, reasoning, expected] of cases) {
    const args = codex.buildArgs(
      '',
      [],
      [],
      { ...(model === undefined ? {} : { model }), reasoning },
      { cwd: '/tmp/pixo-project' },
    );
    assert.ok(
      args.includes(`model_reasoning_effort="${expected}"`),
      `(model=${model ?? '<none>'}, reasoning=${reasoning}) → expected ${expected}; args=${JSON.stringify(args)}`,
    );
  }
});

test('codex buildArgs omits model_reasoning_effort when reasoning is "default"', () => {
  const args = codex.buildArgs(
    '',
    [],
    [],
    { reasoning: 'default' },
    { cwd: '/tmp/pixo-project' },
  );

  assert.equal(
    args.some(
      (a) => typeof a === 'string' && a.startsWith('model_reasoning_effort='),
    ),
    false,
  );
});

test('claude flags promptViaStdin and never embeds the prompt in argv', () => {
  // Long composed prompts (system prompt + design system + skill body +
  // user message) routinely exceed Linux MAX_ARG_STRLEN (~128 KB) and the
  // Windows CreateProcess command-line cap (~32 KB direct, ~8 KB via .cmd
  // shim). The fix is to deliver the prompt on stdin instead of argv —
  // these assertions guard that contract.
  assert.equal(claude.promptViaStdin, true);

  const longPrompt = 'x'.repeat(200_000);
  const args = claude.buildArgs(
    longPrompt,
    [],
    [],
    {},
    { cwd: '/tmp/pixo-project' },
  );

  assert.ok(Array.isArray(args), 'claude.buildArgs must return argv');
  assert.equal(
    args.includes(longPrompt),
    false,
    'prompt must not appear in argv',
  );
  for (const arg of args) {
    assert.ok(
      typeof arg === 'string' && arg.length < 1000,
      `no argv entry should carry the prompt body (saw length ${arg.length})`,
    );
  }
  // `-p` (print mode) must still be present; without it claude drops into
  // an interactive REPL that the daemon has no TTY for.
  assert.ok(args.includes('-p'), 'claude argv must include -p');
});

test('claude enables native Child behavior frames when advertised without blocking older runtimes', () => {
  assert.equal(
    claude.buildArgs('', [], [], {}, {}).includes('--forward-subagent-text'),
    false,
  );
  assert.equal(
    claude.capabilityFlags?.['--forward-subagent-text'],
    'forwardSubagentText',
  );
  agentCapabilities.set('claude', { forwardSubagentText: true });
  try {
    assert.equal(claude.buildArgs('', [], [], {}, {
      observeNativeChildBehavior: true,
    }).includes('--forward-subagent-text'), true);
  } finally {
    agentCapabilities.delete('claude');
  }
  const argsWithoutForwardText = claude.buildArgs('', [], [], {}, {
    observeNativeChildBehavior: true,
  });
  assert.equal(argsWithoutForwardText.includes('--forward-subagent-text'), false);
  assert.ok(argsWithoutForwardText.includes('--output-format'));
  assert.ok(argsWithoutForwardText.includes('--permission-mode'));
});

// ---- Claude Code --add-dir capability (issue #430) -------------------------
// Skill seeds (`skills/<id>/assets/template.html`) and design-system specs
// (`design-systems/<id>/DESIGN.md`) live outside the project cwd. Without
// `--add-dir`, Claude Code's directory access policy blocks reads on any
// path outside the working directory. Bug was that we probed global `claude
// --help` for `--add-dir` but that flag only appears in `claude -p --help`.

test('claude buildArgs passes --add-dir when dirs are supplied (issue #430, probing-failed baseline)', () => {
  // This is the default state before any capability probe runs: agentCapabilities
  // has no entry -> buildArgs gets `caps = {}` -> caps.addDir is undefined ->
  // undefined !== false -> true. This is also the "probing threw" case: timeout,
  // binary not found, non-zero exit code from --help. Dirs are always passed
  // unless capability probing explicitly detected --help and found no --add-dir.
  const args = claude.buildArgs(
    '',
    [],
    ['/repo/skills', '/repo/design-systems'],
    {},
  );

  const addDirIndex = args.indexOf('--add-dir');
  assert.ok(addDirIndex >= 0, '--add-dir must be present by default (safe baseline)');
  assert.equal(args[addDirIndex + 1], '/repo/skills');
  assert.equal(args[addDirIndex + 2], '/repo/design-systems');
  // Check flag ordering: --add-dir comes before --permission-mode
  const permModeIndex = args.indexOf('--permission-mode');
  assert.ok(
    addDirIndex < permModeIndex,
    `--add-dir (index ${addDirIndex}) should appear before --permission-mode (index ${permModeIndex})`,
  );
});

test('claude buildArgs drops empty / null dirs but keeps valid ones (issue #430 edge case)', () => {
  const args = claude.buildArgs('', [], ['', null, '/repo/skills', undefined] as unknown as string[], {});

  const addDirIndex = args.indexOf('--add-dir');
  assert.ok(addDirIndex >= 0, '--add-dir should survive filter');
  // Only the one valid path survives after --add-dir.
  assert.equal(args[addDirIndex + 1], '/repo/skills');
  // Should NOT have multiple --add-dir flags (one flag, N arguments).
  assert.equal(args.filter((a) => a === '--add-dir').length, 1);
  // Should NOT have null / undefined / '' sneaking into argv.
  assert.equal(args.includes(''), false);
  assert.equal(args.includes(null as unknown as string), false);
  assert.equal(args.includes(undefined as unknown as string), false);
});

test('claude helpArgs probes the -p subcommand where --add-dir lives (issue #430 root cause)', () => {
  assert.deepEqual(
    claude.helpArgs,
    ['-p', '--help'],
    `claude.helpArgs must be ['-p', '--help'], not just ['--help'], because --add-dir lives under the -p subcommand. Probing global help never finds it! Got: ${JSON.stringify(claude.helpArgs)}`,
  );
});

// server.ts:4615 branches on `def.promptInputFormat` to decide how to write
// the composed prompt to a stdin-fed child: 'stream-json' writes one JSONL
// `user` message and keeps stdin open, anything else writes the raw prompt
// and ends stdin. Because server.ts opens with `// @ts-nocheck`, a typo on
// that property (e.g. an undefined `runtimeAdapter.promptInputFormat()`)
// passes typecheck but throws `ReferenceError` at runtime for every chat
// run that goes through the stdin-write path — i.e. every agent below.
// Pin the field shape so a future regression of that contract fails here
// instead of in production.
test('promptInputFormat is a string property (or undefined) on every promptViaStdin agent', () => {
  const stdinAgents = [
    { name: 'claude', def: claude, expected: 'stream-json' },
    { name: 'codex', def: codex, expected: undefined },
    { name: 'opencode', def: opencode, expected: undefined },
  ];
  for (const { name, def, expected } of stdinAgents) {
    assert.equal(
      def.promptViaStdin,
      true,
      `${name} must keep promptViaStdin: true`,
    );
    assert.equal(
      typeof def.promptInputFormat,
      typeof expected,
      `${name}.promptInputFormat must be a ${typeof expected}, not a function — server.ts reads it as a property, not a method call`,
    );
    assert.equal(
      def.promptInputFormat,
      expected,
      `${name}.promptInputFormat must equal ${JSON.stringify(expected)}`,
    );
  }
});
