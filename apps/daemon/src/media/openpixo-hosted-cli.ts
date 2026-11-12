import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { isOpenPixoModel3dService, OPENPIXO_MODEL3D_PROMPT, PRODUCT_CLI_NAME, type OpenPixoGenerationQuote } from '@openpixo/contracts';
import { accountCliApi, AccountCliError } from '../account/cli-common.js';
import { resolveDaemonUrl } from '../daemon-url.js';
import { hostedAudioKind, hostedAudioParams } from './models.js';

export const OPENPIXO_CLI_STRING_FLAGS = ['quote', 'request-id', 'cloud-style'] as const;

export const OPENPIXO_CLI_HELP = `
OpenPixo hosted models spend credits: openpixo-image (text to image), openpixo-image-edit (1–4 --image references),
openpixo-sfx (sound effect, --duration up to 10 s), openpixo-voice (voice line, --voice <name>), openpixo-music (instrumental, length can't be set)
and 3D models (one --image, no prompt, makes a GLB) in three qualities: openpixo-model3d-draft (cheapest),
openpixo-model3d (medium, the default) and openpixo-model3d-high (detailed, costs the most):
  ${PRODUCT_CLI_NAME} media quote --model <id> --project <id> (--prompt <text> | --prompt-file <path|->) [--aspect 1:1|2:3|3:2] [--image <path>]… [--duration <seconds>] [--voice <name>] [--json]
      Get a server price for exactly this request. Nothing is spent; --image files are uploaded privately to your account.
  ${PRODUCT_CLI_NAME} media generate --surface image|audio|model3d --model <id> --project <id> (--prompt … | --prompt-file …) [--image <path>]… [--duration <seconds>] [--voice <name>] [--quote <id>] [--request-id <id>]
      Without --quote, asks you to confirm the price in this terminal. --quote <id> confirms a quote you
      already reviewed. --request-id reuses a confirmed request after a failure without paying twice.
      Under an agent's tool token neither applies and both are ignored: the daemon prices the request and
      charges the art budget the user set for this project (${PRODUCT_CLI_NAME} game plan budget), and refuses it without one.`;

export function isOpenPixoHostedModel(model: unknown): boolean {
  return typeof model === 'string' && /^openpixo-[a-z0-9-]+$/u.test(model);
}

interface HostedFlags {
  prompt: string | null; model: string; aspect?: string | undefined; 'cloud-style'?: string | undefined;
  /** Audio: the length in seconds as typed, and the voice, which the cloud calls a style. */
  duration?: string | undefined; voice?: string | undefined;
  /** With a project, references are resolved and priced by the daemon. */
  project?: string | undefined; images?: string[] | undefined;
}

function hostedStyle(flags: HostedFlags): string | undefined {
  const kind = hostedAudioKind(flags.model);
  return kind ? hostedAudioParams(kind, { style: flags['cloud-style'], voice: flags.voice }).style : flags['cloud-style'] || undefined;
}

function quoteBody(flags: HostedFlags) {
  const prompt = isOpenPixoModel3dService(flags.model) ? OPENPIXO_MODEL3D_PROMPT : flags.prompt;
  if (!prompt?.trim()) throw new AccountCliError('BAD_REQUEST', 'A prompt is required (--prompt or --prompt-file).');
  const kind = hostedAudioKind(flags.model);
  if (!kind) return { service: flags.model, params: { prompt, ...(flags.aspect ? { aspect: flags.aspect } : {}),
    ...(flags['cloud-style'] ? { style: flags['cloud-style'] } : {}) } };
  const seconds = flags.duration != null ? Number(flags.duration) : undefined;
  if (seconds !== undefined && !(seconds > 0)) throw new AccountCliError('BAD_REQUEST', '--duration must be a positive number of seconds.');
  // Audio has no shape, and the cloud refuses an aspect on it.
  return { service: flags.model, params: { prompt, ...hostedAudioParams(kind, { style: flags['cloud-style'], voice: flags.voice, duration: seconds }) } };
}

export async function requestOpenPixoQuote(daemonUrl: string, flags: HostedFlags): Promise<OpenPixoGenerationQuote> {
  const body = quoteBody(flags);
  if (!flags.project) {
    if (flags.images?.length) throw new AccountCliError('BAD_REQUEST', 'Reference images need --project <id>.');
    const api = await accountCliApi(daemonUrl);
    return api<OpenPixoGenerationQuote>('/cloud-media/quote', 'POST', body);
  }
  const base = (await resolveDaemonUrl({ flagUrl: daemonUrl })).replace(/\/$/u, '');
  const token = process.env.PIXO_API_TOKEN;
  let response: Response;
  try {
    response = await fetch(`${base}/api/projects/${encodeURIComponent(flags.project)}/media/openpixo-quote`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ service: body.service, ...body.params, images: flags.images ?? [] }),
    });
  } catch {
    throw new AccountCliError('CLOUD_UNAVAILABLE', 'The OpenPixo daemon could not be reached.');
  }
  const data = await response.json().catch(() => null) as (OpenPixoGenerationQuote & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !data) throw new AccountCliError(data?.error?.code ?? 'CLOUD_UNAVAILABLE', data?.error?.message ?? 'The quote failed.');
  return data;
}

export function describeQuote(quote: OpenPixoGenerationQuote): string {
  const extras = [quote.breakdown.longPrompt ? `+${quote.breakdown.longPrompt} long prompt` : '',
    quote.breakdown.extraReferences ? `+${quote.breakdown.extraReferences} extra references` : ''].filter(Boolean).join(', ');
  return `${quote.credits} credits for ${quote.service}${extras ? ` (${quote.breakdown.base} base, ${extras})` : ''}; available ${quote.available}; quote ${quote.quoteId} expires ${quote.expiresAt}`;
}

async function askYesNo(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try { return /^(?:y|yes|是)$/iu.test((await prompt.question(question)).trim()); }
  finally { prompt.close(); }
}

/**
 * Resolves the user's spending confirmation for a hosted generate. An agent's
 * tool token never confirms and sends nothing about money: the daemon decides from
 * the art budget. A non-interactive user must pass a quote from `media quote`.
 */
export async function confirmOpenPixoHosted(daemonUrl: string, flags: HostedFlags & { quote?: string | undefined; 'request-id'?: string | undefined }) {
  if (process.env.PIXO_TOOL_TOKEN) return {};
  let quoteId = flags.quote;
  if (!quoteId) {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      throw new AccountCliError('GENERATION_CONFIRMATION_REQUIRED',
        `Run ${PRODUCT_CLI_NAME} media quote with the same options, review the price, then pass --quote <id>.`);
    }
    const quote = await requestOpenPixoQuote(daemonUrl, flags);
    console.error(describeQuote(quote));
    if (!await askYesNo(`Spend ${quote.credits} credits? / 确认消耗 ${quote.credits} 积分？ [y/N] `)) {
      throw new AccountCliError('GENERATION_CONFIRMATION_REQUIRED', 'Not confirmed; nothing was spent.');
    }
    quoteId = quote.quoteId;
  }
  const cloudRequestId = flags['request-id'] ?? `cli-${randomUUID()}`;
  console.error(`request id ${cloudRequestId} (pass --request-id ${cloudRequestId} --quote ${quoteId} to retry without paying twice)`);
  const style = hostedStyle(flags);
  return { quoteId, cloudRequestId, ...(style ? { style } : {}) };
}
