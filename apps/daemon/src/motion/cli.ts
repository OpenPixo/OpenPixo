import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  PRODUCT_CLI_NAME, type InstalledMotionCharacter, type MotionCharacter, type MotionCharactersResponse, type MotionJob, type MotionPortrait, type MotionStatus, type MotionSuggestion,
} from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { recipeCliText } from '../recipes/cli-common.js';
import { motionSlug } from './install.js';

export const MOTION_USAGE = `Moving characters, made by OpenPixo Cloud for credits: describe or show one, take the portrait, then order it.
${PRODUCT_CLI_NAME} motion service [--json]                       The price, portraits left today, and whether it is available.
${PRODUCT_CLI_NAME} motion portrait [--text <words> | --prompt-file <path|->] [--image <png|jpeg|webp>] [--wait] [--json]
    Paints a portrait to look at first, from words, a picture or both. Free, a few a day. Not good? Ask again.
${PRODUCT_CLI_NAME} motion status <job id|portrait id> [--wait] [--json]
${PRODUCT_CLI_NAME} motion order <portrait id> --name <name> [--yes] [--wait] [--json]
    Shows the price; --yes orders it (about five minutes). A failed job is charged nothing.
${PRODUCT_CLI_NAME} motion list [--json]                          Your moving characters.
${PRODUCT_CLI_NAME} motion show <id> [--json]
${PRODUCT_CLI_NAME} motion rename <id> --name <name> [--json]
${PRODUCT_CLI_NAME} motion delete <id> --yes [--json]             Delete it for good. Games keep their copies.
${PRODUCT_CLI_NAME} motion download <id> --output <dir> [--json]  Saves <name>.pxmo and <name>.png.
${PRODUCT_CLI_NAME} motion install <id> [--project <id>] [--slug <name>] [--json]   Put it and its player into a web, Phaser or Godot game. Free.
${PRODUCT_CLI_NAME} motion suggest (--text <words> | --prompt-file <path|->) [--project <id>] [--json]
    For agents: propose a moving character. The user sees it on the Moving character page and makes it there.`;

const COMMANDS = ['service', 'portrait', 'status', 'order', 'list', 'show', 'rename', 'delete', 'download', 'install', 'suggest'] as const;
export const motionCliTiming = { pollMs: 3_000, tries: 40 };

type Failure = Error & { payload?: { error?: { code?: string; message?: string } } | null; status?: number };
interface Api {
  json<T>(route: string, method?: string, body?: unknown): Promise<T>;
  bytes(route: string): Promise<Buffer>;
}

async function daemonApi(flagUrl: string | undefined): Promise<Api> {
  const base = (await resolveDaemonUrl({ flagUrl: flagUrl ?? null })).replace(/\/$/u, '');
  const token = process.env.PIXO_TOOL_TOKEN ?? process.env.PIXO_API_TOKEN;
  const headers = { Origin: new URL(base).origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const send = async (route: string, method: string, body?: unknown): Promise<Response> => {
    let response: Response;
    const form = body instanceof FormData;
    try {
      response = await fetch(`${base}/api${route}`, {
        method, headers: { ...headers, ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
      });
    } catch { throw new Error('OpenPixo could not be reached. Open the app and try again.'); }
    if (response.ok) return response;
    const data = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    throw Object.assign(new Error(data?.error?.message ?? 'Something went wrong. Try again.'), { payload: data, status: response.status });
  };
  return {
    json: async <T>(route: string, method = 'GET', body?: unknown): Promise<T> => await (await send(route, method, body)).json() as T,
    bytes: async route => Buffer.from(await (await send(route, 'GET')).arrayBuffer()),
  };
}

const codeOf = (error: unknown): string | undefined => (error as Failure).payload?.error?.code;
/** No answer, or one that says nothing about what became of the request. */
const unsure = (error: unknown): boolean => { const code = codeOf(error); return code === undefined || code === 'CLOUD_UNAVAILABLE'; };
const pause = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** The same request again under the same id until there is an answer, so a lost one is never made twice. */
async function again<T>(work: () => Promise<T>, lost: string): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await work(); }
    catch (error) {
      if (!unsure(error)) throw error;
      if (i >= 5) throw new Error(lost);
      await pause(motionCliTiming.pollMs);
    }
  }
}

/** Looks until it is no longer being made. It goes on in the cloud whatever happens here. */
async function until<T extends { state: string }>(look: () => Promise<T>, busy: readonly string[], say: (line: string) => void, gone: string): Promise<T> {
  let last = '', missed = 0;
  for (;;) {
    let now: T;
    try { now = await look(); missed = 0; }
    catch (error) {
      if (unsure(error) && ++missed < motionCliTiming.tries) { await pause(motionCliTiming.pollMs); continue; }
      const message = `${error instanceof Error ? error.message : String(error)} ${gone}`;
      throw Object.assign(new Error(message), { payload: { error: { message } } });
    }
    if (now.state !== last) say(last = now.state);
    if (!busy.includes(now.state)) return now;
    await pause(motionCliTiming.pollMs);
  }
}

