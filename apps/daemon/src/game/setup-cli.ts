import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  GAME_ART_SOURCES,
  GAME_CONTROL_SCHEMES,
  GAME_LANGUAGES,
  GAME_MILESTONES,
  GAME_OS_TARGETS,
  GAME_PERSPECTIVES,
  GAME_PLAYER_MODES,
  GAME_PLAYTIMES,
  GAME_PRICE_TIERS,
  GAME_SCALING_MODES,
  GAME_SCOPES,
  GAME_SETUP_LIMITS,
  GAME_STEAM_FEATURES,
  GAME_STORES,
  GAME_TARGET_PLATFORMS,
  PRODUCT_CLI_NAME,
  gamePlatformsForStores,
  parseGameProjectSetup,
  parseGameResolution,
  type GameProjectSetup,
  type GameProjectSetupResponse,
  type GameStore,
} from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

/** String flags shared by `project create-game` and `project game-setup`. */
export const GAME_SETUP_CLI_FLAGS = [
  'title', 'studio', 'genre', 'pitch', 'perspective', 'comparable', 'players', 'scope', 'steam-later',
  'store', 'os', 'steam-app-id', 'steam-features', 'milestone', 'playtime', 'price', 'language',
  'platform', 'style', 'art-direction', 'art-source', 'palette', 'pixel-size',
  'reference', 'resolution', 'scaling', 'controls', 'notes', 'setup-file',
] as const;

export const GAME_SETUP_CLI_USAGE = `Setup flags (the new-project wizard's answers; all optional):
  --title <text>             The game's public title; also names the project.
  --studio <text>            Studio or developer name.
  --genre <text>             e.g. "metroidvania"
  --pitch <text>             One-line concept.
  --perspective <id>         ${GAME_PERSPECTIVES.join('|')}
  --comparable <list>        Up to ${GAME_SETUP_LIMITS.comparables} similar games, comma-separated.
  --players <list>           ${GAME_PLAYER_MODES.join(',')}
  --scope <id>               ${GAME_SCOPES.join('|')}: a game playable in 2-4 hours of work, 3-15 days, or a month or more.
  --steam-later <yes|no>     A long project you mean to put on Steam one day.
  --language <list>          ${GAME_LANGUAGES.join(',')}
Release flags from older setups (the new-game dialog no longer asks these):
  --store <list>             ${GAME_STORES.join(',')} (sets --platform when that is not given)
  --os <list>                ${GAME_OS_TARGETS.join(',')}
  --steam-app-id <digits>    Your real Steam App ID.
  --steam-features <list>    ${GAME_STEAM_FEATURES.join(',')}
  --milestone <id>           ${GAME_MILESTONES.join('|')}
  --playtime <id>            ${GAME_PLAYTIMES.join('|')}
  --price <id>               ${GAME_PRICE_TIERS.join('|')} (US dollars)
  --platform <list>          ${GAME_TARGET_PLATFORMS.join(',')}
  --style <id>               Installed art style (also the project default style).
  --art-direction <text>     Look in your own words.
  --art-source <id>          ${GAME_ART_SOURCES.join('|')}
  --palette <list>           Hex colours, e.g. "#182238,#F0D8A8".
  --pixel-size <n>           Tile/sprite grid unit in pixels.
  --reference <list>         Project-relative reference image paths.
  --resolution <WxH>         Base game resolution, e.g. 640x360.
  --scaling <mode>           ${GAME_SCALING_MODES.join('|')}
  --controls <list>          ${GAME_CONTROL_SCHEMES.join(',')}
  --notes <text>             Anything else the agent should know.
  --setup-file <path|->      JSON GameProjectSetup; flags override its fields.`;

type SetupFlags = Readonly<Record<string, unknown>>;

const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);

async function readSetupFile(source: string): Promise<unknown> {
  let raw: string;
  if (source === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    raw = Buffer.concat(chunks).toString('utf8');
  } else raw = await readFile(source, 'utf8');
  try { return JSON.parse(raw); } catch { throw new Error('--setup-file must contain a JSON object'); }
}

