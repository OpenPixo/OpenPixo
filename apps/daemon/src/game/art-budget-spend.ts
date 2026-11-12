import { createHash, randomUUID } from 'node:crypto';
import {
  ART_APPROVAL_REQUIRED,
  ART_BUDGET_EXHAUSTED,
  gamePlanIsPending,
  type ArtBudgetApproval,
  OPENPIXO_MODEL3D_PROMPT,
  type OpenPixoGenerationAspect,
  type OpenPixoGenerationService,
  type ProjectArtBudget,
  type ProjectMetadata,
} from '@openpixo/contracts';
import { AccountError, accountError } from '../account/errors.js';
import { promptForImagePlan, resolveProjectImageRefs } from '../media/index.js';
import { planImageOutput } from '../media/image-output.js';
import { hostedAudioKind, hostedAudioParams } from '../media/models.js';
import type { HostedReferenceImage, OpenPixoHostedMedia } from '../media/openpixo-hosted.js';
import { approvalUsableBy, type ArtBudgetLedger } from './art-budget.js';

/** What the daemon decided to send to the cloud for one agent request. */
export interface AgentHostedRequest {
  quoteId: string;
  cloudRequestId: string;
  /** The exact prompt that was priced. */
  prompt: string;
  /** The exact aspect that was priced; absent when the request names none. */
  aspect?: OpenPixoGenerationAspect | undefined;
  /** The exact voice and length that were priced, for audio. */
  style?: string | undefined;
  duration?: number | undefined;
  warnings: string[];
}

export type AgentHostedDecision =
  | { ok: true; hosted: AgentHostedRequest }
  | { ok: false; status: number; code: string; message: string };

export interface AgentHostedRequestInput {
  ledger: ArtBudgetLedger;
  hosted: Pick<OpenPixoHostedMedia, 'quote' | 'services'>;
  /** The project this token was granted, which alone decides whose budget applies. */
  grant: { projectId: string; runId?: string | null | undefined };
  projectId: string;
  metadata: ProjectMetadata | undefined;
  projectDir: string;
  service: string;
  /** Absent means an image, as every request was before audio and 3D. */
  surface?: string | undefined;
  /** The prompt after the project's art style was merged in. Audio has no art style, and a 3D model no prompt. */
  prompt: unknown;
  pixelArt: boolean;
  /** Read for shape only. No quote, price or request id is ever taken from here. */
  body: { image?: unknown; images?: unknown; width?: unknown; height?: unknown; aspect?: unknown; background?: unknown; voice?: unknown; duration?: unknown };
  /**
   * Tells apart requests that are meant to be separate images although they read the
   * same, like a recipe's candidates, so each gets its own charge and request id.
   */
  variant?: number | undefined;
}

const refuse = (status: number, code: string, message: string): AgentHostedDecision => ({ ok: false, status, code, message });

function fromCloud(error: unknown): AgentHostedDecision {
  // A bad path or format in `--image` is the caller's to fix, as on the quote route.
  if (error instanceof Error && !(error instanceof AccountError) && /--image/u.test(error.message)) {
    return refuse(400, 'GENERATION_PARAMS_INVALID', error.message);
  }
  const failure = accountError(error);
  return refuse(failure.status, failure.code, failure.message);
}

function exhausted(budget: ProjectArtBudget | null, asset: string, price?: number): AgentHostedDecision {
  const used = budget?.usedCredits ?? 0;
  const limit = budget?.limitCredits ?? 0;
  const cost = price === undefined ? '' : ` This ${asset} costs ${price} and ${budget?.remainingCredits ?? 0} remain.`;
  return refuse(409, ART_BUDGET_EXHAUSTED, `Art budget: ${used} of ${limit} credits used.${cost} Only the user can raise it, after this turn ends.`);
}

/** Nothing was charged: the user has not approved this art, and only their click can. */
function approvalNeeded(approval: ArtBudgetApproval | null, runId: string | null, asset: string, price?: number): AgentHostedDecision {
  const ask = 'Do not dispatch it again: end your reply with an art card (<art-request credits="N">, see "Asking before spending") listing the art still to make, and the user approves it with a click.';
  let state = 'The user has not approved any art for this turn.';
  if (approval && approval.runId !== null && approval.runId !== runId) {
    state = 'The art the user approved last was paid for by an earlier turn.';
  } else if (approval) {
    const cost = price === undefined ? '' : ` This ${asset} costs ${price}.`;
    state = `The user approved ${approval.approvedCredits} credits on the last art card and ${approval.remainingCredits} are left.${cost}`;
  }
  return refuse(409, ART_APPROVAL_REQUIRED, `This project asks before spending credits. ${state} ${ask}`);
}

function ratio(aspect: string): number {
  const [width, height] = aspect.split(':').map(Number);
  return width! / height!;
}