const JOB_BUSY = ['waiting', 'painting', 'checking', 'building', 'baking'] as const;
const showCharacter = (c: MotionCharacter): string => [
  `${c.name} (${c.id}): ${c.state}${c.file ? `, ${Math.ceil(c.file.bytes / 1024)} KB` : ''}`,
  ...(c.job && c.job.state !== 'succeeded' ? [`  job ${c.job.id}: ${c.job.state}${c.job.errorCode ? ` (${c.job.errorCode}, nothing was charged)` : ` ${Math.round(c.job.progress * 100)}%`}`] : []),
].join('\n');
const showPortrait = (p: MotionPortrait): string => `Portrait ${p.id}: ${p.state}${p.errorCode ? ` (${p.errorCode})` : ''}${p.used ? ', already used' : ''}`;
const showJob = (j: MotionJob): string => `Job ${j.id}: ${j.state} ${Math.round(j.progress * 100)}%${j.errorCode ? ` (${j.errorCode})` : ''}${j.creditsCharged !== null ? `, charged ${j.creditsCharged} credits` : ''}`;

export async function runMotionCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h') || !(COMMANDS as readonly string[]).includes(args[0]!)) {
      if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(MOTION_USAGE); return; }
      throw new Error(MOTION_USAGE);
    }
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, yes: { type: 'boolean' }, wait: { type: 'boolean' }, text: { type: 'string' }, 'prompt-file': { type: 'string' }, image: { type: 'string' },
      name: { type: 'string' }, output: { type: 'string' }, project: { type: 'string' }, slug: { type: 'string' }, 'daemon-url': { type: 'string' },
    } as const });
    json = values.json === true;
    const command = args[0] as (typeof COMMANDS)[number], [first] = positionals;
    const takes = (n: number): void => { if (positionals.length !== n) throw new Error(MOTION_USAGE); };
    const print = (result: unknown, text: string): void => { console.log(json ? JSON.stringify(result, null, 2) : text); };
    const say = (line: string): void => { if (!json) console.error(line); };
    const words = async (): Promise<string> => values['prompt-file'] ? (await recipeCliText(values['prompt-file'])).trim() : values.text ?? '';
    const project = (): string => { const p = values.project ?? process.env.PIXO_PROJECT_ID; if (!p) throw new Error('--project or PIXO_PROJECT_ID is required'); return p; };
    const of = (id: string | undefined): string => `/motion/characters/${encodeURIComponent(id ?? '')}`;
    // checked before the daemon is asked
    if (command === 'portrait' && !values.text && !values['prompt-file'] && !values.image) throw new Error('Describe it with --text or --prompt-file, or show it with --image.');
    if (command === 'order' && !values.name) throw new Error('Give it a name with --name.');
    if (command === 'rename' && !values.name) throw new Error('Give the new name with --name.');
    if (command === 'delete' && !values.yes) throw new Error('This deletes the moving character for good. Games keep their copies. Add --yes to do it.');
    if (command === 'download' && !values.output) throw new Error('Say where to save it with --output <dir>.');
    if (command === 'suggest' && !values.text && !values['prompt-file']) throw new Error('Say what you propose with --text or --prompt-file.');
    const api = await daemonApi(values['daemon-url']);

    switch (command) {
      case 'service': {
        takes(0);
        const s = await api.json<MotionStatus>('/motion/service');
        print(s, !s.available ? 'Moving characters are not available in this build.' : !s.signedIn ? 'Sign in to make moving characters.' : !s.service ? 'OpenPixo cloud is unavailable.'
          : `${s.service.paused ? 'Paused. ' : ''}${s.service.price} credits a character. Portraits left today: ${s.service.portraitsLeft} of ${s.service.portraitsPerDay}.`);
        return;
      }
      case 'portrait': {
        takes(0);
        const text = await words(), requestId = randomUUID(), image = values.image ? await readFile(values.image) : null;
        const ask = (): Promise<MotionPortrait> => {
          const form = new FormData();
          form.append('text', text);
          form.append('requestId', requestId);
          if (image) form.append('picture', new Blob([new Uint8Array(image)]), path.basename(values.image!));
          return api.json<MotionPortrait>('/motion/portraits', 'POST', form);
        };
        let portrait = await again(ask, `The portrait got no answer. Look again with "${PRODUCT_CLI_NAME} motion portrait" later.`);
        if (values.wait) portrait = await until(() => api.json<MotionPortrait>(`/motion/portraits/${encodeURIComponent(portrait.id)}`), ['painting'], say, `It goes on. Look with "${PRODUCT_CLI_NAME} motion status ${portrait.id} --wait".`);
        print(portrait, `${showPortrait(portrait)}${portrait.state === 'ready' ? `\nLook at it in the app, then order it with "${PRODUCT_CLI_NAME} motion order ${portrait.id} --name <name>". Not right? Ask again.` : ''}`);
        if (portrait.state === 'failed') process.exitCode = 5;
        return;
      }
      case 'status': {
        takes(1);
        const id = encodeURIComponent(first!);
        let isJob = true;
        const look = async (): Promise<MotionJob | MotionPortrait> => {
          if (isJob) {
            try { return await api.json<MotionJob>(`/motion/jobs/${id}`); }
            catch (error) { if (codeOf(error) !== 'MOTION_NOT_FOUND') throw error; isJob = false; }
          }
          return api.json<MotionPortrait>(`/motion/portraits/${id}`);
        };
        const now = values.wait ? await until(look, [...JOB_BUSY, 'painting'], say, `It goes on. Look with "${PRODUCT_CLI_NAME} motion status ${first} --wait"; do not order again.`) : await look();
        print(now, 'progress' in now ? showJob(now) : showPortrait(now));
        if (now.state === 'failed') process.exitCode = 5;
        return;
      }
      case 'order': {
        takes(1);
        const status = await api.json<MotionStatus>('/motion/service');
        if (!status.service) throw new Error(!status.available ? 'Moving characters are not available in this build.' : !status.signedIn ? 'Sign in to make moving characters.' : 'OpenPixo cloud is unavailable.');
        if (!values.yes) { print({ price: status.service.price }, `Price: ${status.service.price} credits, charged only when it is delivered. Add --yes to order it.`); return; }
        const requestId = randomUUID();
        const started = await again(() => api.json<MotionJob>('/motion/jobs', 'POST', { portraitId: first, name: values.name, requestId }),
          `The order got no answer, so it may have been placed. Look with "${PRODUCT_CLI_NAME} motion list" before you order again.`);
        say(`Job ${started.id}`);
        if (!values.wait) { print(started, `${showJob(started)}\nIt takes about five minutes. Look with "${PRODUCT_CLI_NAME} motion status ${started.id} --wait".`); return; }
        const job = await until(() => api.json<MotionJob>(`/motion/jobs/${encodeURIComponent(started.id)}`), JOB_BUSY, say, `The job goes on. Look with "${PRODUCT_CLI_NAME} motion status ${started.id} --wait"; do not order again.`);
        if (job.state === 'failed') throw Object.assign(new Error(`It failed (${job.errorCode ?? 'unknown'}). Nothing was charged.`), { payload: { error: { code: job.errorCode, message: 'It failed. Nothing was charged.' }, job } });
        const character = await api.json<MotionCharacter>(of(job.characterId));
        print({ job, character }, `${showJob(job)}\n${showCharacter(character)}`);
        return;
      }
      case 'list': {
        takes(0);
        const all = await api.json<MotionCharactersResponse>('/motion/characters');
        print(all, all.characters.map(showCharacter).join('\n') || 'No moving characters yet.');
        return;
      }
      case 'show': { takes(1); const c = await api.json<MotionCharacter>(of(first)); print(c, showCharacter(c)); return; }
      case 'rename': { takes(1); const c = await api.json<MotionCharacter>(of(first), 'PATCH', { name: values.name }); print(c, showCharacter(c)); return; }
      case 'delete': { takes(1); const gone = await api.json(of(first), 'DELETE'); print(gone, 'Deleted.'); return; }
      case 'download': {
        takes(1);
        const c = await api.json<MotionCharacter>(of(first)), slug = motionSlug(c.name, c.id), dir = path.resolve(values.output!);
        const file = await api.bytes(`${of(first)}/file`), poster = await api.bytes(`${of(first)}/poster`);
        await mkdir(dir, { recursive: true });
        const saved = { file: path.join(dir, `${slug}.pxmo`), poster: path.join(dir, `${slug}.png`) };
        await writeFile(saved.file, file);
        await writeFile(saved.poster, poster);
        print(saved, `${saved.file}\n${saved.poster}`);
        return;
      }
      case 'install': {
        takes(1);
        const c = await api.json<InstalledMotionCharacter>(`${of(first)}/install`, 'POST', { projectId: project(), ...(values.slug ? { slug: values.slug } : {}) });
        print(c, `${c.name}: ${c.file}\nPlayer: ${c.player.join(', ')}${c.playerState === 'edited' ? ' (changed by hand, so it was left alone)' : ''}\n\n${c.usage}`);
        return;
      }
      case 'suggest': {
        takes(0);
        const s = await api.json<MotionSuggestion>('/motion/suggestions', 'POST', { projectId: project(), text: await words() });
        print(s, 'Proposed. The user sees it on the Moving character page and makes it there. Nothing was charged.');
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error), payload = (error as Failure).payload;
    if (json) console.log(JSON.stringify(payload ?? { error: { message } })); else console.error(message);
    process.exitCode = 5;
  }
}
