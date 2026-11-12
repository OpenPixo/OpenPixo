import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fakeDispatcher = 'data:text/javascript,' + encodeURIComponent(`
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/media/generate')) {
    process.stdout.write(JSON.stringify({ request: { url, body: JSON.parse(init.body) } }) + '\\n');
    return Response.json({ taskId: 'task-style', status: 'queued' });
  }
  return Response.json({ status: 'done', file: { name: 'out.png', size: 3 } });
};`);

it.each([
  { flags: [], style: undefined },
  { flags: ['--style', 'pixel-16'], style: 'pixel-16' },
  { flags: ['--style', 'none'], style: null },
])('forwards media style selection $flags through the existing dispatcher without network', async ({ flags, style }) => {
  const { stdout } = await exec(process.execPath, [
    '--import', 'tsx', '--import', fakeDispatcher, cliEntry,
    'media', 'generate', '--surface', 'image', '--model', 'test-model',
    '--prompt', 'A knight sprite', '--project', 'game', '--daemon-url', 'http://offline.invalid', '--json', ...flags,
  ], { cwd: daemonRoot, timeout: 10_000, env: { ...process.env, PIXO_TOOL_TOKEN: '', NODE_OPTIONS: '' } });
  const posted = JSON.parse(stdout.split(/\r?\n/u)[0]!).request;
  expect(posted.url).toBe('http://offline.invalid/api/projects/game/media/generate');
  expect(posted.body).toMatchObject({ surface: 'image', model: 'test-model', prompt: 'A knight sprite' });
  if (style === undefined) expect(posted.body).not.toHaveProperty('styleId');
  else expect(posted.body.styleId).toBe(style);
});
