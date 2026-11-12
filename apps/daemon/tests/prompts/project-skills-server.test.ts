import type { Server } from 'node:http';
import type { ChatRunStatusResponse, CreateProjectResponse, ProjectExtensionsResponse } from '@openpixo/contracts';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';
import { openDatabase } from '../../src/db.js';
import { upsertInstalledPlugin } from '../../src/plugins/registry.js';
import { createSnapshot } from '../../src/plugins/snapshots.js';

type Started = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type Invocation = { argv: string[]; stdin: string; cwd: string };
let started: Started | undefined;
afterEach(async () => {
  await started?.shutdown?.();
  if (started) await new Promise<void>(resolve => started!.server.close(() => resolve()));
  started = undefined;
});

async function json<T = unknown>(url: string, method: string, body: unknown, status = 200): Promise<T> {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json() as Promise<T>;
}

async function fakeClaude(root: string) {
  const script = path.join(root, 'claude-fixture.cjs');
  const log = path.join(root, 'invocations.jsonl');
  await writeFile(script, [
    "const fs = require('node:fs');",
    'const log = ' + JSON.stringify(log) + ';',
    'const argv = process.argv.slice(2);',
    "if (argv.includes('--version')) { console.log('claude-code 2.1.259'); process.exit(0); }",
    "if (argv.includes('--help')) { console.log('--include-partial-messages --add-dir --mcp-config --input-format --output-format'); process.exit(0); }",
    "if (!argv.includes('--session-id') && !argv.includes('--resume')) { console.log('{\"entries\":[]}'); process.exit(0); }",
    "let stdin = ''; let done = false;",
    "function finish() { if (done) return; done = true;",
    "fs.appendFileSync(log, JSON.stringify({ argv, stdin, cwd: process.cwd() }) + '\\n');",
    "console.log(JSON.stringify({ type: 'assistant', message: { id: 't3-message', content: [{ type: 'text', text: 'Done.' }], stop_reason: null } }));",
    "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', result: 'Done.' }) + '\\n', () => process.exit(0)); }",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { stdin += chunk; if (stdin.includes('\\n')) finish(); });",
    "process.stdin.on('end', finish);",
    "process.stdin.on('error', finish);",
  ].join('\n'));
  if (process.platform === 'win32') {
    const bin = path.join(root, 'claude-fixture.cmd');
    await writeFile(bin, '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
    return { bin, log };
  }
  const bin = path.join(root, 'claude-fixture');
  await writeFile(bin, '#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n');
  await chmod(bin, 0o755);
  return { bin, log };
}

