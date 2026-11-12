import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ByokChatProviderConfig, CodexApprovalRequest } from '@openpixo/contracts';
import { expect, test } from 'vitest';
import { createPcmWav } from '@/openpixo-fixture';
import { requestJson } from '@/vitest/http';
import { cancelRun, readRun, startRun } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/suite';

type LiveProvider = 'codex' | 'deepseek' | 'openrouter';
const providerGates = { codex: 'OPENPIXO_LIVE_CODEX', deepseek: 'OPENPIXO_LIVE_DEEPSEEK', openrouter: 'OPENPIXO_LIVE_OPENROUTER' } as const;

function selectedLiveProvider(env: NodeJS.ProcessEnv): LiveProvider | null {
  if (env.CI) return null;
  const selected = env.OPENPIXO_LIVE_PROVIDER ?? 'codex';
  if (selected !== 'codex' && selected !== 'deepseek' && selected !== 'openrouter') {
    if (Object.values(providerGates).some(gate => env[gate] === '1')) throw new Error('OPENPIXO_LIVE_PROVIDER must be codex, deepseek or openrouter.');
    return null;
  }
  return env[providerGates[selected]] === '1' ? selected : null;
}

function liveProviderConfig(provider: LiveProvider, env: NodeJS.ProcessEnv): { model: string; secret: string | null; snapshot?: ByokChatProviderConfig } {
  if (provider === 'codex') return { model: env.OPENPIXO_LIVE_CODEX_MODEL?.trim() || 'default', secret: null };
  const prefix = `OPENPIXO_LIVE_${provider.toUpperCase()}`;
  const secret = env[`${prefix}_API_KEY`]?.trim();
  const model = env[`${prefix}_MODEL`]?.trim();
  if (!secret || !model || model === 'default') throw new Error(`Set ${prefix}_API_KEY and an explicit ${prefix}_MODEL before enabling this provider's live task.`);
  return { model, secret, snapshot: { protocol: 'openai', baseUrl: provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://openrouter.ai/api/v1', apiKey: secret, model } };
}

function scrub(text: string, secret: string | null): string {
  if (!secret) return text;
  return text.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]').split(secret).join('[REDACTED]');
}

function scrubValue(value: unknown, secret: string | null): unknown {
  if (typeof value === 'string') return scrub(value, secret);
  if (Array.isArray(value)) return value.map(item => scrubValue(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key, secret), scrubValue(item, secret)]));
  return value;
}

function nativeFrames(events: string): Array<Record<string, unknown>> {
  return events.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)) as Record<string, unknown>);
}

function completedNativeChildren(events: string): Array<{ threadId: string; parentThreadId: string }> {
  const frames = nativeFrames(events);
  const completedTools = new Set(frames.filter(frame => frame.type === 'tool_result' && frame.isError !== true).map(frame => frame.toolUseId));
  const children = new Map<string, { threadId: string; parentThreadId: string }>();
  for (const frame of frames) {
    const input = frame.input as Record<string, unknown> | undefined;
    if (frame.type !== 'tool_use' || frame.name !== 'Task' || !input || input.status !== 'completed' || !completedTools.has(frame.id)) continue;
    if (typeof input.threadId !== 'string' || !input.threadId || typeof input.parentThreadId !== 'string' || !input.parentThreadId || input.threadId === input.parentThreadId) continue;
    children.set(input.threadId, { threadId: input.threadId, parentThreadId: input.parentThreadId });
  }
  return [...children.values()];
}

const selectedProvider = selectedLiveProvider(process.env);

function pcm(file: Buffer): number[] {
  expect(file.toString('ascii', 0, 4)).toBe('RIFF');
  expect(file.toString('ascii', 8, 12)).toBe('WAVE');
  let formatSeen = false;
  for (let offset = 12; offset + 8 <= file.length;) {
    const size = file.readUInt32LE(offset + 4);
    const start = offset + 8;
    expect(start + size).toBeLessThanOrEqual(file.length);
    if (file.toString('ascii', offset, offset + 4) === 'fmt ') {
      expect(file.readUInt16LE(start)).toBe(1);
      expect(file.readUInt16LE(start + 2)).toBe(1);
      expect(file.readUInt32LE(start + 4)).toBe(8000);
      expect(file.readUInt16LE(start + 14)).toBe(16);
      formatSeen = true;
    }
    if (file.toString('ascii', offset, offset + 4) === 'data') {
      expect(formatSeen).toBe(true);
      return Array.from({ length: size / 2 }, (_, index) => file.readInt16LE(start + index * 2));
    }
    offset = start + size + (size % 2);
  }
  throw new Error('WAV data chunk missing');
}

