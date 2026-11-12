import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  PRODUCT_CLI_NAME, type OnlineDataResponse, type OnlineInstallResponse, type OnlineSeedRequest, type OnlineSeedResponse,
  type OnlineStatusResponse, type OnlineTestRequest, type OnlineTestResponse, type OnlineUsage,
} from '@openpixo/contracts';
import { printCliFailure, projectApi } from '../publish/cli.js';

const USAGE = `${PRODUCT_CLI_NAME} online add [--project <id>] [--json]
    Add the online SDK (leaderboards, saves, async battles, racing ghosts) to this web game.
${PRODUCT_CLI_NAME} online status [--project <id>] [--json]
    Whether the SDK is in the game, local test data, and this month's use once published.
${PRODUCT_CLI_NAME} online test [--project <id>] [--url <local game url>] [--json]
    Print the running game's URL wired to the local test backend. Starts the game when it is not
    running; an agent starts its own dev server and passes --url. No account needed.
${PRODUCT_CLI_NAME} online seed [--players 20] [--collection <name>] [--key <name>] [--from <json file|->] [--project <id>] [--json]
    Add fake players to the local test data. Each gets an entry shaped like the newest real one,
    or like the JSON in --from, in the named collection or every collection the game uses.
${PRODUCT_CLI_NAME} online data [--collection <name>] [--project <id>] [--json]
    Count the local test data, or list a collection's newest entries.
${PRODUCT_CLI_NAME} online reset [--project <id>] [--json]
    Delete the local test data.
${PRODUCT_CLI_NAME} online reset --hosted --yes [--project <id>] [--json]
    Delete every player and save of the published game. Only the creator can, and it cannot be undone.`;

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
const number = (value: number) => value.toLocaleString('en-US');

function printCollections(collections: Record<string, number>, indent = '  '): void {
  for (const [name, count] of Object.entries(collections)) console.log(`${indent}${name}: ${number(count)}`);
}

const STATE_TEXT: Record<NonNullable<OnlineUsage['stateReason']>, string> = {
  'no-plan': 'Read-only: this account has no plan. Players can still see scores and saves, but nothing new is saved. Choose a plan to turn saving back on.',
  'requests-cap': "Read-only: this month's online requests are used up. Saving starts again next month, or at once on a bigger plan.",
  'storage-cap': 'Read-only: saved data reached the plan\'s storage. Clear old data or move to a bigger plan.',
  paused: 'Online features are not open yet. The game\'s code is ready and starts working when they open.',
};

function printStatus(status: OnlineStatusResponse): void {
  console.log(status.sdkInstalled ? `SDK: ${status.sdkPath}` : `SDK: not added. Run ${PRODUCT_CLI_NAME} online add`);
  console.log(`Local test data: ${number(status.local.players)} players`);
  printCollections(status.local.collections);
  if (status.cloudUnknown) { console.log('Sign in and check your connection to see what the public game has used.'); return; }
  if (!status.usage) { console.log('Use on the public link appears once the game is published and you are signed in.'); return; }
  const { usage } = status;
  console.log(`This month (${usage.month}), this game: ${number(usage.gameRequests)} requests, ${megabytes(usage.gameBytes)} stored, ${number(usage.players)} players`);
  console.log(`Your account: ${number(usage.accountRequests)} of ${number(usage.maxRequests)} requests, ${megabytes(usage.accountBytes)} of ${megabytes(usage.maxBytes)} stored`);
  if (usage.state !== 'ok') console.log(STATE_TEXT[usage.stateReason ?? (usage.state === 'paused' ? 'paused' : 'requests-cap')]);
  if (usage.idleDeleteAt) console.log(`Nobody has used this game's online features for 90 days. Its online data is deleted on ${usage.idleDeleteAt.slice(0, 10)} unless someone plays.`);
  printCollections(usage.collections);
}