/**
 * Build a setup from CLI flags on top of `base`. Returns undefined when no
 * setup flag was given, so callers can tell "no change" from "empty setup".
 * Validation is the daemon's shared schema; this only shapes the input.
 */
export async function gameSetupFromCliFlags(flags: SetupFlags, base?: GameProjectSetup | null): Promise<GameProjectSetup | undefined> {
  const given = GAME_SETUP_CLI_FLAGS.filter(name => typeof flags[name] === 'string');
  if (!given.length) return undefined;
  const str = (name: (typeof GAME_SETUP_CLI_FLAGS)[number]) => typeof flags[name] === 'string' ? (flags[name] as string) : undefined;
  const fromFile = str('setup-file') ? await readSetupFile(str('setup-file')!) : undefined;
  if (fromFile !== undefined && (!fromFile || typeof fromFile !== 'object' || Array.isArray(fromFile))) {
    throw new Error('--setup-file must contain a JSON object');
  }
  const setup = { ...(base ?? {}), ...(fromFile as GameProjectSetup | undefined) } as Record<string, unknown>;
  const art = { ...(setup.art as object | undefined) } as Record<string, unknown>;
  const release = { ...(setup.release as object | undefined) } as Record<string, unknown>;
  if (str('title') !== undefined) setup.title = str('title');
  if (str('studio') !== undefined) setup.studio = str('studio');
  if (str('perspective') !== undefined) setup.perspective = str('perspective') || undefined;
  if (str('comparable') !== undefined) setup.comparables = list(str('comparable')!);
  if (str('players') !== undefined) setup.players = list(str('players')!);
  if (str('store') !== undefined) {
    release.stores = list(str('store')!);
    if (str('platform') === undefined) setup.platforms = gamePlatformsForStores((release.stores as string[]).filter((id): id is GameStore => (GAME_STORES as readonly string[]).includes(id)));
  }
  if (str('os') !== undefined) release.os = list(str('os')!);
  if (str('steam-app-id') !== undefined) release.steamAppId = str('steam-app-id') || undefined;
  if (str('steam-features') !== undefined) release.steamFeatures = list(str('steam-features')!);
  if (str('milestone') !== undefined) release.milestone = str('milestone') || undefined;
  if (str('playtime') !== undefined) release.playtime = str('playtime') || undefined;
  if (str('price') !== undefined) release.price = str('price') || undefined;
  if (str('language') !== undefined) release.languages = list(str('language')!);
  if (str('scope') !== undefined) setup.scope = str('scope') || undefined;
  if (str('steam-later') !== undefined) {
    const answer = str('steam-later')!.trim().toLowerCase();
    if (!['yes', 'no', 'true', 'false'].includes(answer)) throw new Error('--steam-later must be yes or no');
    release.steamLater = answer === 'yes' || answer === 'true' ? true : undefined;
  }
  if (Object.keys(release).length) setup.release = release;
  if (str('art-source') !== undefined) art.source = str('art-source') || undefined;
  if (str('genre') !== undefined) setup.genre = str('genre');
  if (str('pitch') !== undefined) setup.pitch = str('pitch');
  if (str('platform') !== undefined) setup.platforms = list(str('platform')!);
  if (str('controls') !== undefined) setup.controls = list(str('controls')!);
  if (str('notes') !== undefined) setup.notes = str('notes');
  if (str('style') !== undefined) art.styleId = str('style') || undefined;
  if (str('art-direction') !== undefined) art.direction = str('art-direction');
  if (str('palette') !== undefined) art.palette = list(str('palette')!);
  if (str('reference') !== undefined) art.references = list(str('reference')!);
  if (str('pixel-size') !== undefined) {
    const size = Number(str('pixel-size'));
    if (!Number.isInteger(size)) throw new Error('--pixel-size must be a whole number');
    art.pixelSize = size;
  }
  if (Object.keys(art).length) setup.art = art;
  if (str('resolution') !== undefined || str('scaling') !== undefined) {
    const previous = setup.display as GameProjectSetup['display'];
    const size = str('resolution') !== undefined ? parseGameResolution(str('resolution')!) : previous ?? null;
    if (!size) throw new Error('--resolution must be WIDTHxHEIGHT, e.g. 640x360');
    setup.display = { width: size.width, height: size.height,
      ...(str('scaling') ? { scaling: str('scaling') } : previous?.scaling ? { scaling: previous.scaling } : {}) };
  }
  const parsed = parseGameProjectSetup(setup);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.setup;
}

