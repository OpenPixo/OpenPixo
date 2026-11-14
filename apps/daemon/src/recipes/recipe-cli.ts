import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChatRunStatus, ChatRunStatusResponse, GenerateReferenceResponse, RecipeRun, RecipeRunQuote, RecipeRunResponse } from '@openpixo/contracts';
import { parseRecipeInputs, recipeCliApi, recipeCliError, recipeCliText, recipeCliUpload } from './cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} recipe list [--surface image|audio|video|model3d|code] [--category <category>] [--engine <engine>] [--json]
${PRODUCT_CLI_NAME} recipe show <id> [--json]
${PRODUCT_CLI_NAME} recipe quote <id> [--project <id> | --no-game] [same inputs and options as run] [--json]
${PRODUCT_CLI_NAME} recipe run <id> [--project <id> | --no-game] [--input k=v]... [--inputs-file <path|->] [--prompt-file <path|->]
                     [--model <id>] [--style <id|none>] [--count N] [--quote <quoteId>] [--wait] [--timeout <seconds>] [--json]
${PRODUCT_CLI_NAME} recipe runs [--project <id> | --no-game] [--surface image|audio|video|model3d] [--origin user|agent] [--limit N] [--json]
${PRODUCT_CLI_NAME} recipe status <runId> [--json]
${PRODUCT_CLI_NAME} recipe adopt <runId> --candidate <id>... --project <id> [--json]
${PRODUCT_CLI_NAME} recipe cancel <runId> [--json]
${PRODUCT_CLI_NAME} recipe reference <picture> [--json]
Runs stage candidates only. Inspect candidates, then explicitly adopt them into a game.
Without --project (or PIXO_PROJECT_ID), or with --no-game, a run belongs to no game, like one made on the
Generate (生成) page: its references are pictures uploaded with \`reference\`, and \`adopt --project\` saves it into any game.
\`runs\` with no game option lists every run on this machine.
A run that spends credits needs a price you confirmed: \`quote\` prices it, then \`run … --quote <quoteId>\`
with the same inputs and options spends exactly that. An agent's runs are paid from the art budget instead.
--wait exits 0 when ready, 2 while running after timeout (default 300s), 5 on failure/cancellation.`;

