import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  CHARACTER_TUNING, PRODUCT_CLI_NAME, type CharacterBrief, type CharacterGear, type CharacterJob, type CharactersResponse, type CharactersStatus, type CharacterSuggestion, type InstalledCharacter,
  type InstalledCharactersResponse, type LocalCharacter,
} from '@openpixo/contracts';
import { accountCliApi } from '../account/cli-common.js';
import { resolveDaemonUrl } from '../daemon-url.js';
import { recipeCliText } from '../recipes/cli-common.js';

/** Commands of `pixo character` that are about animated characters; the rest are character cards. */
export const ANIMATED_COMMANDS = ['service', 'mine', 'info', 'make', 'add', 'fit', 'job', 'gear', 'wear', 'outfits', 'tune', 'pack', 'rename', 'remove', 'install', 'installed', 'uninstall', 'suggest'] as const;

export const ANIMATED_USAGE = `Animated characters, made by OpenPixo Cloud for credits:
${PRODUCT_CLI_NAME} character service [--json]                     Prices, and whether characters are available.
${PRODUCT_CLI_NAME} character mine [--json]                        Your characters, and the games they are in.
${PRODUCT_CLI_NAME} character info <id> [--json]
${PRODUCT_CLI_NAME} character make (--text <words> | --prompt-file <path|->) [--armor] [--weapons] [--style ink|cute] [--body angular|round|lanky|tiny] [--yes] [--json]
    Shows what was understood and the price; --yes orders it and waits. One sentence is enough. --weapons: eight weapons and four capes.
${PRODUCT_CLI_NAME} character add <id> armor|gear|motion (--text <words> | --prompt-file <path|->) [--yes] [--json]
    Three armour sets, eight weapons and four capes, or one motion. Weapons, capes and motions are yours for every character.
${PRODUCT_CLI_NAME} character fit <id> <design> [--yes] [--json]   Draw armour you own again for this character (see "gear" for designs).
${PRODUCT_CLI_NAME} character job <job id> [--wait] [--json]
${PRODUCT_CLI_NAME} character gear [--json]                        Everything you own: armour designs, weapons, capes, motions.
${PRODUCT_CLI_NAME} character wear <id> --pieces <piece,piece,…> [--json]   What goes into its package. Free.
${PRODUCT_CLI_NAME} character outfits <id> --file <json|-> [--json]       [{"name":"Patrol","wear":{"head":"set0","weapon":"weapon3"},"start":true}]. Free.
${PRODUCT_CLI_NAME} character tune <id> <motion> [--set speed=1.1]… [--off] [--json]   Sliders from ${Object.entries(CHARACTER_TUNING).map(([k, [a, b]]) => `${k} ${a}–${b}`).join(', ')}. Free. Adds a motion you own; --off takes it from the character.
${PRODUCT_CLI_NAME} character pack <id> [--json]                   Put saved changes into a new package and wait. Free.
${PRODUCT_CLI_NAME} character rename <id> --name <name> [--json]
${PRODUCT_CLI_NAME} character remove <id> --yes [--json]           Delete it for good. Games keep their copies, and you keep its gear.
${PRODUCT_CLI_NAME} character install <id> [--project <id>] [--slug <folder>] [--json]   Put the newest package and the player into a Godot, Unity or web game, or update it.
${PRODUCT_CLI_NAME} character installed|uninstall <slug> [--project <id>] [--json]
${PRODUCT_CLI_NAME} character suggest (--text <words> | --prompt-file <path|->) [--armor] [--weapons] [--style ink|cute] [--project <id>] [--json]
    For agents: propose a character. The user sees it on the Characters page and orders it there.`;

type Api = <T>(route: string, method?: string, body?: unknown) => Promise<T>;