async function readSeedData(from: string): Promise<unknown> {
  const text = from === '-' ? await new Promise<string>((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  }) : await readFile(from, 'utf8');
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error(`${from === '-' ? 'Standard input' : from} is not JSON.`); }
}

export async function runOnlineCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      json: { type: 'boolean' }, project: { type: 'string' }, url: { type: 'string' }, 'daemon-url': { type: 'string' },
      players: { type: 'string' }, collection: { type: 'string' }, key: { type: 'string' }, from: { type: 'string' },
      hosted: { type: 'boolean' }, yes: { type: 'boolean' },
    } });
    json = values.json === true;
    const [command] = positionals;
    if (!['add', 'status', 'test', 'seed', 'data', 'reset'].includes(command ?? '') || positionals.length !== 1) throw new Error(`Usage: ${USAGE}`);
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error(`Project id required: pass --project <id>.\n${USAGE}`);
    let players: number | undefined;
    if (values.players !== undefined) {
      players = Number(values.players);
      if (!Number.isInteger(players) || players < 1) throw new Error('--players must be a whole number above 0.');
    }
    if (command === 'reset' && values.hosted && !values.yes) {
      throw new Error(`This deletes every player and save of the public game, and cannot be undone. Run ${PRODUCT_CLI_NAME} online reset --hosted --yes to go ahead.`);
    }
    const seedData = command === 'seed' && values.from !== undefined ? await readSeedData(values.from) : undefined;
    const api = await projectApi(values['daemon-url'], projectId);
    const print = (result: unknown, text: () => void) => { if (json) console.log(JSON.stringify(result, null, 2)); else text(); };

    if (command === 'add') {
      const result = await api<OnlineInstallResponse>('/online/install', 'POST', {});
      print(result, () => console.log(result.changed ? `Added the online SDK at ${result.sdkPath}` : `The online SDK at ${result.sdkPath} is already up to date.`));
    } else if (command === 'test') {
      const request: OnlineTestRequest = values.url ? { gameUrl: values.url } : {};
      const result = await api<OnlineTestResponse>('/online/test', 'POST', request);
      print(result, () => console.log(`Open this URL to play against the local test data:\n  ${result.url}\nIt is free and only works on this computer. Open it in a second browser to be a second player.`));
    } else if (command === 'seed') {
      const request: OnlineSeedRequest = { ...(players !== undefined ? { players } : {}), ...(values.collection ? { collection: values.collection } : {}),
        ...(values.key ? { key: values.key } : {}), ...(seedData !== undefined ? { data: seedData } : {}) };
      const result = await api<OnlineSeedResponse>('/online/seed', 'POST', request);
      print(result, () => console.log(`Added ${number(result.players)} test players with ${number(result.docs)} entries.`
        + (result.docs ? '' : ' The game has no saved entries yet, so they have none: save one, or pass --collection.')));
    } else if (command === 'data') {
      const query = values.collection ? `?collection=${encodeURIComponent(values.collection)}` : '';
      const result = await api<OnlineDataResponse>(`/online/data${query}`);
      print(result, () => {
        console.log(`Local test data: ${number(result.players)} players`);
        printCollections(result.collections);
        for (const doc of result.docs ?? []) {
          console.log(`  ${doc.name} (${doc.player}) ${doc.key}: score ${doc.score ?? '-'}, rating ${doc.rating}, ${doc.updatedAt}`);
        }
      });
    } else if (command === 'reset') {
      if (values.hosted) {
        const result = await api<{ ok: true }>('/online/hosted', 'DELETE');
        print(result, () => console.log("Deleted the public game's online data. Players start fresh the next time they play."));
      } else {
        const result = await api<OnlineDataResponse>('/online/data', 'DELETE');
        print(result, () => console.log('Deleted the local test data.'));
      }
    } else {
      const result = await api<OnlineStatusResponse>('/online');
      print(result, () => printStatus(result));
    }
  } catch (error) {
    printCliFailure(error, json);
  }
}
