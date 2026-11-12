import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/suite';

type CreatedProject = { conversationId: string; project: { id: string; name: string } };
const execFileAsync = promisify(execFile);
const PIXO_BIN = fileURLToPath(new URL(`../../../apps/daemon/bin/${PRODUCT_CLI_NAME}.mjs`, import.meta.url));

test('[P0] local project mutations work without browser identity headers', { timeout: 300_000 }, async () => {
  const suite = await createSmokeSuite('local-project-mutation');
  await suite.with.toolsDev(async ({ runtime }) => {
    const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}`;
    const created = await requestJson<CreatedProject>(daemonUrl, '/api/projects', { body: {
      id: randomUUID(), name: 'Local project', metadata: { kind: 'prototype' }, skillId: null,
    } });
    const copied = await requestJson<CreatedProject>(daemonUrl, `/api/projects/${created.project.id}/duplicate`, { body: { name: 'Local copy' } });
    expect(copied.project.id).not.toBe(created.project.id);
    const renamed = await requestJson<CreatedProject>(daemonUrl, `/api/projects/${copied.project.id}`, { method: 'PATCH', body: { name: 'Renamed copy' } });
    expect(renamed.project.name).toBe('Renamed copy');
    const denied = await fetch(`${daemonUrl}/api/projects/${copied.project.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' }, body: JSON.stringify({ name: 'Rejected' }),
    });
    expect(denied.status).toBe(403);
    const detail = await requestJson<CreatedProject>(daemonUrl, `/api/projects/${copied.project.id}`);
    expect(detail.project.name).toBe('Renamed copy');
  });
});

test(`[P0] the real ${PRODUCT_CLI_NAME} binary creates and duplicates a local project`, { timeout: 300_000 }, async () => {
  const suite = await createSmokeSuite('local-project-cli');
  await suite.with.toolsDev(async ({ runtime }) => {
    const env = { ...process.env, PIXO_DAEMON_URL: `http://127.0.0.1:${runtime.daemonPort}` };
    const created = await execFileAsync(process.execPath, [PIXO_BIN, 'project', 'create', '--name', 'CLI local project', '--json'], { env });
    const projectId = (JSON.parse(created.stdout) as CreatedProject).project.id;
    const duplicated = await execFileAsync(process.execPath, [PIXO_BIN, 'project', 'duplicate', projectId, '--name', 'CLI local copy', '--json'], { env });
    expect((JSON.parse(duplicated.stdout) as CreatedProject).project.id).not.toBe(projectId);
  });
});