async function daemonApi(flagUrl: string | undefined): Promise<Api> {
  const base = (await resolveDaemonUrl({ flagUrl: flagUrl ?? null })).replace(/\/$/u, '');
  const token = process.env.PIXO_TOOL_TOKEN ?? process.env.PIXO_API_TOKEN;
  return async <T>(route: string, method = 'GET', body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${base}/api${route}`, {
        method, headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('OpenPixo could not be reached. Open the app and try again.'); }
    const data = await response.json().catch(() => null) as (T & { error?: { code?: string; message?: string } }) | null;
    if (!response.ok) throw Object.assign(new Error(data?.error?.message ?? 'Something went wrong. Try again.'), { payload: data });
    return data as T;
  };
}

const name = (c: { name: string; id: string }): string => `${c.name} (${c.id})`;
const items = (list: readonly { id: string; label: string }[]): string => list.map(i => i.label ? `${i.id} ${i.label}` : i.id).join(', ') || 'none';

function show(c: LocalCharacter): string {
  return [
    `${name(c)}: ${c.state}, package ${c.revision}${c.changed ? ', changes not packed yet' : ''}, ${c.style}`,
    `  sets: ${items(c.items.sets)}`, `  weapons: ${items(c.items.weapons)}`, `  capes: ${items(c.items.capes)}`, `  motions: ${c.motions.map(m => m.name).join(', ')}`,
    ...(c.outfits.length ? [`  outfits: ${c.outfits.map(o => o.name + (o.start ? ' (start)' : '')).join(', ')}`] : []),
    ...(c.games.length ? [`  games: ${c.games.map(g => `${g.projectName} (package ${g.revision})`).join(', ')}`] : []),
    ...(c.job && c.job.state !== 'succeeded' ? [`  job: ${c.job.kind} ${c.job.state}${c.job.errorCode ? ` (${c.job.errorCode})` : ''}`] : []),
  ].join('\n');
}

function showBrief(b: CharacterBrief): string {
  const { look, clothes, colours, gear, note } = b.shown;
  return [...(b.name ? [b.name] : []), ...[look, clothes, colours, gear, note].filter(Boolean).map(t => `  ${t}`), `Price: ${b.credits} credits (${b.parts.map(p => `${p.part} ${p.credits}`).join(' + ')}). You have ${b.available}.`].join('\n');
}

/** No answer, or one that says nothing about what became of the request. */
const unsure = (error: unknown): boolean => {
  const code = (error as { payload?: { error?: { code?: string } } | null }).payload?.error?.code;
  return code === undefined || code === 'CLOUD_UNAVAILABLE';
};
const pause = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
export const cliTiming = { pollMs: 2_500, tries: 40 };

/** The same order again under the same id until there is an answer, so a lost one is never ordered twice. */
async function order(api: Api, briefId: string): Promise<CharacterJob> {
  const requestId = randomUUID();
  for (let i = 1; ; i++) {
    try { return await api<CharacterJob>('/characters/orders', 'POST', { briefId, requestId }); }
    catch (error) {
      if (!unsure(error)) throw error;
      if (i >= 5) throw new Error('The order got no answer, so it may have been placed. Look with "character mine" before you order again.');
      await pause(cliTiming.pollMs);
    }
  }
}

/** Waits for a job. It goes on in the cloud whatever happens here, so a missed look is no failure of it. */
async function wait(api: Api, jobId: string, say: (line: string) => void): Promise<CharacterJob> {
  let last = '', missed = 0;
  for (;;) {
    let job: CharacterJob;
    try { job = await api<CharacterJob>(`/characters/jobs/${encodeURIComponent(jobId)}`); missed = 0; }
    catch (error) {
      if (unsure(error) && ++missed < cliTiming.tries) { await pause(cliTiming.pollMs); continue; }
      const message = `${error instanceof Error ? error.message : String(error)} The job goes on. Look at it with "${PRODUCT_CLI_NAME} character job ${jobId} --wait"; do not order again.`;
      throw Object.assign(new Error(message), { payload: { error: { message }, jobId } });
    }
    if (job.state !== last) say(last = job.state);
    if (job.state === 'failed') throw Object.assign(new Error(`It failed (${job.errorCode ?? 'unknown'}). Nothing was charged.`), { payload: { error: { code: job.errorCode, message: 'It failed. Nothing was charged.' }, job } });
    if (job.state === 'succeeded') return job;
    await pause(cliTiming.pollMs);
  }
}

export async function runAnimatedCharacterCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, yes: { type: 'boolean' }, wait: { type: 'boolean' }, off: { type: 'boolean' }, armor: { type: 'boolean' }, weapons: { type: 'boolean' }, pieces: { type: 'string' }, project: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' },
      text: { type: 'string' }, 'prompt-file': { type: 'string' }, file: { type: 'string' }, style: { type: 'string' }, body: { type: 'string' }, set: { type: 'string', multiple: true }, 'daemon-url': { type: 'string' },
    } as const });
    json = values.json === true;
    const command = args[0] as (typeof ANIMATED_COMMANDS)[number], api = await daemonApi(values['daemon-url']), [first, second, ...rest] = positionals;
    const takes = (n: number): void => { if (positionals.length !== n || rest.length) throw new Error(ANIMATED_USAGE); };
    const print = (result: unknown, text: string): void => { console.log(json ? JSON.stringify(result, null, 2) : text); };
    const say = (line: string): void => { if (!json) console.error(line); };
    const words = async (): Promise<string> => values['prompt-file'] ? recipeCliText(values['prompt-file']) : values.text ?? (() => { throw new Error('Say what you want with --text or --prompt-file.'); })();
    const project = (): string => { const p = values.project ?? process.env.PIXO_PROJECT_ID; if (!p) throw new Error('--project or PIXO_PROJECT_ID is required'); return `/projects/${encodeURIComponent(p)}/heroes`; };
    const of = (id: string | undefined): string => `/characters/${encodeURIComponent(id ?? '')}`;

    /** Shows the price; orders only with --yes. */
    const buy = async (request: Record<string, unknown>): Promise<void> => {
      const brief = await api<CharacterBrief>('/characters/briefs', 'POST', request);
      if (!values.yes) { print({ brief }, `${showBrief(brief)}\nAdd --yes to order it.`); return; }
      say(showBrief(brief));
      const started = await order(api, brief.briefId);
      say(`Job ${started.id}`);
      const job = await wait(api, started.id, say);
      const character = await api<LocalCharacter>(of(job.characterId));
      print({ job, character }, `Charged ${job.creditsCharged} credits for ${job.delivered?.join(', ')}.\n${show(character)}`);
    };

    switch (command) {
      case 'service': {
        takes(0);
        const s = await api<CharactersStatus>('/characters/service');
        print(s, !s.available ? 'Characters are not available in this build.' : !s.signedIn ? 'Sign in to use characters.' : !s.service ? 'OpenPixo cloud is unavailable.' : `${s.service.paused ? 'Paused. ' : ''}${Object.entries(s.service.prices).map(([k, v]) => `${k} ${v}`).join(', ')} credits`);
        return;
      }
      case 'mine': {
        takes(0);
        const all = await api<CharactersResponse>('/characters');
        print(all, all.characters.map(show).join('\n') || 'No characters yet.');
        return;
      }
      case 'info': { takes(1); const c = await api<LocalCharacter>(of(first)); print(c, show(c)); return; }
      case 'make': {
        takes(0);
        await buy({ kind: 'character', text: await words(), armor: values.armor === true, gear: values.weapons === true, ...(values.style ? { style: values.style } : {}), ...(values.body ? { body: values.body } : {}) });
        return;
      }
      case 'add': {
        takes(2);
        if (!['armor', 'gear', 'motion'].includes(second ?? '')) throw new Error(ANIMATED_USAGE);
        await buy({ kind: second, characterId: first, text: await words() });
        return;
      }
      case 'fit': { takes(2); await buy({ kind: 'fit', characterId: first, design: second }); return; }
      case 'job': {
        takes(1);
        const job = values.wait ? await wait(api, first!, say) : await api<CharacterJob>(`/characters/jobs/${encodeURIComponent(first!)}`);
        print(job, `${job.kind} ${job.state}`);
        return;
      }
      case 'gear': {
        takes(0);
        const g = await api<CharacterGear>('/characters/gear');
        print(g, [...g.designs.map(d => `${d.id} (${d.style}): ${items([...d.sets, ...d.weapons, ...d.capes])}${d.kind === 'armor' ? `; fits ${d.fits.length} characters` : ''}`), ...g.motions.map(m => `motion ${m.name}: ${m.shown}`)].join('\n') || 'No gear yet.');
        return;
      }
      case 'wear': {
        takes(1);
        if (values.pieces === undefined) throw new Error('Say what it wears with --pieces weapon1,cape0,… An empty value takes everything off.');
        const c = await api<LocalCharacter>(of(first), 'PATCH', { gear: values.pieces.split(',').map(s => s.trim()).filter(Boolean) });
        print(c, `${show(c)}\nRun "${PRODUCT_CLI_NAME} character pack ${c.id}" to put it into the package.`);
        return;
      }
      case 'outfits': {
        takes(1);
        if (!values.file) throw new Error('Give the outfits as a JSON file with --file.');
        const c = await api<LocalCharacter>(of(first), 'PATCH', { outfits: JSON.parse(await recipeCliText(values.file)) as unknown });
        print(c, show(c));
        return;
      }
      case 'tune': {
        takes(2);
        const route = `${of(first)}/motions/${encodeURIComponent(second!)}`;
        if (values.off) { const c = await api<LocalCharacter>(route, 'DELETE'); print(c, show(c)); return; }
        const tuning = Object.fromEntries((values.set ?? []).map(entry => {
          const [key, value] = entry.split('='), n = Number(value);
          if (!key || !Object.hasOwn(CHARACTER_TUNING, key) || !Number.isFinite(n)) throw new Error(`--set takes ${Object.keys(CHARACTER_TUNING).join(', ')} with a number, like speed=1.1`);
          return [key, n];
        }));
        const c = await api<LocalCharacter>(route, 'PUT', { tuning });
        print(c, `${show(c)}\nRun "${PRODUCT_CLI_NAME} character pack ${c.id}" to put it into the package.`);
        return;
      }
      case 'pack': {
        takes(1);
        const job = await wait(api, (await api<CharacterJob>(`${of(first)}/pack`, 'POST', { requestId: randomUUID() })).id, say), c = await api<LocalCharacter>(of(first));
        print({ job, character: c }, show(c));
        return;
      }
      case 'rename': { takes(1); const c = await api<LocalCharacter>(of(first), 'PATCH', { name: values.name ?? '' }); print(c, show(c)); return; }
      case 'remove': {
        takes(1);
        if (!values.yes) throw new Error('This deletes the character for good. Games keep their copies, and its gear stays yours. Add --yes to do it.');
        const gone = await api(of(first), 'DELETE');
        print(gone, 'Deleted.');
        return;
      }
      case 'install': {
        takes(1);
        const c = await api<InstalledCharacter & { playerState: string }>(project(), 'POST', { characterId: first, ...(values.slug ? { slug: values.slug } : {}) });
        print(c, `${c.name}, package ${c.revision}: ${c.folder}\nPlayer: ${c.player}${c.playerState === 'edited' ? ' (changed by hand, so it was left alone)' : ''}\nHow to use it: ${c.folder}/README.md`);
        return;
      }
      case 'installed': {
        takes(0);
        const all = await api<InstalledCharactersResponse>(project());
        print(all, all.characters.map(c => `${c.slug}: ${c.name}, package ${c.revision}, ${c.folder}`).join('\n') || 'No characters in this game.');
        return;
      }
      case 'uninstall': { takes(1); const gone = await api(`${project()}/${encodeURIComponent(first!)}`, 'DELETE'); print(gone, 'Taken out of the game.'); return; }
      case 'suggest': {
        takes(0);
        const s = await api<CharacterSuggestion>(`${project()}/suggest`, 'POST', { text: await words(), armor: values.armor === true, gear: values.weapons === true, ...(values.style ? { style: values.style } : {}) });
        print(s, 'Proposed. The user sees it on the Characters page with its price and orders it there. Nothing was charged.');
        return;
      }
      default: throw new Error(ANIMATED_USAGE);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error), payload = (error as { payload?: unknown }).payload;
    if (json) console.log(JSON.stringify(payload ?? { error: { message } })); else console.error(message);
    process.exitCode = 5;
  }
}
