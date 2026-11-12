import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { ASSET_OP_NAMES, type AssetOpName, type AssetOpReport, type AssetOpRequest } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../../daemon-url.js';

/** First argv tokens of `pixo asset ...` this module handles (e.g. `resize`, `slice`, `audio`). */
export const ASSET_OP_COMMANDS: ReadonlySet<string> = new Set(['resize', 'trim', 'slice', 'pack', 'export-spritesheet', 'pixelate', 'palette', 'seamless-check', 'remove-bg', 'frames', 'audio']);

const USAGE = `${PRODUCT_CLI_NAME} asset <op> <inputs...> [--project <id>] [--out <rel-dir>] [--json] [--dry-run]
  resize          --width/--height <px> | --scale <factor> [--filter nearest|lanczos]
  trim            [--padding <px>]
  slice           --grid CxR | --cell WxH [--margin <px>] [--spacing <px>] [--frame-columns N]
  pack            [--max-size <px>] [--padding <px>] [--format texturepacker-json|godot-tres]
  export-spritesheet [--format auto|godot|phaser|aseprite] [--columns N] [--animations down,left,...] [--fps N] [--name <stem>] [--no-loop]
  pixelate        --size <longest-side-px> | --pixel-size <grid-unit-px> [--palette gameboy|pico8|grayscale|<file.gpl|file.hex>] [--dither none|ordered]
  palette         --colors <1-256> [--apply] [--palette gameboy|pico8|grayscale|<file>]
  seamless-check
  remove-bg       --mode chroma --color <RRGGBB> [--tolerance <0-255>] (model deferred)
  frames check    <frame files in order...>   Measures each frame (drawn box, feet line and centre, empty,
                  touching the edge) and reports the set in "summary": feet moving, sliding, size drift,
                  empty frames, plus one plain sentence per problem in summary.issues. Writes no images.
  frames align    <frame files in order...> [--canvas WxH] [--padding <px>] [--match-height] [--filter nearest|lanczos]
                  Writes every frame on one canvas with one scale, feet on one line at the bottom centre.
                  --canvas scales them all by the same factor to fit; --match-height first evens out
                  drawings a model made taller or shorter (not for a crouch or jump).
  audio normalize --lufs <target>
  audio trim      --silence-threshold <dB>
  audio loop      --crossfade-ms <ms>
  audio convert   --format wav|ogg|mp3 [--sample-rate <Hz>]
Outputs default to derived/<op>/<original-relative-path> (PNG/WAV unless specified).
Dry runs plan outputs without writing. Existing outputs are skipped.`;

const NUMERIC_FLAGS = new Set(['width', 'height', 'scale', 'padding', 'margin', 'spacing', 'max-size', 'size', 'pixel-size', 'frame-columns', 'colors', 'tolerance', 'lufs', 'crossfade-ms', 'sample-rate', 'columns', 'fps']);
const STRING_FLAGS = ['filter', 'grid', 'cell', 'format', 'palette', 'dither', 'mode', 'color', 'model', 'silence-threshold', 'name', 'animations', 'canvas'];

export async function runAssetOpCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const grouped = args[0] === 'audio' || args[0] === 'frames';
    const op = (grouped ? `${args[0]}-${args[1]}` : args[0]) as AssetOpName;
    if (!ASSET_OP_NAMES.includes(op)) throw new Error(`Unknown asset operation. ${USAGE}`);
    const rest = args.slice(grouped ? 2 : 1);
    // parseArgs treats a separate negative string as an option; accept --lufs -16 too.
    const normalized: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const value = rest[i]!;
      if (value.startsWith('--') && (NUMERIC_FLAGS.has(value.slice(2)) || value === '--silence-threshold') && /^-\d/.test(rest[i + 1] ?? '')) normalized.push(`${value}=${rest[++i]}`);
      else normalized.push(value);
    }
    const { values, positionals } = parseArgs({ args: normalized, allowPositionals: true, options: {
      ...Object.fromEntries([...NUMERIC_FLAGS, ...STRING_FLAGS].map(flag => [flag, { type: 'string' as const }])),
      project: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, 'no-loop': { type: 'boolean' }, 'match-height': { type: 'boolean' },
      'daemon-url': { type: 'string' }, workspace: { type: 'string' }, 'workspace-member': { type: 'string' },
    } });
    json = values.json === true;
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error('Pass --project <id> or set PIXO_PROJECT_ID');
    if (!positionals.length) throw new Error('At least one project-relative input is required');
    const params: Record<string, unknown> = {};
    if (values.apply) params.apply = true;
    if (values['no-loop']) params.loop = false;
    if (values['match-height']) params.matchHeight = true;
    for (const flag of [...NUMERIC_FLAGS, ...STRING_FLAGS]) {
      const value = (values as Record<string, string | boolean | undefined>)[flag];
      if (value === undefined) continue;
      const key = flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      params[key] = NUMERIC_FLAGS.has(flag) ? Number(value) : value;
      if (NUMERIC_FLAGS.has(flag) && !Number.isFinite(params[key])) throw new Error(`--${flag} must be numeric`);
    }
    const request: AssetOpRequest = { op, inputs: positionals, params, ...(values.out ? { out: String(values.out) } : {}), dryRun: values['dry-run'] === true };
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const response = await fetch(`${base}/api/projects/${encodeURIComponent(String(projectId))}/asset-ops`, { method: 'POST', headers, body: JSON.stringify(request) });
    const report = await response.json() as AssetOpReport & { error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof report.error === 'string' ? report.error : report.error?.message ?? `Asset operation failed (${response.status})`);
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const item of report.results) console.log(`${item.status}\t${item.source}${item.output ? ` -> ${item.output}` : ''}${item.extraOutputs?.length ? ` (+${item.extraOutputs.length} files)` : ''}${item.error ? `: ${item.error}` : ''}`);
      console.log(`${report.dryRun ? 'Planned: ' : ''}${report.counts.succeeded} succeeded, ${report.counts.skipped} skipped, ${report.counts.failed} failed; originals ${report.originalsPreserved ? 'preserved' : 'CHANGED'}`);
      if (report.summary) {
        const summary = report.summary;
        console.log(`Frames: ${summary.frames}; feet move ${summary.baselineSpreadPx} px up/down and ${summary.feetXSpreadPx} px sideways; height drift ${summary.heightDriftPercent}%`);
        for (const issue of summary.issues) console.log(`- ${issue}`);
        if (summary.ok) console.log('The frames hold steady.');
      }
      if (report.reportPath) console.log(`Report: ${report.reportPath}`);
    }
    if (report.counts.failed > 0 || !report.originalsPreserved) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
