import { PRODUCT_CLI_NAME, type RoomsInstallResponse, type RoomsLimitRequest, type RoomsStatusResponse, type RoomsTestRequest, type RoomsTestResponse } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { printCliFailure, projectApi } from '../publish/cli.js';

const USAGE = `${PRODUCT_CLI_NAME} rooms add [--project <id>] [--json]
    Add the live rooms SDK to this web game.
${PRODUCT_CLI_NAME} rooms test [--project <id>] [--url <local game url>] [--json]
    Print two URLs of the running game wired to the local relay. Starts the game when it is not
    running; an agent starts its own dev server and passes --url. No account or credits needed.
${PRODUCT_CLI_NAME} rooms status [--project <id>] [--json]
${PRODUCT_CLI_NAME} rooms limit <credits> [--project <id>] [--json]
    Set this game's monthly room spending limit. Only the creator can change it.`;

function printStatus(status: RoomsStatusResponse): void {
  console.log(status.sdkInstalled ? `SDK: ${status.sdkPath}` : `SDK: not added. Run ${PRODUCT_CLI_NAME} rooms add`);
  if (status.cloudUnknown) { console.log('Sign in and check your connection to see whether rooms are open and what they have used.'); return; }
  console.log(`Rooms: ${status.paused ? 'not open yet' : 'open'}, up to ${status.maxPlayers} players`);
  if (!status.usage) { console.log('Usage appears once the game is published and you are signed in.'); return; }
  const { usage } = status;
  console.log(`This month (${usage.month}): ${usage.playerMinutes} player-minutes, ${usage.creditsCharged} credits charged, limit ${usage.monthlyCreditLimit} credits`);
  console.log(`Free time used on your account: ${usage.freeMinutesUsed} of ${usage.freeMinutesTotal} minutes. Then ${status.creditsPerPlayerHour} credits per player-hour.`);
  console.log(`Open rooms: ${usage.openRooms}`);
}

export async function runRoomsCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      json: { type: 'boolean' }, project: { type: 'string' }, url: { type: 'string' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    const [command, argument] = positionals;
    const expected = command === 'limit' ? 2 : 1;
    if (!['add', 'test', 'status', 'limit'].includes(command ?? '') || positionals.length !== expected) throw new Error(`Usage: ${USAGE}`);
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error(`Project id required: pass --project <id>.\n${USAGE}`);
    const api = await projectApi(values['daemon-url'], projectId);
    const print = (result: unknown, text: () => void) => { if (json) console.log(JSON.stringify(result, null, 2)); else text(); };

    if (command === 'add') {
      const result = await api<RoomsInstallResponse>('/rooms/install', 'POST', {});
      print(result, () => console.log(result.changed ? `Added the rooms SDK at ${result.sdkPath}` : `The rooms SDK at ${result.sdkPath} is already up to date.`));
    } else if (command === 'test') {
      const request: RoomsTestRequest = values.url ? { gameUrl: values.url } : {};
      const result = await api<RoomsTestResponse>('/rooms/test', 'POST', request);
      print(result, () => console.log(`Open each URL in its own window:\n  ${result.urls[0]}\n  ${result.urls[1]}\nThese test links are free and only work on this computer.`));
    } else if (command === 'limit') {
      const credits = Number(argument);
      if (!Number.isSafeInteger(credits) || credits < 0) throw new Error('The limit must be a whole number of credits, from 0 to 10,000,000.');
      const body: RoomsLimitRequest = { monthlyCreditLimit: credits };
      const result = await api<RoomsStatusResponse>('/rooms', 'PATCH', body);
      print(result, () => console.log(`Monthly limit set to ${result.usage?.monthlyCreditLimit ?? credits} credits.`));
    } else {
      const result = await api<RoomsStatusResponse>('/rooms');
      print(result, () => printStatus(result));
    }
  } catch (error) {
    printCliFailure(error, json);
  }
}
