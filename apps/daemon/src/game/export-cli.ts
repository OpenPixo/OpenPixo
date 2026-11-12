/**
 * `pixo game export`: the web game as one HTML file that plays offline, written to
 * disk. Same route as the export menu (`routes/game-export.ts`). Under an agent's
 * token it builds here first, so the build runs inside the agent's sandbox.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { GAME_EXPORT_FILES_HEADER, PRODUCT_CLI_NAME, gameExportFileName, type GameExportRequest, type GameVerifyContext } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { runProjectBuild } from '../publish/build.js';
import { isWebProject } from '../publish/web-project.js';
import { gameToolResolver } from './verify.js';

export const GAME_EXPORT_USAGE = `${PRODUCT_CLI_NAME} game export [--project <id>] [--out <file.html>] [--no-build] [--json]
  Builds the web game and writes it as one HTML file that plays offline (double-click it, or send it).
  Default output: exports/<game title>.html under the current folder.`;

function fileNameFromDisposition(header: string | null): string | null {
  const encoded = header ? /filename\*=UTF-8''([^;]+)/iu.exec(header)?.[1] : undefined;
  if (!encoded) return null;
  try { return decodeURIComponent(encoded); } catch { return null; }
}

export async function runGameExportCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h')) { console.log(GAME_EXPORT_USAGE); return; }
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      project: { type: 'string' }, out: { type: 'string' }, 'no-build': { type: 'boolean' }, json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length) throw new Error(`Usage: ${GAME_EXPORT_USAGE}`);
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error(`Project id required: pass --project <id>.\n${GAME_EXPORT_USAGE}`);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/u, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const project = `${base}/api/projects/${encodeURIComponent(projectId)}`;
    const request: GameExportRequest = values['no-build'] ? { skipBuild: true } : {};

    if (process.env.PIXO_TOOL_TOKEN && !request.skipBuild) {
      // The daemon will not run project commands for an agent's token: build here, in its sandbox.
      const response = await fetch(`${project}/game/verify/context`, { headers });
      const context = await response.json() as GameVerifyContext & { error?: { message?: string } };
      if (!response.ok) throw new Error(context.error?.message ?? `Could not read the project (${response.status})`);
      if (isWebProject(context.profile, context.projectDir)) {
        if (!json) console.error('Building the game...');
        await runProjectBuild({ profile: context.profile, projectDir: context.projectDir, resolveTool: gameToolResolver({ ...context.toolPaths }), retry: 'export again' });
      }
      request.skipBuild = true;
    } else if (!json && !request.skipBuild) console.error('Building the game...');

    let response: Response;
    try { response = await fetch(`${project}/game/export`, { method: 'POST', headers, body: JSON.stringify(request) }); }
    catch { throw new Error('OpenPixo could not be reached. Open the app and try again.'); }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
      throw Object.assign(new Error(body?.error?.message ?? `The export failed (${response.status})`), { code: body?.error?.code });
    }
    const html = Buffer.from(await response.arrayBuffer());
    const name = fileNameFromDisposition(response.headers.get('content-disposition')) ?? gameExportFileName('game');
    const out = path.resolve(values.out ?? path.join('exports', name));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, html);
    const files = Number(response.headers.get(GAME_EXPORT_FILES_HEADER) ?? 0);
    if (json) process.stdout.write(`${JSON.stringify({ path: out, bytes: html.length, files }, null, 2)}\n`);
    else console.log(`Exported: ${out} (${(html.length / (1024 * 1024)).toFixed(1)} MB, ${files} files inside). Double-click it to play; it needs no internet.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message, code: (error as { code?: string }).code } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
