import { PRODUCT_CLI_NAME, type EditProjectImageRequest, type ImageEditOp, type ProjectAsset } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `${PRODUCT_CLI_NAME} asset edit <projectId> <path> [operations] [--out <name>] [--json]
  --crop x,y,w,h      Crop to an exact pixel rectangle
  --resize WxH|N%     Resize to pixel dimensions or a percentage
  --nearest          Use nearest-neighbour for every resize (default: smooth)
  --trim             Trim transparent edges
  --pad WxH|pot       Center on a transparent canvas, or pad to power-of-two
  --flip h|v          Flip horizontally or vertically
  --rotate 90         Rotate clockwise by 90 degrees
Operations run in flag order and may be repeated. The original is preserved.
Output defaults to <original-name>_<last-operation>.png beside the source.`;

function positiveInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error(`${flag} dimensions must be positive integers`);
  }
  return Number(value);
}

function dimensions(value: string, flag: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match) throw new Error(`${flag} requires WxH pixel dimensions`);
  return { width: positiveInteger(match[1]!, flag), height: positiveInteger(match[2]!, flag) };
}

/** Tokens preserve the user's operation order, including repeated flags. */
export function parseImageEditCli(args: string[]): {
  projectId: string;
  request: EditProjectImageRequest;
  json: boolean;
  daemonUrl: string | null;
} {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, tokens: true, options: {
    crop: { type: 'string', multiple: true }, resize: { type: 'string', multiple: true }, nearest: { type: 'boolean' },
    trim: { type: 'boolean' }, pad: { type: 'string', multiple: true }, flip: { type: 'string', multiple: true },
    rotate: { type: 'string', multiple: true }, out: { type: 'string' }, json: { type: 'boolean' },
    'daemon-url': { type: 'string' }, workspace: { type: 'string' }, 'workspace-member': { type: 'string' },
  } });
  if (positionals.length !== 2 || !positionals[0] || !positionals[1]) throw new Error(`edit requires a project id and one asset path.\n${USAGE}`);
  const ops: ImageEditOp[] = [];
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    const value = token.value ?? '';
    switch (token.name) {
      case 'crop': {
        const parts = value.split(',');
        if (parts.length !== 4 || !parts.every(part => /^\d+$/.test(part) && Number.isSafeInteger(Number(part)))) {
          throw new Error('--crop requires non-negative integer x,y and positive integer w,h');
        }
        ops.push({ op: 'crop', x: Number(parts[0]), y: Number(parts[1]), width: positiveInteger(parts[2]!, '--crop'), height: positiveInteger(parts[3]!, '--crop') });
        break;
      }
      case 'resize': {
        const percentage = /^(\d+(?:\.\d+)?)%$/.exec(value);
        const filter = values.nearest ? 'nearest' : 'smooth';
        if (percentage) {
          const scale = Number(percentage[1]) / 100;
          if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('--resize percentage must be positive');
          ops.push({ op: 'resize', scale, filter });
        } else ops.push({ op: 'resize', ...dimensions(value, '--resize'), filter });
        break;
      }
      case 'trim': ops.push({ op: 'trim' }); break;
      case 'pad': ops.push(value === 'pot' ? { op: 'pad', powerOfTwo: true } : { op: 'pad', ...dimensions(value, '--pad') }); break;
      case 'flip':
        if (value !== 'h' && value !== 'v') throw new Error('--flip must be h or v');
        ops.push({ op: 'flip', axis: value });
        break;
      case 'rotate':
        if (value !== '90') throw new Error('--rotate must be 90');
        ops.push({ op: 'rotate', degrees: 90 });
        break;
    }
  }
  if (!ops.length) throw new Error('At least one image operation is required');
  if (values.nearest && !ops.some(op => op.op === 'resize')) throw new Error('--nearest requires --resize');
  const source = positionals[1];
  const filename = source.replace(/\\/g, '/').split('/').pop()!;
  const stem = filename.replace(/\.[^.]*$/, '');
  const output = values.out ?? `${stem}_${ops[ops.length - 1]!.op}.png`;
  if (!output.trim()) throw new Error('--out requires a non-empty output name');
  return { projectId: positionals[0], request: { source, ops, output }, json: values.json === true, daemonUrl: values['daemon-url'] ?? null };
}

export async function runImageEditCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const parsed = parseImageEditCli(args);
    json = parsed.json;
    const base = (await resolveDaemonUrl({ flagUrl: parsed.daemonUrl })).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const response = await fetch(`${base}/api/projects/${encodeURIComponent(parsed.projectId)}/assets/edit`, {
      method: 'POST', headers, body: JSON.stringify(parsed.request),
    });
    const data = await response.json() as ProjectAsset & { error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? `Image edit failed (${response.status})`);
    if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    else console.log(`${parsed.request.source} -> ${data.relPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