export function recipeWaitExitCode(status: RecipeRun['status']): 0 | 2 | 5 {
  return status === 'ready' ? 0 : status === 'failed' || status === 'cancelled' ? 5 : 2;
}
export function codeRecipeWaitExitCode(status: ChatRunStatus): 0 | 2 | 5 {
  return status === 'succeeded' ? 0 : status === 'failed' || status === 'canceled' ? 5 : 2;
}
export async function runRecipeCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const command = args[0];
    if (!['list', 'show', 'quote', 'run', 'runs', 'status', 'adopt', 'cancel', 'reference'].includes(command!)) throw new Error(USAGE);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, project: { type: 'string' }, 'no-game': { type: 'boolean' }, 'daemon-url': { type: 'string' },
      surface: { type: 'string' }, category: { type: 'string' }, engine: { type: 'string' },
      input: { type: 'string', multiple: true }, 'inputs-file': { type: 'string' }, 'prompt-file': { type: 'string' },
      model: { type: 'string' }, style: { type: 'string' }, count: { type: 'string' }, candidate: { type: 'string', multiple: true },
      wait: { type: 'boolean' }, timeout: { type: 'string' }, quote: { type: 'string' }, origin: { type: 'string' }, limit: { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length !== (command === 'list' || command === 'runs' ? 0 : 1)) throw new Error(USAGE);
    const api = await recipeCliApi(values['daemon-url']);
    const id = encodeURIComponent(positionals[0] ?? '');
    let result: unknown;
    if (command === 'list') {
      const query = new URLSearchParams();
      for (const key of ['surface', 'category', 'engine'] as const) if (values[key]) query.set(key, values[key]);
      result = await api(`/api/recipes?${query}`);
    } else if (command === 'show') result = await api(`/api/recipes/${id}`);
    else if (command === 'reference') {
      const file = positionals[0]!;
      const reference = await recipeCliUpload(values['daemon-url'], '/api/generate/references', await readFile(file), path.basename(file)) as GenerateReferenceResponse;
      if (!json) { console.log(`${reference.ref}
Use it as a reference input of a run with no game, e.g. --input reference=${reference.ref}`); return; }
      result = reference;
    } else {
      if (values['no-game'] && values.project) throw new Error('--project and --no-game cannot be used together');
      // An agent's shell names its game in PIXO_PROJECT_ID; a terminal without one makes art for no game.
      const project = values['no-game'] ? null : values.project || process.env.PIXO_PROJECT_ID || null;
      const prefix = '/api/generate/runs';
      // A quote and the run it pays for are built the same way, so the same flags ask for the same run.
      const runBody = async () => {
        if (values['inputs-file'] === '-' && values['prompt-file'] === '-') throw new Error('Only one file option may read stdin');
        const inputs = parseRecipeInputs(values['inputs-file'] ? await recipeCliText(values['inputs-file']) : '{}', values.input);
        const count = values.count === undefined ? undefined : Number(values.count);
        if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 32)) throw new Error('--count must be an integer from 1 to 32');
        return { recipeId: positionals[0], projectId: project, inputs,
          ...(count !== undefined ? { count } : {}), ...(values.model ? { model: values.model } : {}),
          ...(values.style !== undefined ? { styleId: values.style === 'none' ? null : values.style } : {}),
          ...(values['prompt-file'] ? { prompt: await recipeCliText(values['prompt-file']) } : {}) };
      };
      if (command === 'runs') {
        const query = new URLSearchParams();
        if (project) query.set('projectId', project);
        else if (values['no-game']) query.set('noGame', '1');
        if (values.surface) query.set('surface', values.surface);
        if (values.origin) query.set('origin', values.origin);
        if (values.limit) query.set('limit', values.limit);
        result = await api(`${prefix}?${query}`);
      } else if (command === 'quote') {
        const quote = await api('/api/generate/quote', 'POST', await runBody()) as RecipeRunQuote;
        if (!json) {
          console.log(quote.paid
            ? `${quote.credits} credits for ${quote.count} candidate${quote.count === 1 ? '' : 's'} (${quote.available} available, price held until ${quote.expiresAt}).\nRun it with the same inputs and options plus: --quote ${quote.quoteId}`
            : `Free: ${quote.model.id} makes it with your own tools. Run it without --quote.`);
          return;
        }
        result = quote;
      } else if (command === 'run') {
        const timeout = values.timeout === undefined ? 300 : Number(values.timeout);
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 3600) throw new Error('--timeout must be 0..3600 seconds');
        let run = await api(prefix, 'POST', { ...await runBody(), ...(values.quote ? { quoteId: values.quote } : {}) }) as RecipeRunResponse;
        result = run;
        if (values.wait && 'candidates' in run) {
          const deadline = Date.now() + timeout * 1000;
          while (recipeWaitExitCode(run.status) === 2 && Date.now() < deadline) {
            await delay(Math.min(1000, deadline - Date.now()));
            run = await api(`${prefix}/${encodeURIComponent(run.id)}`) as RecipeRun;
          }
          process.exitCode = recipeWaitExitCode(run.status);
          result = run;
        } else if (values.wait && 'runId' in run && run.runId) {
          const deadline = Date.now() + timeout * 1000;
          let chatRun = await api(`/api/runs/${encodeURIComponent(run.runId)}`) as ChatRunStatusResponse;
          while (codeRecipeWaitExitCode(chatRun.status) === 2 && Date.now() < deadline) {
            await delay(Math.min(1000, deadline - Date.now()));
            chatRun = await api(`/api/runs/${encodeURIComponent(run.runId)}`) as ChatRunStatusResponse;
          }
          process.exitCode = codeRecipeWaitExitCode(chatRun.status);
          result = { ...run, chatRun };
        }
      } else if (command === 'adopt') {
        if (!values.candidate?.length) throw new Error('--candidate is required (repeat for multiple candidates)');
        if (!project) throw new Error('--project is required: the game to save into');
        result = await api(`${prefix}/${id}/adopt`, 'POST', { projectId: project, candidateIds: values.candidate });
      } else result = await api(`${prefix}/${id}${command === 'cancel' ? '/cancel' : ''}`, command === 'cancel' ? 'POST' : 'GET');
    }
    console.log(JSON.stringify(result, null, json ? 2 : undefined));
  } catch (error) { recipeCliError(error, json); }
}
