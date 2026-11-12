import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { recipeCliApi, recipeCliError, recipeCliText } from './cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} character list [--project <id>] [--json]
${PRODUCT_CLI_NAME} character show|delete <slug> [--project <id>] [--json]
${PRODUCT_CLI_NAME} character create|update <slug> [--name <name>] [--description <text> | --prompt-file <path|->]
  [--reference <project-relative-path>]... [--style <style>] [--notes <text>] [--file <json-path|->] [--project <id>] [--json]`;

export async function runCharacterCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const command = args[0];
    if (!['list', 'show', 'create', 'update', 'delete'].includes(command!)) throw new Error(USAGE);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, project: { type: 'string' }, 'daemon-url': { type: 'string' },
      name: { type: 'string' }, description: { type: 'string' }, style: { type: 'string' }, notes: { type: 'string' },
      reference: { type: 'string', multiple: true }, file: { type: 'string' }, 'prompt-file': { type: 'string' },
    } });
    json = values.json === true;
    const project = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!project) throw new Error('--project or PIXO_PROJECT_ID is required');
    if (positionals.length !== (command === 'list' ? 0 : 1)) throw new Error(USAGE);
    const api = await recipeCliApi(values['daemon-url']);
    const prefix = `/api/projects/${encodeURIComponent(project)}/characters`;
    const slug = positionals[0];
    let result: unknown;
    if (command === 'list' || command === 'show') result = await api(`${prefix}${slug ? `/${encodeURIComponent(slug)}` : ''}`);
    else if (command === 'delete') result = await api(`${prefix}/${encodeURIComponent(slug!)}`, 'DELETE');
    else {
      if (values.file === '-' && values['prompt-file'] === '-') throw new Error('Only one file option may read stdin');
      const raw: unknown = values.file ? JSON.parse(await recipeCliText(values.file)) : {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Character file must contain a JSON object');
      const card = { ...raw } as Record<string, unknown>;
      for (const key of ['name', 'description', 'style', 'notes'] as const) if (values[key] !== undefined) card[key] = values[key];
      if (values.reference) card.references = values.reference;
      if (values['prompt-file']) card.description = await recipeCliText(values['prompt-file']);
      if (command === 'create') card.slug = slug;
      else { if (card.slug && card.slug !== slug) throw new Error('Character slug cannot change'); delete card.slug; }
      result = await api(`${prefix}${command === 'update' ? `/${encodeURIComponent(slug!)}` : ''}`, command === 'create' ? 'POST' : 'PUT', card);
    }
    console.log(JSON.stringify(result, null, json ? 2 : undefined));
  } catch (error) { recipeCliError(error, json); }
}
