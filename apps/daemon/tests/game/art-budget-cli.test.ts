import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { OPENPIXO_MODEL3D_PROMPT } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(daemonRoot, 'src', 'cli.ts');

/** Answers the daemon's generate route from inside the CLI process, and records what it was sent. */
function preload(generateReply: string): string {
  return 'data:text/javascript,' + encodeURIComponent(
    "import {writeFileSync} from 'node:fs'; globalThis.fetch=async(url,init)=>{"
    + "if(String(url).endsWith('/api/tools/media/generate')){"
    + 'writeFileSync(process.env.BUDGET_REQUEST,JSON.stringify({url,auth:init.headers.authorization,body:JSON.parse(init.body)}));'
    + `${generateReply}}`
    + "if(String(url).endsWith('/api/media/tasks/hosted-task/wait'))return new Response(JSON.stringify({"
    + "status:'done',nextSince:0,file:{name:'assets/hero.png',width:64,height:64}}));"
    + "throw new Error('Unexpected HTTP endpoint '+url);};",
  );
}

/** Records every daemon request and answers the quote, generate and wait routes. */
function audioPreload(): string {
  return 'data:text/javascript,' + encodeURIComponent(
    "import {appendFileSync} from 'node:fs'; globalThis.fetch=async(url,init)=>{const path=new URL(String(url)).pathname;"
    + 'appendFileSync(process.env.BUDGET_REQUEST,JSON.stringify({path,auth:init?.headers?.authorization,body:init?.body?JSON.parse(init.body):null})+"\\n");'
    + "if(path.endsWith('/media/openpixo-quote'))return new Response(JSON.stringify({quoteId:'0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e',service:'openpixo-sfx',credits:7,priceVersion:1,"
    + "paramsDigest:'a',expiresAt:'2026-11-07T01:00:00.000Z',available:40,breakdown:{base:7,longPrompt:0,extraReferences:0}}));"
    + "if(path.endsWith('/media/generate'))return new Response(JSON.stringify({taskId:'hosted-task',status:'queued'}),{status:202});"
    + "if(path.endsWith('/api/media/tasks/hosted-task/wait'))return new Response(JSON.stringify({status:'done',nextSince:0,file:{name:'audio/coin.mp3'}}));"
    + "throw new Error('Unexpected HTTP endpoint '+url);};",
  );
}

describe('pixo media with hosted audio', () => {
  let root = '';
  let requestFile = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pixo-audio-cli-'));
    requestFile = path.join(root, 'requests.jsonl');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const run = (args: string[], env: Record<string, string> = {}, input?: string) => new Promise<{ stdout: string }>((resolve, reject) => {
    const child = execFile(process.execPath, ['--import', 'tsx', '--import', audioPreload(), cli, 'media', ...args], {
      cwd: daemonRoot, timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: '', PIXO_DATA_DIR: root, PIXO_DAEMON_URL: 'http://offline.invalid', PIXO_TOOL_TOKEN: '', BUDGET_REQUEST: requestFile, ...env },
    }, (error, stdout) => { if (error) reject(error); else resolve({ stdout }); });
    child.stdin?.end(input ?? '');
  });
  const requests = async () => (await readFile(requestFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { path: string; auth?: string; body: Record<string, unknown> });
  const QUOTE = '0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e';

  it('quotes a sound effect with its length, as JSON, and drops an aspect', async () => {
    const { stdout } = await run(['quote', '--model', 'openpixo-sfx', '--project', 'game', '--prompt', 'a coin', '--duration', '3', '--aspect', '1:1', '--json']);
    expect(JSON.parse(stdout)).toMatchObject({ quoteId: QUOTE, credits: 7 });
    const [request] = await requests();
    expect(request!.path).toBe('/api/projects/game/media/openpixo-quote');
    expect(request!.body).toEqual({ service: 'openpixo-sfx', prompt: 'a coin', duration: 3, images: [] });
  });

  it('quotes a voice line with its voice, from a prompt on stdin', async () => {
    await run(['quote', '--model', 'openpixo-voice', '--project', 'game', '--prompt-file', '-', '--voice', 'Aria', '--json'], {}, 'Welcome back.');
    expect((await requests())[0]!.body).toEqual({ service: 'openpixo-voice', prompt: 'Welcome back.', style: 'Aria', images: [] });
  });

  it('quotes music with nothing the cloud would refuse', async () => {
    await run(['quote', '--model', 'openpixo-music', '--project', 'game', '--prompt', 'light village music', '--duration', '30', '--voice', 'Aria', '--json']);
    expect((await requests())[0]!.body).toEqual({ service: 'openpixo-music', prompt: 'light village music', images: [] });
  });

  it('refuses a nonsense length before asking the daemon', async () => {
    await expect(run(['quote', '--model', 'openpixo-sfx', '--project', 'game', '--prompt', 'a coin', '--duration', 'soon', '--json'])).rejects.toBeTruthy();
    await expect(readFile(requestFile, 'utf8')).rejects.toBeTruthy();
  });

  it('generates a voice line from a confirmed quote, with no --audio-kind', async () => {
    await run(['generate', '--surface', 'audio', '--model', 'openpixo-voice', '--project', 'game', '--prompt', 'Welcome back.', '--voice', 'Aria',
      '--output', 'audio/hi.mp3', '--quote', QUOTE, '--request-id', 'cli-request-0001']);
    const generate = (await requests()).find(request => request.path.endsWith('/media/generate'))!;
    expect(generate.body).toMatchObject({ surface: 'audio', model: 'openpixo-voice', prompt: 'Welcome back.', voice: 'Aria', style: 'Aria', quoteId: QUOTE, cloudRequestId: 'cli-request-0001' });
  });

  it('under a tool token sends the voice and length, and nothing about money', async () => {
    await run(['generate', '--surface', 'audio', '--model', 'openpixo-sfx', '--prompt', 'a coin', '--duration', '3', '--output', 'audio/coin.mp3',
      '--quote', QUOTE, '--request-id', 'agent-chosen-request'], { PIXO_TOOL_TOKEN: 'pixott_agent', PIXO_PROJECT_ID: 'game' });
    const generate = (await requests()).find(request => request.path === '/api/tools/media/generate')!;
    expect(generate.auth).toBe('Bearer pixott_agent');
    expect(generate.body).toMatchObject({ surface: 'audio', model: 'openpixo-sfx', duration: 3 });
    for (const key of ['quoteId', 'cloudRequestId', 'style']) expect(generate.body).not.toHaveProperty(key);
  });

  it('quotes a 3D model from its picture, with no prompt typed', async () => {
    await run(['quote', '--model', 'openpixo-model3d', '--project', 'game', '--image', 'art/chest.png', '--json']);
    expect((await requests())[0]!.body).toEqual({ service: 'openpixo-model3d', prompt: OPENPIXO_MODEL3D_PROMPT, images: ['art/chest.png'] });
  });

  it('generates a 3D model under a tool token, and sends nothing about money', async () => {
    await run(['generate', '--surface', 'model3d', '--model', 'openpixo-model3d', '--image', 'art/chest.png', '--output', 'models/chest.glb',
      '--quote', QUOTE, '--request-id', 'agent-chosen-request'], { PIXO_TOOL_TOKEN: 'pixott_agent', PIXO_PROJECT_ID: 'game' });
    const generate = (await requests()).find(request => request.path === '/api/tools/media/generate')!;
    expect(generate.body).toMatchObject({ surface: 'model3d', model: 'openpixo-model3d', output: 'models/chest.glb' });
    for (const key of ['quoteId', 'cloudRequestId']) expect(generate.body).not.toHaveProperty(key);
  });

  it('explains the hosted models in its help', async () => {
    const { stdout } = await run(['--help']);
    for (const text of ['openpixo-sfx', 'openpixo-voice', 'openpixo-music', 'openpixo-model3d', '--voice <name>', '--surface image|audio|model3d']) expect(stdout).toContain(text);
    expect(stdout).not.toMatch(/\bfal\b/i);
  });
});

