// @vitest-environment node
import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createSmokeSuite } from '@/vitest/suite';

type CreatedProject = { conversationId: string; project: { id: string } };
const execFileAsync = promisify(execFile);
const PIXO_BIN = fileURLToPath(new URL(`../../../apps/daemon/bin/${PRODUCT_CLI_NAME}.mjs`, import.meta.url));

/** The real CLI entrypoint, driven as an external agent would. */
async function od(daemonUrl: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [PIXO_BIN, ...args], {
      env: { ...process.env, PIXO_DAEMON_URL: daemonUrl },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('local CLI project mutations', () => {
  test(`the real ${PRODUCT_CLI_NAME} binary can create a project and then duplicate it`, { timeout: 300_000 }, async () => {
    const suite = await createSmokeSuite('local-cli-project-mutation');
    await suite.with.toolsDev(async ({ runtime }) => {
      const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}`;
      const created = await od(daemonUrl, ['project', 'create', '--name', 'CLI dual-track project', '--json']);
      expect(created.code, `${PRODUCT_CLI_NAME} project create failed: ${created.stderr}`).toBe(0);
      const projectId = (JSON.parse(created.stdout) as CreatedProject).project.id;
      const duplicated = await od(daemonUrl, ['project', 'duplicate', projectId, '--name', 'CLI dual-track copy', '--json']);
      expect(duplicated.code, `${PRODUCT_CLI_NAME} project duplicate failed: ${duplicated.stderr || duplicated.stdout}`).toBe(0);
      expect(JSON.parse(duplicated.stdout).project.id).not.toBe(projectId);
    });
  });
});
