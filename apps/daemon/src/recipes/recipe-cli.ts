import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChatRunStatus, ChatRunStatusResponse, RecipeRun, RecipeRunResponse } from '@openpixo/contracts';
import { parseRecipeInputs, recipeCliApi, recipeCliError, recipeCliText } from './cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} recipe list [--surface image|audio|video|model3d|code] [--category <category>] [--engine <engine>] [--json]
${PRODUCT_CLI_NAME} recipe show <id> [--json]
${PRODUCT_CLI_NAME} recipe run <id> [--project <id>] [--input k=v]... [--inputs-file <path|->] [--prompt-file <path|->]
                     [--model <id>] [--style <id|none>] [--count N] [--wait] [--timeout <seconds>] [--json]
${PRODUCT_CLI_NAME} recipe status <runId> [--project <id>] [--json]
${PRODUCT_CLI_NAME} recipe adopt <runId> --candidate <id>... [--project <id>] [--json]
${PRODUCT_CLI_NAME} recipe cancel <runId> [--project <id>] [--json]
Runs stage candidates only. Inspect candidates, then explicitly adopt them.
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
    if (!['list', 'show', 'run', 'status', 'adopt', 'cancel'].includes(command!)) throw new Error(USAGE);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, project: { type: 'string' }, 'daemon-url': { type: 'string' },
      surface: { type: 'string' }, category: { type: 'string' }, engine: { type: 'string' },
      input: { type: 'string', multiple: true }, 'inputs-file': { type: 'string' }, 'prompt-file': { type: 'string' },
      model: { type: 'string' }, style: { type: 'string' }, count: { type: 'string' }, candidate: { type: 'string', multiple: true },
      wait: { type: 'boolean' }, timeout: { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length !== (command === 'list' ? 0 : 1)) throw new Error(USAGE);
    const api = await recipeCliApi(values['daemon-url']);
    const id = encodeURIComponent(positionals[0] ?? '');
    let result: unknown;
    if (command === 'list') {
      const query = new URLSearchParams();
      for (const key of ['surface', 'category', 'engine'] as const) if (values[key]) query.set(key, values[key]);
      result = await api(`/api/recipes?${query}`);
    } else if (command === 'show') result = await api(`/api/recipes/${id}`);
    else {
      const project = values.project ?? process.env.PIXO_PROJECT_ID;
      if (!project) throw new Error('--project or PIXO_PROJECT_ID is required');
      const prefix = `/api/projects/${encodeURIComponent(project)}/recipe-runs`;
      if (command === 'run') {
        if (values['inputs-file'] === '-' && values['prompt-file'] === '-') throw new Error('Only one file option may read stdin');
        const inputs = parseRecipeInputs(values['inputs-file'] ? await recipeCliText(values['inputs-file']) : '{}', values.input);
        const count = values.count === undefined ? undefined : Number(values.count);
        if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 32)) throw new Error('--count must be an integer from 1 to 32');
        const timeout = values.timeout === undefined ? 300 : Number(values.timeout);
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 3600) throw new Error('--timeout must be 0..3600 seconds');
        let run = await api(prefix, 'POST', { recipeId: positionals[0], inputs,
          ...(count !== undefined ? { count } : {}), ...(values.model ? { model: values.model } : {}),
          ...(values.style !== undefined ? { styleId: values.style === 'none' ? null : values.style } : {}),
          ...(values['prompt-file'] ? { prompt: await recipeCliText(values['prompt-file']) } : {}) }) as RecipeRunResponse;
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
        result = await api(`${prefix}/${id}/adopt`, 'POST', { candidateIds: values.candidate });
      } else result = await api(`${prefix}/${id}${command === 'cancel' ? '/cancel' : ''}`, command === 'cancel' ? 'POST' : 'GET');
    }
    console.log(JSON.stringify(result, null, json ? 2 : undefined));
  } catch (error) { recipeCliError(error, json); }
}