describe('default skills on a project nobody configured', () => {
  async function setup(appConfig: Record<string, unknown> = {}) {
    const dataDir = process.env.PIXO_DATA_DIR!;
    const fixtureRoot = path.join(dataDir, 'default-skill-fixtures', randomUUID());
    await mkdir(fixtureRoot, { recursive: true });
    const fake = await fakeClaude(fixtureRoot);
    started = await startServer({ port: 0, returnServer: true }) as Started;
    await json(started.url + '/api/app-config', 'PUT', {
      agentId: 'claude', agentCliEnv: { claude: { CLAUDE_BIN: fake.bin } }, disabledSkills: [],
      agentApprovalModes: { claude: 'skip' }, telemetry: { metrics: false }, privacyDecisionAt: Date.now(), ...appConfig,
    });
    const projectId = 'default-skills-' + randomUUID();
    const projectDir = path.join(dataDir, 'projects', projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'project.godot'), 'config_version=5\n');
    const project = await json<CreateProjectResponse>(started.url + '/api/projects', 'POST', {
      id: projectId, name: 'Default skills', skipDiscoveryBrief: true, metadata: { kind: 'prototype' },
    });
    // The daemon owns the engine: this is the read that records what it detects.
    const engine = await (await fetch(started.url + '/api/projects/' + projectId + '/engine')).json() as { profile: { engine: string } };
    expect(engine.profile.engine).toBe('godot');
    return { dataDir, fake, projectId, conversationId: project.conversationId };
  }

  async function run(context: Awaited<ReturnType<typeof setup>>, request: Record<string, unknown> = {}) {
    const created = await json<{ runId: string }>(started!.url + '/api/runs', 'POST', {
      projectId: context.projectId, conversationId: context.conversationId, agentId: 'claude', sessionMode: 'chat',
      clientRequestId: randomUUID(), message: 'Answer briefly.', currentPrompt: 'Answer briefly.', ...request,
    }, 202);
    await expect.poll(async () => {
      const status = await (await fetch(started!.url + '/api/runs/' + created.runId)).json() as ChatRunStatusResponse;
      if (status.status === 'failed') throw new Error(status.error ?? 'Fixture run failed');
      return status.status;
    }, { timeout: 15_000, interval: 50 }).toBe('succeeded');
    const invocations = (await readFile(context.fake.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Invocation);
    const last = invocations.at(-1)!;
    const frame = JSON.parse(last.stdin.trim().split('\n')[0]!);
    const content = frame.message.content;
    const prompt = typeof content === 'string' ? content : content.map((part: { text?: string }) => part.text ?? '').join('\n');
    const events = await (await fetch(started!.url + '/api/runs/' + created.runId + '/events')).text();
    return { argv: last.argv, cwd: last.cwd, prompt, events };
  }

  it('tells the agent about the skills for its engine, with paths it can read, and no workflow text', async () => {
    const context = await setup();
    const { prompt, cwd, argv } = await run(context);

    expect(prompt).toContain('## Project skills');
    expect(prompt).toContain('"godot-gdscript"');
    expect(prompt).toContain('"player-controller-2d"');
    expect(prompt).not.toContain('"phaser-game-dev"');
    expect(prompt).not.toContain('"unity-csharp"');
    expect(prompt).not.toContain('"agent-browser"');
    expect(prompt).not.toContain('Godot 4 platformer anchor');
    expect(argv.filter(value => value === '--add-dir').length).toBeLessThan(5);

    const staged = /"godot-gdscript"[^\n]*SKILL\.md: ("[^"]+")/.exec(prompt)?.[1];
    expect(staged).toBeTruthy();
    expect(await readFile(path.resolve(cwd, JSON.parse(staged!)), 'utf8')).toContain('name: godot-gdscript');
    expect(await readFile(path.join(cwd, '.pixo-skills', '.gitignore'), 'utf8')).toBe('*\n');
  }, 30_000);

  it('does not report them as used, and lists them for the project', async () => {
    const context = await setup();
    const { events } = await run(context);
    expect(events).not.toContain('skills_loaded');

    const listed = await (await fetch(started!.url + '/api/projects/' + context.projectId + '/extensions')).json() as ProjectExtensionsResponse;
    const ids = listed.defaultSkills!.map(skill => skill.id);
    expect(ids).toContain('godot-gdscript');
    expect(ids).not.toContain('phaser-game-dev');
    expect(listed.skills).toEqual([]);
  }, 30_000);

  it('honors the Settings switch', async () => {
    const context = await setup({ disabledSkills: ['godot-gdscript'] });
    const { prompt } = await run(context);
    expect(prompt).not.toContain('"godot-gdscript"');
    expect(prompt).toContain('"player-controller-2d"');
  }, 30_000);

  it('reports a skill the user picked for the turn as used, and does not list it twice', async () => {
    const context = await setup();
    const { prompt, events } = await run(context, { skillIds: ['game-feel-juice'] });
    expect(events).toMatch(/skills_loaded[^\n]*game-feel-juice/);
    expect(prompt).not.toContain('"game-feel-juice"');
    expect(prompt).toContain('"player-controller-2d"');
  }, 30_000);
});

