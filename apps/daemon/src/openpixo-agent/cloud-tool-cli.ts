import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLOUD_TOOL_TEXT_MAX_CHARS, IMAGE_LOOK_QUESTION_MAX_CHARS, PRODUCT_CLI_NAME,
  type ApiErrorResponse, type CloudSkillsResponse, type CloudToolRequest, type CloudToolResponse,
} from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { recipeCliText } from '../recipes/cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} tool list [--json]
${PRODUCT_CLI_NAME} tool <id> [--file <image>] [--text-file <path|->] (--question <text> | --prompt-file <path|->) [--json]

Ask one of OpenPixo's cloud tools a question and get a short text answer, on this task's
OpenPixo credits. Only with OpenPixo's models; the tools available are listed in the prompt.

  <id>                     The tool, e.g. look.
  --file <image>           For an image tool: a PNG, JPEG, WebP or GIF in this project, or a
                           screenshot or frame path that game verify or game playtest returned.
  --text-file <path|->     For a text tool: the text to check (up to ${CLOUD_TOOL_TEXT_MAX_CHARS} characters).
  --question <text>        What to check (up to ${IMAGE_LOOK_QUESTION_MAX_CHARS} characters).
  --prompt-file <path|->   Read the question from a file or stdin instead.
  --json                   Print { answer, creditsCharged, costMicrocredits }.`;

export async function runToolCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') { console.log(USAGE); return; }
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      file: { type: 'string' }, 'text-file': { type: 'string' }, question: { type: 'string' }, 'prompt-file': { type: 'string' },
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length !== 1) throw new Error(`Pass exactly one tool id.\n\n${USAGE}`);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/u, '');
    if (positionals[0] === 'list') {
      const response = await fetch(`${base}/api/cloud-skills`, { headers: { Origin: new URL(base).origin } });
      const data = await response.json().catch(() => ({})) as CloudSkillsResponse & ApiErrorResponse;
      if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
      if (json) process.stdout.write(`${JSON.stringify({ tools: data.tools }, null, 2)}\n`);
      else process.stdout.write(`${data.tools.map((tool) => `${tool.id}\t${tool.input}\t${tool.description}`).join('\n') || 'No cloud tools.'}\n`);
      return;
    }
    if ((values.question === undefined) === (values['prompt-file'] === undefined)) {
      throw new Error('Pass the question with --question <text> or --prompt-file <path|->, not both.');
    }
    if (values['text-file'] === '-' && values['prompt-file'] === '-') throw new Error('Only one of --text-file and --prompt-file can read stdin.');
    const question = values.question ?? await recipeCliText(values['prompt-file']!);
    if (!question.trim()) throw new Error('The question is empty. Say what the tool should check.');
    const token = process.env.PIXO_TOOL_TOKEN;
    if (!token) throw new Error(`${PRODUCT_CLI_NAME} tool runs inside an agent task (PIXO_TOOL_TOKEN is not set).`);
    const body: CloudToolRequest = { tool: positionals[0]!, question };
    // Absolute, so a relative path means the same file whatever folder the agent is in.
    if (values.file !== undefined) body.path = path.resolve(values.file);
    if (values['text-file'] !== undefined) {
      body.text = values['text-file'] === '-' ? await recipeCliText('-') : await readFile(values['text-file'], 'utf8');
    }
    const response = await fetch(`${base}/api/tools/cloud`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as Partial<CloudToolResponse> & { error?: { message?: string } | string };
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      throw new Error(message ?? `The tool failed (${response.status})`);
    }
    if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    else process.stdout.write(`${data.answer ?? ''}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