/** The service's own shape closest to the one asked for; the local resize sets the final file. */
function nearestAspect(wanted: string, offered: readonly OpenPixoGenerationAspect[]): OpenPixoGenerationAspect | undefined {
  if (!/^\d+:\d+$/u.test(wanted)) return undefined;
  const target = Math.log(ratio(wanted));
  return offered.reduce<OpenPixoGenerationAspect | undefined>((best, aspect) =>
    best === undefined || Math.abs(Math.log(ratio(aspect)) - target) < Math.abs(Math.log(ratio(best)) - target) ? aspect : best, undefined);
}

/** The voice and length count too, but only when set, so an image's open charge still matches after an update. */
function fingerprintOf(service: string, prompt: string, aspect: string | undefined, references: readonly HostedReferenceImage[], style?: string, duration?: number, variant?: number): string {
  const hashes = references.map(reference => createHash('sha256').update(reference.bytes).digest('hex'));
  const audio = style === undefined && duration === undefined ? [] : [style ?? null, duration ?? null];
  // Like the audio fields, only when set, so a single request's open charge still matches.
  const variants = variant === undefined ? [] : [{ variant }];
  return createHash('sha256').update(JSON.stringify([service, prompt, aspect ?? null, hashes, ...audio, ...variants])).digest('hex');
}

/** What the service's own catalogue entry allows for one audio request, checked before it is priced. */
function planHostedAudio(entry: OpenPixoGenerationService | undefined, service: string, prompt: string, body: AgentHostedRequestInput['body']):
  { ok: true; style?: string; duration?: number; warnings: string[] } | { ok: false; message: string } {
  const warnings: string[] = [];
  const kind = hostedAudioKind(service);
  // The cloud counts the trimmed prompt, by character.
  const length = [...prompt.trim()].length;
  if (entry && length > entry.maxPromptChars) return { ok: false, message: `This prompt is ${length} characters and ${service} takes at most ${entry.maxPromptChars}.` };
  if (entry?.minPromptChars !== undefined && length < entry.minPromptChars) return { ok: false, message: `This prompt is ${length} characters and ${service} needs at least ${entry.minPromptChars}.` };
  // A voice or a length the service can't take is left out with a warning: the cloud would refuse the
  // whole request, and the sound is still what the agent asked for. An unknown voice is a real mistake.
  const hasVoice = body.voice !== undefined && body.voice !== null && body.voice !== '';
  if (hasVoice && kind !== 'speech') warnings.push(`voice ignored: ${service} takes none`);
  if (typeof body.duration === 'number' && kind !== 'sfx') warnings.push(`duration ignored: ${service} cannot set its length`);
  const { style, duration: asked } = kind ? hostedAudioParams(kind, { voice: body.voice, duration: body.duration }) : { style: undefined, duration: undefined };
  if (hasVoice && kind === 'speech' && style === undefined) return { ok: false, message: 'voice must be a string.' };
  if (style !== undefined && entry && !entry.styles.includes(style)) return { ok: false, message: `${service} has no voice "${style}". Its voices: ${entry.styles.join(', ')}.` };
  let duration = asked;
  const limits = entry?.durationSeconds;
  if (duration !== undefined && limits) {
    duration = Math.min(limits.max, Math.max(limits.min, duration));
    if (duration !== asked) warnings.push(`duration ${asked} s rendered as ${duration} s, the nearest ${service} offers`);
  }
  return { ok: true, ...(style !== undefined ? { style } : {}), ...(duration !== undefined ? { duration } : {}), warnings };
}

/**
 * Decides whether an agent's hosted image, audio or 3D model may be made and on what terms. The daemon
 * gets its own price and mints its own request id; everything about money comes from
 * here, and what the cloud is sent afterwards is exactly what was priced.
 *
 * Whatever a retry looks like, it cannot charge twice: an identical request whose
 * charge is still open reuses that charge's request id and quote, and the cloud
 * answers those with the job it already has.
 */
