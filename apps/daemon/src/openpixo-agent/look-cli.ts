import path from 'node:path';
import { parseArgs } from 'node:util';
import { IMAGE_LOOK_QUESTION_MAX_CHARS, PRODUCT_CLI_NAME, type ImageLookRequest, type ImageLookResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { recipeCliText } from '../recipes/cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} look <image> (--question <text> | --prompt-file <path|->) [--json] [--daemon-url <url>]

Ask one question about one image and get a text answer from OpenPixo's image viewer, on this
task's OpenPixo credits (a fraction of a credit a look). For the OpenPixo-credits agent, which
does not see pictures in its own conversation; other agents open the image directly.

  <image>                  A PNG, JPEG, WebP or GIF in this project, or a screenshot or frame
                           path that game verify or game playtest returned.
  --question <text>        What to check, e.g. "Is the score text cut off at the top right?"
                           (up to ${IMAGE_LOOK_QUESTION_MAX_CHARS} characters).
  --prompt-file <path|->   Read the question from a file or stdin instead.
  --json                   Print { answer, model, creditsCharged, costMicrocredits }.
  --daemon-url <url>       Override the daemon URL.

Needs the PIXO_TOOL_TOKEN the daemon gives a running agent.`;

export async function runLookCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') { console.log(USAGE); return; }
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      question: { type: 'string' }, 'prompt-file': { type: 'string' }, json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length !== 1) throw new Error(`Pass exactly one image.\n\n${USAGE}`);
    if ((values.question === undefined) === (values['prompt-file'] === undefined)) {
      throw new Error('Pass the question with --question <text> or --prompt-file <path|->, not both.');
    }
    const question = values.question ?? await recipeCliText(values['prompt-file']!);
    if (!question.trim()) throw new Error('The question is empty. Say what to check in the image.');
    const token = process.env.PIXO_TOOL_TOKEN;
    if (!token) throw new Error(`${PRODUCT_CLI_NAME} look runs inside an agent task (PIXO_TOOL_TOKEN is not set).`);
    // Absolute, so a relative path means the same file whatever folder the agent is in.
    const body: ImageLookRequest = { path: path.resolve(positionals[0]!), question };
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/u, '');
    const response = await fetch(`${base}/api/tools/look`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as Partial<ImageLookResponse> & { error?: { message?: string } | string };
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      throw new Error(message ?? `Look failed (${response.status})`);
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
