import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { imageSizeCliRequestOptions } from '../../src/media/image-size-cli.js';

const execute = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(daemonRoot, 'src', 'cli.ts');

describe('pixo media generate size flags', () => {
  it('maps --size, --width/--height and --transparent onto the shared request', () => {
    expect(imageSizeCliRequestOptions({ size: '64' })).toEqual({ width: 64, height: 64 });
    expect(imageSizeCliRequestOptions({ size: '1536x864' })).toEqual({ width: 1536, height: 864 });
    expect(imageSizeCliRequestOptions({ size: '96×128' })).toEqual({ width: 96, height: 128 });
    expect(imageSizeCliRequestOptions({ width: '320' })).toEqual({ width: 320 });
    expect(imageSizeCliRequestOptions({ width: '128', height: '96', transparent: true })).toEqual({ width: 128, height: 96, background: 'transparent' });
    expect(imageSizeCliRequestOptions({})).toEqual({});
  });

  it('refuses ambiguous or malformed sizes', () => {
    expect(() => imageSizeCliRequestOptions({ size: '64', width: '64' })).toThrow('not both');
    expect(() => imageSizeCliRequestOptions({ size: 'big' })).toThrow('--size must be');
    expect(() => imageSizeCliRequestOptions({ width: '12.5' })).toThrow('--width must be a whole number');
    expect(() => imageSizeCliRequestOptions({ transparent: true, background: 'scene' })).toThrow('conflicts');
  });

  it('sends the size and cutout through the same HTTP endpoint the UI uses', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixo-media-size-cli-'));
    const requestFile = path.join(root, 'request.json');
    const preload = 'data:text/javascript,' + encodeURIComponent(
      "import {writeFileSync} from 'node:fs'; globalThis.fetch=async(url,init)=>{" +
      "if(String(url).endsWith('/api/tools/media/generate')){" +
      "writeFileSync(process.env.SIZE_REQUEST,JSON.stringify({url,auth:init.headers.authorization,body:JSON.parse(init.body)}));" +
      "return new Response(JSON.stringify({taskId:'size-task',status:'queued'}),{status:202});}" +
      "if(String(url).endsWith('/api/media/tasks/size-task/wait'))return new Response(JSON.stringify({" +
      "status:'done',nextSince:0,file:{name:'assets/icons/coin.png',width:64,height:64,transparent:true}}));" +
      "throw new Error('Unexpected HTTP endpoint '+url);};",
    );
    try {
      const result = await execute(process.execPath, ['--import', 'tsx', '--import', preload, cli, 'media', 'generate',
        '--surface', 'image', '--model', 'gpt-image-2', '--prompt', 'A gold coin icon',
        '--output', 'assets/icons/coin.png', '--size', '64', '--transparent'], {
        cwd: daemonRoot, timeout: 15_000,
        env: { ...process.env, NODE_OPTIONS: '', PIXO_DATA_DIR: root, PIXO_DAEMON_URL: 'http://offline.invalid',
          PIXO_TOOL_TOKEN: 'agent-token', PIXO_PROJECT_ID: 'game', SIZE_REQUEST: requestFile },
      });
      const request = JSON.parse(await readFile(requestFile, 'utf8'));
      expect(request.auth).toBe('Bearer agent-token');
      expect(request.body).toMatchObject({ surface: 'image', model: 'gpt-image-2', width: 64, height: 64, background: 'transparent' });
      expect(JSON.parse(result.stdout).file).toMatchObject({ width: 64, height: 64, transparent: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('exits 2 when a size is given for audio', async () => {
    const error = await execute(process.execPath, ['--import', 'tsx', cli, 'media', 'generate', '--surface', 'audio', '--model', 'suno-v5',
      '--prompt', 'x', '--size', '64'], {
      cwd: daemonRoot, timeout: 15_000,
      env: { ...process.env, NODE_OPTIONS: '', PIXO_DAEMON_URL: 'http://offline.invalid', PIXO_TOOL_TOKEN: 'agent-token', PIXO_PROJECT_ID: 'game' },
    }).then(() => null, (err) => err);
    expect(error?.code).toBe(2);
    expect(String(error?.stderr)).toContain('apply to --surface image only');
  });
});
