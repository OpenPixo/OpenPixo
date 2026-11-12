import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(daemonRoot, 'src', 'cli.ts');

describe('pixo media generate --provider codex-cli', () => {
  it('uses the standard generation/wait HTTP endpoints, defaults the model, and preserves machine-readable output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixo-t6-media-cli-'));
    const requestFile = path.join(root, 'request.json');
    const promptFile = path.join(root, 'prompt.txt');
    const prompt = 'A pixel art sword with a transparent background. '.repeat(10);
    await writeFile(promptFile, prompt);
    const preload = 'data:text/javascript,' + encodeURIComponent(
      "import {writeFileSync} from 'node:fs'; globalThis.fetch=async(url,init)=>{" +
      "if(String(url).endsWith('/api/projects/game/media/generate')){" +
      "writeFileSync(process.env.T6_REQUEST,JSON.stringify({url,body:JSON.parse(init.body)}));" +
      "return new Response(JSON.stringify({taskId:'t6-task',status:'queued'}),{status:202});}" +
      "if(String(url).endsWith('/api/media/tasks/t6-task/wait'))return new Response(JSON.stringify({" +
      "status:'done',nextSince:0,file:{name:'sword-1.png',providerId:'codex-cli',files:[{name:'sword-1.png'},{name:'sword-2.png'}]}}));" +
      "throw new Error('Unexpected HTTP endpoint '+url);};",
    );
    try {
      const result = await execute(process.execPath, ['--import', 'tsx', '--import', preload, cli, 'media', 'generate',
        '--provider', 'codex-cli', '--surface', 'image', '--project', 'game', '--json',
        '--prompt-file', promptFile, '--count', '2', '--background', 'transparent', '--negative-prompt', 'watermark',
        '--image', 'reference one.png', '--image', 'reference two.png'], {
        cwd: daemonRoot, timeout: 10_000,
        env: { ...process.env, NODE_OPTIONS: '', PIXO_DATA_DIR: root, PIXO_DAEMON_URL: 'http://offline.invalid',
          PIXO_TOOL_TOKEN: '', T6_REQUEST: requestFile },
      });
      const request = JSON.parse(await readFile(requestFile, 'utf8'));
      expect(request.url).toBe('http://offline.invalid/api/projects/game/media/generate');
      expect(request.body).toMatchObject({ provider: 'codex-cli', model: 'codex-image', prompt, count: 2,
        background: 'transparent', negativePrompt: 'watermark', images: ['reference one.png', 'reference two.png'] });
      expect(JSON.parse(result.stdout).file.files).toHaveLength(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