const STEP_LABELS = { basics: 'Basics (genre, size)', art: 'Art direction', setup: 'Project setup (resolution, controls)' } as const;

export function formatGameSetup(result: GameProjectSetupResponse): string {
  const setup = result.setup;
  const lines = [result.missingSteps.length
    ? `Game setup: ${result.missingSteps.length} step(s) to finish — ${result.missingSteps.map(step => STEP_LABELS[step]).join('; ')}`
    : 'Game setup: complete'];
  if (!setup) return lines.join('\n');
  const row = (label: string, value: string | undefined) => { if (value) lines.push(`${label}\t${value}`); };
  row('title', setup.title);
  row('studio', setup.studio);
  row('genre', setup.genre);
  row('perspective', setup.perspective);
  row('pitch', setup.pitch);
  row('comparables', setup.comparables?.join(','));
  row('players', setup.players?.join(','));
  row('scope', setup.scope);
  row('steam-later', setup.release?.steamLater ? 'yes' : undefined);
  row('stores', setup.release?.stores?.join(','));
  row('os', setup.release?.os?.join(','));
  row('steam-app-id', setup.release?.steamAppId);
  row('steam-features', setup.release?.steamFeatures?.join(','));
  row('milestone', setup.release?.milestone);
  row('playtime', setup.release?.playtime);
  row('price', setup.release?.price);
  row('languages', setup.release?.languages?.join(','));
  row('platforms', setup.platforms?.join(','));
  row('art-source', setup.art?.source);
  row('style', setup.art?.styleId);
  row('direction', setup.art?.direction);
  row('palette', setup.art?.palette?.join(','));
  row('pixel-size', setup.art?.pixelSize?.toString());
  row('references', setup.art?.references?.join(','));
  row('resolution', setup.display ? `${setup.display.width}x${setup.display.height}${setup.display.scaling ? ` ${setup.display.scaling}` : ''}` : undefined);
  row('controls', setup.controls?.join(','));
  row('notes', setup.notes);
  return lines.join('\n');
}

const USAGE = `Usage: ${PRODUCT_CLI_NAME} project game-setup <projectId> [setup flags] [--clear] [--json] [--daemon-url <url>]

Show the game's setup, or update it: given flags replace those fields and keep the rest.
--clear removes the setup (the project art style stays).

${GAME_SETUP_CLI_USAGE}
`;

/** The CLI and the web wizard share GET/PUT /api/projects/:id/game-setup. */
export async function runProjectGameSetupCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      json: { type: 'boolean' }, clear: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      'daemon-url': { type: 'string' },
      ...Object.fromEntries(GAME_SETUP_CLI_FLAGS.map(name => [name, { type: 'string' as const }])),
    } });
    json = values.json === true;
    if (values.help) { process.stdout.write(USAGE); return; }
    const projectId = positionals[0];
    if (!projectId?.trim() || positionals.length !== 1) throw new Error(USAGE.trim());
    const base = (await resolveDaemonUrl({ flagUrl: (values['daemon-url'] as string | undefined) ?? null })).replace(/\/+$/u, '');
    const headers: Record<string, string> = { Accept: 'application/json', Origin: new URL(base).origin };
    const endpoint = `${base}/api/projects/${encodeURIComponent(projectId)}/game-setup`;
    const call = async (init?: RequestInit) => {
      const response = await fetch(endpoint, { ...init, headers: { ...headers, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(10_000) });
      const body = await response.json() as GameProjectSetupResponse & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `Game setup request failed (${response.status})`);
      return body;
    };
    let result = await call();
    const next = values.clear ? null : await gameSetupFromCliFlags(values as SetupFlags, result.setup);
    if (next !== undefined) result = await call({ method: 'PUT', body: JSON.stringify({ setup: next }) });
    process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatGameSetup(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