describe('server project skill composition', () => {
  it('stages enabled files, sends only their index, preserves explicit selections and adds literal matches per turn', async () => {
    const dataDir = process.env.PIXO_DATA_DIR!;
    const skillId = 't3-fixture-' + randomUUID();
    const skillDir = path.join(dataDir, 'skills', skillId);
    const fixtureRoot = path.join(dataDir, 't3-fixtures', randomUUID());
    await mkdir(path.join(skillDir, 'references'), { recursive: true });
    await mkdir(fixtureRoot, { recursive: true });
    const body = 'T3_PRIVATE_WORKFLOW_START\nRead references/details.md before editing sprites.\nT3_PRIVATE_WORKFLOW_END';
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: ' + skillId + '\ndescription: Preserve game sprites.\ntriggers:\n  - "T3_LITERAL_TRIGGER"\npixo:\n  mode: utility\n---\n' + body);
    await writeFile(path.join(skillDir, 'references', 'details.md'), 'T3_COMPANION_FILE');
    const fake = await fakeClaude(fixtureRoot);
    started = await startServer({ port: 0, returnServer: true }) as Started;
    await json(started.url + '/api/app-config', 'PUT', {
      agentId: 'claude', agentCliEnv: { claude: { CLAUDE_BIN: fake.bin } },
      agentApprovalModes: { claude: 'skip' }, telemetry: { metrics: false }, privacyDecisionAt: Date.now(),
    });
    const projectId = 't3-project-' + randomUUID();
    await mkdir(path.join(dataDir, 'projects', projectId), { recursive: true });
    const project = await json<CreateProjectResponse>(started.url + '/api/projects', 'POST', {
      id: projectId, name: 'T3 skills fixture', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true,
    });
    const extensions = await json<ProjectExtensionsResponse>(started.url + '/api/projects/' + projectId + '/extensions', 'POST', { kind: 'skill', catalogId: skillId }, 201);
    expect(extensions.skills[0]!.contextCost).toMatchObject({ indexBytes: expect.any(Number), onDemandBytes: expect.any(Number) });

    const pluginDir = path.join(fixtureRoot, 'plugin');
    await mkdir(pluginDir);
    const pluginId = 't3-plugin-' + randomUUID();
    const pluginBody = 'T3_PLUGIN_PRIVATE_WORKFLOW_START\nKeep all plugin rules.\nT3_PLUGIN_PRIVATE_WORKFLOW_END';
    await writeFile(path.join(pluginDir, 'SKILL.md'), '---\nname: ' + pluginId + '\ndescription: A selected plugin.\n---\n' + pluginBody);
    const db = openDatabase(dataDir, { dataDir });
    upsertInstalledPlugin(db, {
      id: pluginId, title: 'Selected plugin', version: '1.0.0', sourceKind: 'local', source: pluginDir,
      trust: 'trusted', capabilitiesGranted: ['prompt:inject'], fsPath: pluginDir, installedAt: Date.now(), updatedAt: Date.now(),
      manifest: { name: pluginId, version: '1.0.0', pixo: { kind: 'skill', context: { skills: [{ path: './SKILL.md' }] } } },
    });
    const snapshot = createSnapshot(db, {
      projectId, pluginId, pluginVersion: '1.0.0', manifestSourceDigest: 't3-fixture',
      taskKind: 'new-generation', inputs: {}, resolvedContext: { items: [] },
      capabilitiesGranted: ['prompt:inject'], capabilitiesRequired: [], assetsStaged: [], mcpServers: [],
    });
    const requests = [
      { message: 'Earlier transcript mentioned T3_LITERAL_TRIGGER.', currentPrompt: 'Answer briefly.' },
      { message: 'Answer briefly.', currentPrompt: 'Answer briefly.', skillId },
      { message: 'Answer briefly.', currentPrompt: 'Answer briefly.', skillIds: [skillId] },
      { message: 'T3_LITERAL_TRIGGER', currentPrompt: 'T3_LITERAL_TRIGGER' },
      { message: 'Answer briefly.', currentPrompt: 'Answer briefly.', appliedPluginSnapshotId: snapshot.snapshotId },
    ];
    for (const request of requests) {
      const created = await json<{ runId: string }>(started.url + '/api/runs', 'POST', {
        projectId, conversationId: project.conversationId, agentId: 'claude', sessionMode: 'chat',
        clientRequestId: randomUUID(), ...request,
      }, 202);
      await expect.poll(async () => {
        const response = await fetch(started!.url + '/api/runs/' + created.runId);
        const run = await response.json() as ChatRunStatusResponse;
        if (run.status === 'failed') throw new Error(run.error ?? 'Fixture run failed');
        return run.status;
      }, { timeout: 15_000, interval: 50 }).toBe('succeeded');
    }
    const invocations = (await readFile(fake.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Invocation);
    expect(invocations).toHaveLength(5);
    const prompts = invocations.map(value => {
      const frame = JSON.parse(value.stdin.trim().split('\n')[0]!);
      const content = frame.message.content;
      const text = typeof content === 'string' ? content : content.map((part: { text?: string }) => part.text ?? '').join('\n');
      return value.argv.join('\n') + '\n' + text;
    });
    expect(prompts[0]).toContain('## Project skills');
    expect(prompts[0]).not.toContain('T3_PRIVATE_WORKFLOW_START');
    for (const prompt of prompts.slice(1, 4)) {
      expect(prompt).toContain('T3_PRIVATE_WORKFLOW_START');
      expect(prompt).toContain('T3_PRIVATE_WORKFLOW_END');
    }
    expect(prompts[4]).toContain(pluginBody);
    const stagedPath = /SKILL\.md: ("[^"]+")/.exec(prompts[0]!)?.[1];
    expect(stagedPath).toBeTruthy();
    const file = path.resolve(invocations[0]!.cwd, JSON.parse(stagedPath!));
    expect(await readFile(file, 'utf8')).toContain(body);
    expect(await readFile(path.join(path.dirname(file), 'references', 'details.md'), 'utf8')).toBe('T3_COMPANION_FILE');
  }, 30_000);
});
