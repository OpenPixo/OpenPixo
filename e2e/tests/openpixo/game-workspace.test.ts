import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createOpenPixoCodex, createOpenPixoGame } from '@/openpixo-fixture';
import { T } from '@/timeouts';
import { requestJson } from '@/vitest/http';
import { listMessages } from '@/vitest/messages';
import { cancelRun, readRun, readRunEvents, startRun, waitForRunStatus, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/suite';

type ImportedProject = { project: { id: string; metadata: { baseDir: string } }; conversationId: string };
type Approval = { requestId: string; threadId: string; turnId: string; command: string };
type FileList = { files: Array<{ name: string; localPath?: string }> };
type Receipt = { event: string; pid: number; threadId: string; turnId: string; method?: string; params?: Record<string, unknown>; args?: string[]; scenario?: string; hasSkillCanary?: boolean };
type Extensions = { skills: Array<{ id: string; version: string; enabled: boolean }>; mcpServers: Array<{ id: string; enabled: boolean; dependency?: { status: string } }> };

test('[P0] imported game keeps real assets while native Codex approvals and parallel sessions stay independent', async () => {
  const suite = await createSmokeSuite('openpixo-game-workspace');
  const game = await createOpenPixoGame(join(suite.scratchDir, 'game'));
  const secondGame = await createOpenPixoGame(join(suite.scratchDir, 'second-game'));
  const codex = await createOpenPixoCodex(join(suite.scratchDir, 'fake-codex'));
  const runIds: string[] = [];

  await suite.with.toolsDev(async ({ runtime }) => {
    const baseUrl = `http://127.0.0.1:${runtime.daemonPort}`;
    await requestJson(baseUrl, '/api/app-config', { method: 'PUT', body: {
      agentId: 'codex', agentCliEnv: { codex: { CODEX_BIN: codex.bin } },
      agentModels: { codex: { model: 'default', reasoning: 'default' } },
      onboardingCompleted: true, privacyDecisionAt: Date.now(),
      telemetry: { metrics: false, content: false, artifactManifest: false },
    } });
    const imported = await requestJson<ImportedProject>(baseUrl, '/api/import/folder', { body: { baseDir: game.root } });
    const independent = await requestJson<ImportedProject>(baseUrl, '/api/import/folder', { body: { baseDir: secondGame.root } });
    const projectPath = `/api/projects/${imported.project.id}`;
    expect(imported.project.metadata.baseDir).toBe(await realpath(game.root));
    const originalFiles = await requestJson<FileList>(baseUrl, `${projectPath}/files`);
    expect(originalFiles.files.map(file => file.name)).toEqual(expect.arrayContaining(['assets/sprite.png', 'assets/jump.wav', 'project.godot']));
    for (const [name, bytes, mime] of [
      ['sprite.png', game.png, 'image/png'], ['jump.wav', game.wav, 'audio/wav'],
    ] as const) {
      const response = await fetch(`${baseUrl}${projectPath}/raw/assets/${name}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(mime);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
    await writeFile(join(suite.scratchDir, 'outside.txt'), 'must remain outside the project');
    const escaped = await fetch(`${baseUrl}${projectPath}/raw/${encodeURIComponent('../outside.txt')}`);
    expect(escaped.ok, 'raw preview must reject traversal outside the imported game').toBe(false);

    const skillSource = join(suite.scratchDir, 'asset-skill');
    await mkdir(skillSource, { recursive: true });
    const skillText = '---\nname: openpixo-asset-check\ndescription: Verify game assets without changing originals.\n---\nOPENPIXO_ASSET_SKILL_CANARY\nPreserve originals and put derived copies in assets/derived.\n';
    await writeFile(join(skillSource, 'SKILL.md'), skillText);
    const extensionsPath = `${projectPath}/extensions`;
    const installed = await requestJson<Extensions>(baseUrl, extensionsPath, { body: { kind: 'skill', source: skillSource } });
    const skill = installed.skills[0]!;
    expect(skill.enabled).toBe(true);
    const mcp = await requestJson<Extensions>(baseUrl, extensionsPath, { body: { kind: 'mcp', server: {
      id: 'acceptance-ping', transport: 'stdio', command: process.execPath,
      args: [fileURLToPath(new URL('../../resources/openpixo-mcp.ts', import.meta.url))], enabled: true,
    } } });
    expect(mcp.mcpServers).toContainEqual(expect.objectContaining({ id: 'acceptance-ping', enabled: true, dependency: expect.objectContaining({ status: 'ready' }) }));
    const otherExtensions = await requestJson<Extensions>(baseUrl, `/api/projects/${independent.project.id}/extensions`);
    expect(otherExtensions.skills).toEqual([]);
    expect(otherExtensions.mcpServers).toEqual([]);

    const launch = async (project: ImportedProject, message: string) => {
      const created = await startRun(baseUrl, {
        projectId: project.project.id, conversationId: project.conversationId, agentId: 'codex',
        assistantMessageId: randomUUID(), userMessageId: randomUUID(), clientRequestId: randomUUID(), message,
      });
      runIds.push(created.runId);
      return created;
    };
    const held = await launch(imported, 'OPENPIXO_HOLD: keep this game task running until stopped.');
    await waitForRunStatus(baseUrl, held.runId, 'running', { timeoutMs: T.long });
    const parallel = await launch(independent, 'Finish the independent second game task.');
    expect((await waitForRunTerminal(baseUrl, parallel.runId, { timeoutMs: T.long })).status).toBe('succeeded');
    expect((await readRun(baseUrl, held.runId)).status, 'one game task must remain active while another finishes').toBe('running');
    await cancelRun(baseUrl, held.runId);
    expect((await waitForRunTerminal(baseUrl, held.runId, { timeoutMs: T.long })).status).toBe('canceled');

    const approved = await launch(imported, 'OPENPIXO_APPROVE: make a derived sprite copy and check it with a child agent.');
    let approvals: Approval[] = [];
    await expect.poll(async () => {
      approvals = (await requestJson<{ approvals: Approval[] }>(baseUrl, `/api/runs/${approved.runId}/approvals`)).approvals;
      return approvals.length;
    }, { timeout: T.long, message: 'native app-server server request must reach the correlated approval API' }).toBe(1);
    expect(approvals[0]!.command).toBe('copy sprite to derived output');
    expect((await readRun(baseUrl, approved.runId)).status).toBe('running');
    expect((await requestJson<FileList>(baseUrl, `${projectPath}/files`)).files.map(file => file.name)).not.toContain('assets/derived/sprite-copy.png');
    await requestJson(baseUrl, `/api/runs/${approved.runId}/approvals/${approvals[0]!.requestId}`, { body: { decision: 'accept' } });
    expect((await waitForRunTerminal(baseUrl, approved.runId, { timeoutMs: T.long })).status).toBe('succeeded');
    expect((await requestJson<{ approvals: Approval[] }>(baseUrl, `/api/runs/${approved.runId}/approvals`)).approvals).toEqual([]);
    const replay = await fetch(`${baseUrl}/api/runs/${approved.runId}/approvals/${approvals[0]!.requestId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'accept' }),
    });
    expect(replay.status, 'completed approvals cannot be replayed').toBe(409);

    const finalFiles = await requestJson<FileList>(baseUrl, `${projectPath}/files`);
    expect(finalFiles.files.map(file => file.name)).toContain('assets/derived/sprite-copy.png');
    expect(await readFile(join(game.root, 'assets', 'sprite.png'))).toEqual(game.png);
    expect(await readFile(join(game.root, 'assets', 'derived', 'sprite-copy.png'))).toEqual(game.png);
    const events = await readRunEvents(baseUrl, approved.runId);
    expect(events).toContain('asset-check');
    expect(events).toContain('parentThreadId');
    expect(await readRunEvents(baseUrl, parallel.runId), 'child activity must not leak into another project').not.toContain('asset-check');
    const messages = await listMessages(baseUrl, imported.project.id, imported.conversationId);
    expect(messages.some(message => message.runId === approved.runId && message.runStatus === 'succeeded')).toBe(true);

    const cancelApprovalRun = await launch(imported, 'OPENPIXO_APPROVE: wait for explicit approval cancellation.');
    let cancelApprovals: Approval[] = [];
    await expect.poll(async () => {
      cancelApprovals = (await requestJson<{ approvals: Approval[] }>(baseUrl, `/api/runs/${cancelApprovalRun.runId}/approvals`)).approvals;
      return cancelApprovals.length;
    }, { timeout: T.long }).toBe(1);
    await requestJson(baseUrl, `/api/runs/${cancelApprovalRun.runId}/approvals/${cancelApprovals[0]!.requestId}`, { body: { decision: 'cancel' } });
    expect((await waitForRunTerminal(baseUrl, cancelApprovalRun.runId, { timeoutMs: T.long })).status,
      'canceling a permission request must cancel its run').toBe('canceled');

    await writeFile(join(skillSource, 'SKILL.md'), `${skillText}\nUpdated source instruction.\n`);
    const updated = await requestJson<Extensions>(baseUrl, `${extensionsPath}/skill/${encodeURIComponent(skill.id)}`, { body: { action: 'update' } });
    expect(updated.skills[0]!.version).not.toBe(skill.version);
    await requestJson(baseUrl, `${extensionsPath}/skill/${encodeURIComponent(skill.id)}`, { body: { action: 'disable' } });
    await requestJson(baseUrl, `${extensionsPath}/mcp/acceptance-ping`, { body: { action: 'disable' } });
    const disabledRun = await launch(imported, 'Finish this game task without the disabled project extensions.');
    expect((await waitForRunTerminal(baseUrl, disabledRun.runId, { timeoutMs: T.long })).status).toBe('succeeded');
    await requestJson(baseUrl, `${extensionsPath}/skill/${encodeURIComponent(skill.id)}`, { method: 'DELETE' });
    const removed = await requestJson<Extensions>(baseUrl, `${extensionsPath}/mcp/acceptance-ping`, { method: 'DELETE' });
    expect(removed.skills).toEqual([]);
    expect(removed.mcpServers).toEqual([]);
    expect(await readFile(join(game.root, 'assets', 'sprite.png'))).toEqual(game.png);
    expect(await readFile(join(game.root, 'assets', 'derived', 'sprite-copy.png'))).toEqual(game.png);

    const receipts = (await readFile(codex.receipt, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Receipt);
    expect(receipts.some(entry => entry.method === 'thread/resume')).toBe(true);
    for (const entry of receipts.filter(entry => entry.method === 'thread/start' || entry.method === 'thread/resume')) {
      expect(entry.params?.approvalPolicy).toBe('on-request');
      expect(entry.params?.sandbox).toBe('workspace-write');
    }
    const interrupted = receipts.find(entry => entry.method === 'turn/interrupt');
    expect(interrupted?.params).toMatchObject({ threadId: expect.any(String), turnId: expect.any(String) });
    const approvedTurn = receipts.find(entry => entry.event === 'turn-scenario' && entry.scenario === 'approval');
    expect(approvedTurn?.hasSkillCanary, 'enabled project skill must reach native Codex instructions').toBe(true);
    expect(receipts.find(entry => entry.pid === approvedTurn?.pid && (entry.method === 'thread/start' || entry.method === 'thread/resume'))?.params?.config).toMatchObject({
      mcp_servers: { 'openpixo_acceptance-ping': { enabled: true, command: process.execPath } },
    });
    const lastTurn = receipts.filter(entry => entry.event === 'turn-scenario').at(-1)!;
    expect(lastTurn.hasSkillCanary, 'disabled skill must not be injected into later tasks').toBe(false);
    expect(receipts.find(entry => entry.pid === lastTurn.pid && (entry.method === 'thread/start' || entry.method === 'thread/resume'))?.params?.config).not.toHaveProperty('mcp_servers.openpixo_acceptance-ping');
    await suite.report.json('game-workspace.json', { projectId: imported.project.id, heldRunId: held.runId, parallelRunId: parallel.runId, approvedRunId: approved.runId, files: finalFiles.files.map(file => file.name), receipts });
  }, {
    env: { PIXO_CODEX_TRANSPORT: 'app-server', PIXO_AGENT_HOME: join(suite.scratchDir, 'agent-home') },
    onFailure: async ({ context }) => {
      if (!context) return;
      const url = `http://127.0.0.1:${context.runtime.daemonPort}`;
      await suite.report.json('failure/runs.json', await Promise.all(runIds.map(async id => {
        const state = await readRun(url, id);
        const events = state.status === 'running' || state.status === 'queued' ? null : await readRunEvents(url, id);
        return { state, events };
      })));
    },
  });
}, 180_000);
