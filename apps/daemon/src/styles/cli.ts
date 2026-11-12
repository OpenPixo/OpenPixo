import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import type {
  ApiErrorResponse, ArtStyle, ProjectArtStyleResponse, SetProjectArtStyleRequest, SetProjectStyleReferenceRequest,
  StyleResponse, StylesResponse,
} from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `${PRODUCT_CLI_NAME} style list [--json]
${PRODUCT_CLI_NAME} style info <id> [--json]
${PRODUCT_CLI_NAME} style set <projectId> <styleId|none> [--json]
${PRODUCT_CLI_NAME} style get <projectId> [--json]
${PRODUCT_CLI_NAME} style reference <projectId> [<project-relative image>|none] [--json]
  Show or set the image new art should match. An agent's image made without --image is told about it.`;

function styleText(style: ArtStyle): string {
  return [
    `${style.title} (${style.id})`, style.description,
    `Dimensions: ${style.dimension.join(', ')}`, `Mediums: ${style.medium.join(', ')}`,
    `Prompt: ${style.prompt}`, `Negative prompt: ${style.negativePrompt}`,
    ...(style.palette?.length ? [`Palette: ${style.palette.join(', ')}`] : []),
    ...(style.constraints ? [`Constraints: ${JSON.stringify(style.constraints)}`] : []),
    `License: ${style.license}`,
    ...(style.examples?.length ? ['Examples:', ...style.examples.map(example => `${example.title}\n  ${example.prompt}`)] : []),
  ].join('\n');
}

export async function runStyleCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const command = args[0];
    if (!['list', 'info', 'set', 'get', 'reference'].includes(command!)) throw new Error(USAGE);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    const expected = command === 'list' ? 0 : command === 'set' ? 2 : 1;
    const settingReference = command === 'reference' && positionals.length === 2;
    if (positionals.length !== expected && !settingReference) throw new Error(USAGE);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const route = command === 'list' ? '/api/styles' : command === 'info'
      ? `/api/styles/${encodeURIComponent(positionals[0]!)}`
      : settingReference ? `/api/projects/${encodeURIComponent(positionals[0]!)}/style-reference`
      : `/api/projects/${encodeURIComponent(positionals[0]!)}/art-style`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const body: SetProjectArtStyleRequest | SetProjectStyleReferenceRequest | undefined = command === 'set'
      ? { styleId: positionals[1] === 'none' ? null : positionals[1]! }
      : settingReference ? { path: positionals[1] === 'none' ? null : positionals[1]! } : undefined;
    const response = await fetch(`${base}${route}`, { method: body ? 'PUT' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) {
      if (json) console.log(JSON.stringify(result));
      else console.error((result as ApiErrorResponse).error?.message ?? `Request failed (${response.status})`);
      process.exitCode = 1; return;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (command === 'list') console.log((result as StylesResponse).styles.map(style => `${style.id}\t${style.title}`).join('\n'));
    else if (command === 'info') console.log(styleText((result as StyleResponse).style));
    else if (command === 'reference') console.log(`Style reference: ${(result as ProjectArtStyleResponse).referenceImage ?? 'none'}`);
    else {
      const { styleId, style, referenceImage } = result as ProjectArtStyleResponse;
      console.log(`Art style: ${style ? `${style.title} (${style.id})` : styleId ?? 'none'}`);
      console.log(`Style reference: ${referenceImage ?? 'none'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: { message } })); else console.error(message);
    process.exitCode = 1;
  }
}