export async function prepareAgentHostedRequest(input: AgentHostedRequestInput): Promise<AgentHostedDecision> {
  const { ledger, hosted, grant, projectId, service, body } = input;
  if (grant.projectId !== projectId) return refuse(403, 'FORBIDDEN', 'A tool token can only use its own project\'s art budget.');
  const confirm = new AccountError('GENERATION_CONFIRMATION_REQUIRED');
  const audio = input.surface === 'audio';
  const model3d = input.surface === 'model3d';
  const asset = audio ? 'audio' : model3d ? '3D model' : 'image';
  // While planning, a budget the user set pays only for style samples; the plan gate
  // ahead of this route also caps how many.
  if (gamePlanIsPending(input.metadata) && (audio || model3d)) {
    return refuse(confirm.status, confirm.code, `This ${asset} would spend credits, which waits until the user approves the plan.`);
  }
  const budget = ledger.read(projectId);
  if (!budget || budget.limitCredits === 0) {
    return refuse(confirm.status, confirm.code, `This ${asset} would spend credits, and this project has no art budget. Only the user can set one.`);
  }
  if (!model3d && (typeof input.prompt !== 'string' || !input.prompt.trim())) return refuse(400, 'GENERATION_PARAMS_INVALID', 'A prompt is required.');

  let references: HostedReferenceImage[] = [];
  let aspect: string | undefined;
  let style: string | undefined;
  let duration: number | undefined;
  const warnings: string[] = [];
  let prompt: string;
  try {
    if (audio) {
      // Sent as given: audio has no shape, no cutout, no references and no art style.
      if (body.image || (Array.isArray(body.images) && body.images.length)) return refuse(400, 'GENERATION_PARAMS_INVALID', 'Audio takes no reference images.');
      prompt = input.prompt as string;
      const entry = (await hosted.services()).services.find(candidate => candidate.id === service);
      const plan = planHostedAudio(entry, service, prompt, body);
      if (!plan.ok) return refuse(400, 'GENERATION_PARAMS_INVALID', plan.message);
      style = plan.style;
      duration = plan.duration;
      warnings.push(...plan.warnings);
    } else {
      // The same validation the quote route uses, so a reference stays inside the project.
      const refs = await resolveProjectImageRefs(body.image, body.images, input.projectDir);
      references = refs.map(ref => ({ bytes: Buffer.from(ref.dataUrl.slice(ref.dataUrl.indexOf(',') + 1), 'base64'), mime: ref.mime }));
      const plan = model3d ? null : planImageOutput({ width: body.width, height: body.height, aspect: body.aspect, background: body.background, pixelArt: input.pixelArt, prompt: input.prompt as string });
      // Size, cutout and shape belong to images; a 3D model is priced from its reference alone.
      prompt = plan ? promptForImagePlan(input.prompt as string, plan) : OPENPIXO_MODEL3D_PROMPT;
      aspect = !plan ? undefined : plan.size?.aspect ?? (typeof body.aspect === 'string' && body.aspect ? body.aspect : undefined);
      if (aspect) {
        const offered = (await hosted.services()).services.find(entry => entry.id === service)?.aspects;
        if (offered && !offered.includes(aspect as OpenPixoGenerationAspect)) {
          const nearest = nearestAspect(aspect, offered);
          if (nearest) { warnings.push(`aspect ${aspect} rendered as ${nearest}, the nearest this service offers`); aspect = nearest; }
        }
      }
    }
  } catch (error) {
    return fromCloud(error);
  }

  const fingerprint = fingerprintOf(service, prompt, aspect, references, style, duration, input.variant);
  const runId = grant.runId ?? null;
  // In ask mode only an approved art card pays. Planning's style samples are the
  // exception: the plan gate ahead of this already holds them to a few images.
  const requireApproval = ledger.readMode(projectId) === 'ask' && !gamePlanIsPending(input.metadata);
  const request = (charge: { quoteId: string; requestId: string }): AgentHostedDecision => ({ ok: true, hosted: {
    quoteId: charge.quoteId, cloudRequestId: charge.requestId, prompt, aspect: aspect as OpenPixoGenerationAspect | undefined,
    ...(style !== undefined ? { style } : {}), ...(duration !== undefined ? { duration } : {}), warnings,
  } });

  const open = ledger.reusable(projectId, fingerprint, runId);
  if (open) return request(open);
  if (budget.remainingCredits <= 0) return exhausted(budget, asset);
  if (requireApproval) {
    // Checked again with the price, inside the reservation; this spares a quote that cannot be paid.
    const approval = ledger.readApproval(projectId);
    if (!approvalUsableBy(approval, runId)) return approvalNeeded(approval, runId, asset);
  }

  let quote;
  try {
    quote = await hosted.quote(service, { prompt, ...(aspect ? { aspect: aspect as OpenPixoGenerationAspect } : {}),
      ...(style !== undefined ? { style } : {}), ...(duration !== undefined ? { duration } : {}) }, references);
  } catch (error) {
    return fromCloud(error);
  }
  // No await between the budget check and the charge: see `ArtBudgetLedger.reserve`.
  const reserved = ledger.reserve({ projectId, runId, fingerprint, quoteId: quote.quoteId, service, credits: quote.credits,
    requestId: `artbudget-${randomUUID()}`, requireApproval });
  if (!reserved.ok) {
    return reserved.reason === 'approval' ? approvalNeeded(reserved.approval, runId, asset, quote.credits) : exhausted(reserved.budget, asset, quote.credits);
  }
  return request(reserved.charge);
}