describe('pixo media generate with a hosted model under a tool token', () => {
  let root = '';
  let requestFile = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pixo-art-budget-cli-'));
    requestFile = path.join(root, 'request.json');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const run = (reply: string) => execute(process.execPath, ['--import', 'tsx', '--import', preload(reply), cli, 'media', 'generate',
    '--surface', 'image', '--model', 'openpixo-image', '--prompt', 'A hero', '--output', 'assets/hero.png',
    '--quote', '0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e', '--request-id', 'agent-chosen-request', '--cloud-style', 'free'], {
    cwd: daemonRoot, timeout: 30_000,
    env: { ...process.env, NODE_OPTIONS: '', PIXO_DATA_DIR: root, PIXO_DAEMON_URL: 'http://offline.invalid',
      PIXO_TOOL_TOKEN: 'pixott_agent', PIXO_PROJECT_ID: 'game', BUDGET_REQUEST: requestFile },
  });

  it('asks for no confirmation and sends nothing about money, whatever the flags say', async () => {
    const result = await run("return new Response(JSON.stringify({taskId:'hosted-task',status:'queued'}),{status:202});");
    const request = JSON.parse(await readFile(requestFile, 'utf8'));
    expect(request.auth).toBe('Bearer pixott_agent');
    expect(request.body).toMatchObject({ surface: 'image', model: 'openpixo-image', prompt: 'A hero' });
    for (const key of ['quoteId', 'cloudRequestId', 'style', 'quote', 'request-id']) expect(request.body).not.toHaveProperty(key);
    expect(JSON.parse(result.stdout).file).toMatchObject({ name: 'assets/hero.png' });
  });

  it('hands the agent the next step when the budget is used up', async () => {
    const error = await run("return new Response(JSON.stringify({error:{code:'ART_BUDGET_EXHAUSTED',message:'Art budget: 100 of 100 credits used. Only the user can raise it, after this turn ends.'}}),{status:409});")
      .then(() => null, (failure) => failure as { code?: number; stderr?: string });
    expect(error?.code).toBe(4);
    const reported = JSON.parse(String(error?.stderr).trim().split('\n').at(-1)!) as { error: { code: string; message: string; nextStep: string } };
    expect(reported.error).toMatchObject({ code: 'ART_BUDGET_EXHAUSTED', nextStep: 'raise-art-budget' });
    expect(reported.error.message).toContain('100 of 100');
  });

  it('hands the agent the old next step when no budget is set', async () => {
    const error = await run("return new Response(JSON.stringify({error:{code:'GENERATION_CONFIRMATION_REQUIRED',message:'no budget'}}),{status:403});")
      .then(() => null, (failure) => failure as { code?: number; stderr?: string });
    expect(error?.code).toBe(4);
    expect(JSON.parse(String(error?.stderr).trim().split('\n').at(-1)!).error.nextStep).toBe('confirm-in-app');
  });
});