function inside(root: string, file: string): boolean {
  const path = relative(root, resolve(root, file));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function scopedApproval(approval: CodexApprovalRequest, root: string, command: string, node: string, script: string, ffmpeg: string): boolean {
  if (approval.availableDecisions && !approval.availableDecisions.includes('accept')) return false;
  if (approval.cwd && resolve(approval.cwd) !== root) return false;
  if (approval.paths.some(file => !inside(root, file))) return false;
  if (approval.details) {
    const details = JSON.parse(approval.details) as { permissions?: { network?: { enabled?: boolean }; fileSystem?: { read?: string[]; write?: string[] } }; additionalPermissions?: unknown; networkApprovalContext?: unknown };
    if (details.networkApprovalContext || details.additionalPermissions || details.permissions?.network?.enabled) return false;
    if (details.permissions) {
      const permissions = details.permissions;
      if (Object.keys(permissions).some(key => key !== 'network' && key !== 'fileSystem')) return false;
      if (permissions.network && Object.keys(permissions.network).some(key => key !== 'enabled')) return false;
      if (!permissions.fileSystem || Object.keys(permissions.fileSystem).some(key => key !== 'read' && key !== 'write')) return false;
      const allowedRead = new Set([node, script, ffmpeg]);
      return (permissions.fileSystem.read ?? []).every(file => inside(root, file) || allowedRead.has(resolve(file)))
        && (permissions.fileSystem.write ?? []).every(file => inside(root, file));
    }
  }
  if (!approval.command && ['item/fileChange/requestApproval', 'applyPatchApproval'].includes(approval.method)) {
    const reviewedCode = join(root, 'derived/live-volume/verified-player.ts');
    return approval.paths.length > 0 && approval.paths.every(file => resolve(root, file) === reviewedCode);
  }
  if (approval.command === command) return true;
  if (!approval.command) return false;
  let vector: unknown;
  try { vector = JSON.parse(approval.command); } catch { return false; }
  if (!Array.isArray(vector) || vector.some(item => typeof item !== 'string')) return false;
  if (vector.length === 3 && vector[0] === node && vector[1] === script && vector[2] === ffmpeg) return true;
  const executable = basename(String(vector[0])).toLowerCase();
  const commandIndex = vector.findIndex(item => item === '-Command' || item === '-c');
  return ['powershell.exe', 'pwsh.exe', 'powershell', 'pwsh'].includes(executable)
    && commandIndex === vector.length - 2
    && vector.slice(1, commandIndex).every(item => ['-NoProfile', '-NonInteractive', '-NoLogo'].includes(item))
    && vector.at(-1) === command;
}

test('[P0] live acceptance grants only exact fixture commands and confined filesystem profiles', () => {
  const root = resolve('fixture-game');
  const node = resolve('toolchain', 'node.exe');
  const script = join(root, 'run-audio-batch.ts');
  const ffmpeg = resolve('toolchain', 'ffmpeg.exe');
  const command = `& '${node}' '${script}' '${ffmpeg}'`;
  const request: CodexApprovalRequest = { requestId: 'fixture', method: 'item/commandExecution/requestApproval',
    threadId: 'thread', turnId: 'turn', itemId: 'tool', reason: null, command, cwd: root, paths: [] };
  const allowed = (patch: Partial<CodexApprovalRequest>) => scopedApproval({ ...request, ...patch }, root, command, node, script, ffmpeg);
  expect(allowed({})).toBe(true);
  expect(allowed({ command: `${command}; Remove-Item -Recurse C:\\Users` })).toBe(false);
  expect(allowed({ cwd: resolve('other-game') })).toBe(false);
  expect(allowed({ paths: ['../outside.txt'] })).toBe(false);
  expect(allowed({ method: 'item/fileChange/requestApproval', command: null, paths: ['derived/live-volume/verified-player.ts'] })).toBe(true);
  expect(allowed({ method: 'applyPatchApproval', command: null, paths: ['game.ts'] })).toBe(false);
  expect(allowed({ method: 'item/fileChange/requestApproval', command: null, paths: [] })).toBe(false);
  expect(allowed({ details: JSON.stringify({ permissions: { fileSystem: { read: [node], write: [root] } } }) })).toBe(true);
  expect(allowed({ details: JSON.stringify({ permissions: { fileSystem: { write: [resolve('outside')] } } }) })).toBe(false);
  expect(allowed({ details: JSON.stringify({ permissions: { network: { enabled: true }, fileSystem: { write: [root] } } }) })).toBe(false);
  expect(allowed({ details: JSON.stringify({ networkApprovalContext: { host: 'example.com' } }) })).toBe(false);
});

test('[P0] live provider gates stay separate and require explicit third-party configuration', () => {
  expect(selectedLiveProvider({})).toBe(null);
  expect(selectedLiveProvider({ OPENPIXO_LIVE_CODEX: '1' })).toBe('codex');
  expect(selectedLiveProvider({ OPENPIXO_LIVE_CODEX: '1', OPENPIXO_LIVE_PROVIDER: 'deepseek' })).toBe(null);
  expect(selectedLiveProvider({ OPENPIXO_LIVE_CODEX: '1', OPENPIXO_LIVE_PROVIDER: 'openrouter' })).toBe(null);
  expect(selectedLiveProvider({ OPENPIXO_LIVE_PROVIDER: 'deepseek', OPENPIXO_LIVE_DEEPSEEK: '1' })).toBe('deepseek');
  expect(selectedLiveProvider({ OPENPIXO_LIVE_PROVIDER: 'openrouter', OPENPIXO_LIVE_OPENROUTER: '1' })).toBe('openrouter');
  expect(selectedLiveProvider({ CI: '1', OPENPIXO_LIVE_PROVIDER: 'deepseek', OPENPIXO_LIVE_DEEPSEEK: '1' })).toBe(null);
  expect(() => selectedLiveProvider({ OPENPIXO_LIVE_PROVIDER: 'unknown', OPENPIXO_LIVE_CODEX: '1' })).toThrow('must be codex, deepseek or openrouter');
  expect(() => liveProviderConfig('deepseek', {})).toThrow('OPENPIXO_LIVE_DEEPSEEK_API_KEY');
  expect(() => liveProviderConfig('openrouter', { OPENPIXO_LIVE_OPENROUTER_API_KEY: 'offline-fixture-secret' })).toThrow('OPENPIXO_LIVE_OPENROUTER_MODEL');
  const configured = liveProviderConfig('deepseek', { OPENPIXO_LIVE_DEEPSEEK_API_KEY: 'offline-fixture-secret', OPENPIXO_LIVE_DEEPSEEK_MODEL: 'deepseek-flash' });
  expect(configured.snapshot?.baseUrl).toBe('https://api.deepseek.com');
  expect(configured.model).toBe('deepseek-flash');
});

test('[P0] live evidence scrubs credentials and requires a completed native child with its parent', () => {
  const secret = 'offline-"credential"-sentinel';
  const safe = JSON.stringify(scrubValue({ message: `provider rejected ${secret}`, nested: [JSON.stringify({ secret })] }, secret));
  expect(safe.includes(secret)).toBe(false);
  expect(safe.includes(JSON.stringify(secret).slice(1, -1))).toBe(false);
  expect(safe).toContain('[REDACTED]');
  const task = { type: 'tool_use', id: 'native-child', name: 'Task', input: { status: 'completed', threadId: 'child', parentThreadId: 'parent' } };
  const result = { type: 'tool_result', toolUseId: 'native-child', isError: false };
  const sse = (frames: unknown[]) => frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('');
  expect(completedNativeChildren(sse([task, result]))).toEqual([{ threadId: 'child', parentThreadId: 'parent' }]);
  expect(completedNativeChildren(sse([{ type: 'text_delta', delta: JSON.stringify(task) }, result]))).toEqual([]);
  expect(completedNativeChildren(sse([{ ...task, input: { ...task.input, status: 'running' } }, result]))).toEqual([]);
  expect(completedNativeChildren(sse([{ ...task, input: { ...task.input, parentThreadId: '' } }, result]))).toEqual([]);
  expect(completedNativeChildren(sse([task, { ...result, isError: true }]))).toEqual([]);
});

test('[P0] reviewed live batch helper really attenuates audio and preserves originals', async () => {
  const suite = await createSmokeSuite('openpixo-batch-helper');
  const root = join(suite.scratchDir, 'game');
  await mkdir(join(root, 'audio'), { recursive: true });
  await writeFile(join(root, 'project.godot'), 'OpenPixo live acceptance fixture');
  const input = createPcmWav(Array.from({ length: 800 }, (_, index) => index % 2 ? 12000 : -12000));
  await Promise.all(['one.wav', 'two.wav'].map(name => writeFile(join(root, 'audio', name), input)));
  const script = join(root, 'run-audio-batch.ts');
  await copyFile(fileURLToPath(new URL('../../resources/openpixo-audio-batch.ts', import.meta.url)), script);
  const ffmpeg = (createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg') as { path: string }).path;
  let success = false;
  try {
    expect(execFileSync(process.execPath, [script, ffmpeg], { cwd: root, encoding: 'utf8' })).toContain('OPENPIXO_BATCH_OK');
    for (const name of ['one.wav', 'two.wav']) {
      expect(await readFile(join(root, 'audio', name))).toEqual(input);
      expect(pcm(await readFile(join(root, 'derived', 'live-volume', 'audio', name))))
        .toEqual(pcm(input).map(sample => sample / 2));
    }
    await suite.report.save('batch-report.json', await readFile(join(root, 'derived', 'live-volume', 'report-live.json')));
    success = true;
  } finally { await suite.finalize({ success }); }
});

test.skipIf(!selectedProvider)(`[P1] live native ${selectedProvider ?? 'codex'} uses project skill and MCP and transforms real audio`, async () => {
  const provider = selectedProvider!;
  // Read only the selected provider's dedicated credential after its own gate.
  const providerConfig = liveProviderConfig(provider, process.env);
  const safeError = (error: unknown) => new Error(scrub(error instanceof Error ? error.message : String(error), providerConfig.secret));
  const suite = await createSmokeSuite(`openpixo-live-${provider}`);
  const writeReportJson = suite.report.json;
  suite.report.json = (name, value) => writeReportJson(name, scrubValue(value, providerConfig.secret));
  const root = join(suite.scratchDir, 'live-game');
  const audioRoot = join(root, 'audio');
  await mkdir(audioRoot, { recursive: true });
  await writeFile(join(root, 'project.godot'), '[application]\nconfig/name="OpenPixo live acceptance fixture"\n');
  await writeFile(join(root, 'game.ts'), 'export const playerSpeed = 120;\n');
  const samples = Array.from({ length: 800 }, (_, index) => Math.round(Math.sin(index / 16 * Math.PI) * 12000));
  const originals = [createPcmWav(samples), createPcmWav(samples.map(value => -value))];
  const names = ['one.wav', 'two.wav'];
  await Promise.all(names.map((name, index) => writeFile(join(audioRoot, name), originals[index]!)));
  const node = await realpath(process.execPath);
  const script = join(root, 'run-audio-batch.ts');
  await copyFile(fileURLToPath(new URL('../../resources/openpixo-audio-batch.ts', import.meta.url)), script);
  const ffmpeg = await realpath((createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg') as { path: string }).path);
  const skillSource = fileURLToPath(new URL('../../../skills/game-assets-batch', import.meta.url));
  const mcpScript = fileURLToPath(new URL('../../resources/openpixo-mcp.ts', import.meta.url));
  const mcpReceipt = join(suite.scratchDir, 'mcp-calls.txt');
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const command = `& ${quote(node)} ${quote(script)} ${quote(ffmpeg)}`;
  const approvalReceipts: Array<{ request: CodexApprovalRequest; decision: string }> = [];
  let runId: string | null = null;
  let baseUrl = '';
  await suite.with.toolsDev(async ({ runtime }) => {
    try {
    baseUrl = `http://127.0.0.1:${runtime.daemonPort}`;
    const nativeBin = process.env.OPENPIXO_CODEX_BIN ?? process.env.PIXO_E2E_CODEX_BIN;
    await requestJson(baseUrl, '/api/app-config', { method: 'PUT', body: {
      agentId: 'codex', onboardingCompleted: true, privacyDecisionAt: Date.now(), skillId: null,
      agentModels: { codex: { model: providerConfig.model, reasoning: 'low' } },
      agentCliEnv: { codex: { ...(provider === 'codex' ? { CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex') } : {}), ...(nativeBin ? { CODEX_BIN: nativeBin } : {}) } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
    } });
    const imported = await requestJson<{ project: { id: string }; conversationId: string }>(baseUrl, '/api/import/folder', { body: { baseDir: root, name: 'OpenPixo live acceptance game' } });
    const projectPath = `/api/projects/${imported.project.id}`;
    await requestJson(baseUrl, `${projectPath}/extensions`, { body: { kind: 'skill', source: skillSource } });
    await requestJson(baseUrl, `${projectPath}/extensions`, { body: { kind: 'mcp', server: {
      id: 'acceptance-ping', transport: 'stdio', command: node, args: [mcpScript], env: { OPENPIXO_MCP_RECEIPT: mcpReceipt }, enabled: true,
    } } });
    const childInstruction = provider === 'codex'
      ? 'Ask exactly one real read-only child agent to inspect game.ts and report playerSpeed, then wait for its completed result. This native Codex acceptance requires that child; do not simulate it or replace it with your own inspection.'
      : 'If spawn_agent is available, ask exactly one read-only child to inspect game.ts and report playerSpeed, then wait for it. If unavailable, state that explicitly and inspect game.ts yourself.';
    const message = `This is one bounded OpenPixo live acceptance task in the current disposable game folder.
Read the enabled game-assets-batch skill and follow its preservation/reporting rules. Call the real project MCP tool openpixo_ping and quote its result.
${childInstruction}
The two selected inputs are audio/one.wav and audio/two.wav. Required operation: multiply amplitude by exactly 0.5, WAV PCM s16le, 8000 Hz, mono. Preserve both originals.
A reviewed fixture helper run-audio-batch.ts implements this operation using the existing bundled FFmpeg, probes its real version, hashes originals and writes a per-input report. Read the helper; do not modify it. Invoke exactly this PowerShell command (or the same three-element argument vector in another shell):
${command}
Outputs must be derived/live-volume/audio/one.wav, derived/live-volume/audio/two.wav and derived/live-volume/report-live.json.
After the batch helper finishes, use the native file-edit tool to create derived/live-volume/verified-player.ts. Write exactly one TypeScript line, export const verifiedPlayerSpeed = VALUE;, replacing VALUE with the numeric playerSpeed actually inspected in game.ts. Do not modify game.ts or the reviewed helper.
Do not install tools, access the network, alter global settings, overwrite existing files or modify game.ts. Finish with MCP marker, actual skill name, playerSpeed from game.ts, actual child result or unavailability, and links to derived files/report.`;
    const request = { projectId: imported.project.id, conversationId: imported.conversationId,
      agentId: 'codex', assistantMessageId: randomUUID(), userMessageId: randomUUID(), clientRequestId: randomUUID(),
      model: providerConfig.model, reasoning: 'low', message, ...(providerConfig.snapshot ? { byokProvider: providerConfig.snapshot } : {}) };
    const started = await startRun(baseUrl, request);
    runId = started.runId;
    let finalStatus = '';
    // The bounded poll observes a real external process and approval requests;
    // a virtual clock cannot advance native Codex or local FFmpeg execution.
    await expect.poll(async () => {
      const state = await readRun(baseUrl, started.runId);
      if (state.status === 'running' || state.status === 'queued') {
        const pending = await requestJson<{ approvals: CodexApprovalRequest[] }>(baseUrl, `/api/runs/${started.runId}/approvals`);
        for (const request of pending.approvals) {
          const allowed = scopedApproval(request, root, command, node, script, ffmpeg);
          approvalReceipts.push({ request, decision: allowed ? 'accept' : 'cancel' });
          await suite.report.json('approvals.json', approvalReceipts);
          await requestJson(baseUrl, `/api/runs/${started.runId}/approvals/${request.requestId}`, { body: { decision: allowed ? 'accept' : 'cancel' } });
          if (!allowed) throw new Error(`Live acceptance refused an unscoped approval: ${scrub(JSON.stringify(request), providerConfig.secret)}`);
        }
      }
      finalStatus = state.status;
      return state.status === 'running' || state.status === 'queued' ? 'active' : state.status;
    }, { timeout: 300_000, interval: 500 }).not.toBe('active');
    expect(finalStatus).toBe('succeeded');
    const response = await fetch(`${baseUrl}/api/runs/${started.runId}/events`, { signal: AbortSignal.timeout(10_000) });
    expect(response.ok).toBe(true);
    const rawEvents = await response.text();
    const events = scrub(rawEvents, providerConfig.secret);
    await suite.report.save('native-events.sse', events);
    const credentialDisclosed = providerConfig.secret ? rawEvents.includes(providerConfig.secret) || rawEvents.includes(JSON.stringify(providerConfig.secret).slice(1, -1)) : false;
    expect(credentialDisclosed, 'native output must not disclose the selected provider credential').toBe(false);
    expect(await readFile(mcpReceipt, 'utf8')).toContain('openpixo_ping');
    expect(events).toContain('OPENPIXO_MCP_OK');
    expect(events).toContain('game-assets-batch');
    expect(events).toContain('OPENPIXO_BATCH_OK');
    const assistantText = nativeFrames(events).filter(frame => frame.type === 'text_delta').map(frame => typeof frame.delta === 'string' ? frame.delta : '').join('');
    expect(assistantText).toMatch(/playerSpeed[\s\S]{0,80}\b120\b/);
    expect(await readFile(join(root, 'game.ts'), 'utf8')).toBe('export const playerSpeed = 120;\n');
    expect((await readFile(join(root, 'derived/live-volume/verified-player.ts'), 'utf8')).trim()).toBe('export const verifiedPlayerSpeed = 120;');
    const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
    for (const [index, name] of names.entries()) {
      expect(sha(await readFile(join(audioRoot, name)))).toBe(sha(originals[index]!));
      const processed = await readFile(join(root, 'derived', 'live-volume', 'audio', name));
      const actual = pcm(processed);
      const input = pcm(originals[index]!);
      expect(actual).toHaveLength(input.length);
      expect(Math.max(...actual.map((value, sample) => Math.abs(value - input[sample]! / 2)))).toBeLessThanOrEqual(2);
      await suite.report.save(`derived/${name}`, processed);
    }
    const manifestBytes = await readFile(join(root, 'derived', 'live-volume', 'report-live.json'));
    const manifest = JSON.parse(manifestBytes.toString()) as { skill: string; results: Array<{ source: string; status: string; originalPreserved: boolean }> };
    expect(manifest.skill).toBe('game-assets-batch');
    expect(manifest.results).toHaveLength(2);
    expect(manifest.results.every(result => result.status === 'succeeded' && result.originalPreserved)).toBe(true);
    const files = await requestJson<{ files: Array<{ name: string }> }>(baseUrl, `${projectPath}/files`);
    expect(files.files.map(file => file.name)).toEqual(expect.arrayContaining(names.map(name => `derived/live-volume/audio/${name}`)));
    expect(files.files.some(file => file.name === 'derived/live-volume/verified-player.ts')).toBe(true);
    const children = completedNativeChildren(events);
    await suite.report.save('batch-report.json', manifestBytes);
    await suite.report.json('live-result.json', { provider, model: providerConfig.model, runtime: 'codex/app-server',
      projectId: imported.project.id, runId: started.runId, finalStatus, mcpToolCalled: true, skillUsed: 'game-assets-batch',
      codeInspected: 'game.ts', codeWritten: 'derived/live-volume/verified-player.ts', originalsPreserved: true, transformedInputs: names, actualChildEvidence: children.length > 0,
      completedChildren: children, childRequirement: provider === 'codex' ? 'required' : 'observed-only',
      imageInput: 'not-exercised', imageGeneration: 'not-exercised', approvals: approvalReceipts });
    if (provider === 'codex') expect(children.length, 'default native Codex must complete a real child task with distinct parent and child thread IDs').toBeGreaterThan(0);
    } catch (error) { throw safeError(error); }
  }, {
    env: { PIXO_CODEX_TRANSPORT: 'app-server', },
    onFailure: async () => {
      try {
      if (!runId || !baseUrl) return;
      const state = await readRun(baseUrl, runId);
      await suite.report.json('failure/live-run.json', { provider, model: providerConfig.model, state, approvals: approvalReceipts });
      if (state.status === 'running' || state.status === 'queued') await cancelRun(baseUrl, runId);
      } catch (error) { throw safeError(error); }
    },
  });
}, 420_000);
