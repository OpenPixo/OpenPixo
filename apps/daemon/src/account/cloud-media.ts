import type {
  OpenPixoCloudGenerationJob, OpenPixoGenerationAspect, OpenPixoGenerationAudioKind, OpenPixoGenerationJobState, OpenPixoGenerationParams,
  OpenPixoGenerationQuote, OpenPixoGenerationReferenceResponse, OpenPixoGenerationService, OpenPixoGenerationServicesResponse,
  OpenPixoModel3dQuality,
} from '@openpixo/contracts';
import { isOpenPixoModel3dService, OPENPIXO_MODEL3D_QUALITIES } from '@openpixo/contracts';
import { AccountError, cloudServiceError } from './errors.js';
import { record } from './supabase.js';

const ASPECTS: readonly OpenPixoGenerationAspect[] = ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16'];
const SHA256 = /^[0-9a-f]{64}$/u;
export const MAX_HOSTED_REFERENCES = 4;
const STATES: readonly OpenPixoGenerationJobState[] = ['queued', 'running', 'checking', 'succeeded', 'failed'];
const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'model/gltf-binary'] as const;
const AUDIO_KINDS: readonly OpenPixoGenerationAudioKind[] = ['sfx', 'speech', 'music'];
const SERVICE_SURFACES: readonly unknown[] = ['image', 'audio', 'model3d'];
const MODEL3D_QUALITIES: readonly unknown[] = OPENPIXO_MODEL3D_QUALITIES;
const MAX_DURATION_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const OPENPIXO_SERVICE_ID = /^openpixo-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const CLOUD_REQUEST_ID = /^[A-Za-z0-9._:-]{8,200}$/u;

function invalid(): never { throw cloudServiceError(); }
function text(value: unknown, max = 2048): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : invalid();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function date(value: unknown): string {
  const result = text(value, 64);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function uuid(value: unknown): string { const result = text(value, 64); return UUID.test(result) ? result : invalid(); }
function serviceId(value: unknown): string { const result = text(value, 64); return OPENPIXO_SERVICE_ID.test(result) ? result : invalid(); }
function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DURATION_SECONDS ? value : invalid();
}

// Cloud responses are re-built field by field; nothing unexpected reaches UI or CLI.
export function generationServices(value: unknown): OpenPixoGenerationServicesResponse {
  const item = record(value);
  if (!Array.isArray(item.services) || item.services.length > 50 || typeof item.generationPaused !== 'boolean') invalid();
  // `v=2` lists everything the cloud sells, so a surface newer than this app is left out, not an
  // error: one unknown entry must not take the whole catalogue away from an installed app.
  // A 3D service this app cannot run (a tier newer than it) is left out the same way.
  const known = item.services.filter((entry) => {
    const row = record(entry);
    if (typeof row.surface === 'string' && !SERVICE_SURFACES.includes(row.surface)) return false;
    return row.surface !== 'model3d' || isOpenPixoModel3dService(row.id);
  });
  const services = known.map((entry): OpenPixoGenerationService => {
    const row = record(entry);
    if ((row.surface !== 'image' && row.surface !== 'audio' && row.surface !== 'model3d') || !Array.isArray(row.aspects) || !Array.isArray(row.styles)) invalid();
    const references = record(row.references);
    const pricing = record(row.pricing);
    const length = row.durationSeconds === undefined || row.durationSeconds === null ? null : record(row.durationSeconds);
    return {
      id: serviceId(row.id), surface: row.surface, label: text(row.label, 120), credits: count(row.credits),
      ...(AUDIO_KINDS.includes(row.audioKind as OpenPixoGenerationAudioKind) ? { audioKind: row.audioKind as OpenPixoGenerationAudioKind } : {}),
      ...(row.surface === 'model3d' && MODEL3D_QUALITIES.includes(row.quality) ? { quality: row.quality as OpenPixoModel3dQuality } : {}),
      priceVersion: count(row.priceVersion), maxPromptChars: count(row.maxPromptChars),
      ...(row.minPromptChars === undefined || row.minPromptChars === null ? {} : { minPromptChars: count(row.minPromptChars) }),
      ...(length ? { durationSeconds: { min: seconds(length.min), max: seconds(length.max), default: seconds(length.default) } } : {}),
      aspects: (row.aspects as unknown[]).map((aspect) => ASPECTS.includes(aspect as OpenPixoGenerationAspect) ? aspect as OpenPixoGenerationAspect : invalid()),
      styles: (row.styles as unknown[]).slice(0, 50).map((style) => text(style, 100)),
      references: { min: count(references.min), max: Math.min(count(references.max), MAX_HOSTED_REFERENCES) },
      pricing: { longPromptTokens: count(pricing.longPromptTokens), longPromptCredits: count(pricing.longPromptCredits),
        maxPromptTokens: count(pricing.maxPromptTokens), extraReferenceCredits: count(pricing.extraReferenceCredits) },
    };
  });
  return { services, generationPaused: item.generationPaused };
}

export function generationQuote(value: unknown): OpenPixoGenerationQuote {
  const item = record(value);
  const digest = text(item.paramsDigest, 64);
  if (!SHA256.test(digest)) invalid();
  const breakdown = record(item.breakdown);
  return { quoteId: uuid(item.quoteId), service: serviceId(item.service), credits: count(item.credits),
    priceVersion: count(item.priceVersion), paramsDigest: digest, expiresAt: date(item.expiresAt), available: Number.isSafeInteger(item.available) ? item.available as number : invalid(),
    breakdown: { base: count(breakdown.base), longPrompt: count(breakdown.longPrompt), extraReferences: count(breakdown.extraReferences) } };
}

export function generationReference(value: unknown): OpenPixoGenerationReferenceResponse {
  const item = record(value);
  const sha256 = text(item.sha256, 64);
  if (!SHA256.test(sha256)) invalid();
  return { sha256, uploadUrl: item.uploadUrl === null ? null : text(item.uploadUrl, 4096) };
}

export function generationJob(value: unknown): OpenPixoCloudGenerationJob {
  const item = record(value);
  const state = STATES.includes(item.state as OpenPixoGenerationJobState) ? item.state as OpenPixoGenerationJobState : invalid();
  let artifact: OpenPixoCloudGenerationJob['artifact'] = null;
  if (item.artifact !== null && item.artifact !== undefined) {
    const row = record(item.artifact);
    const sha = row.sha256 === null ? null : text(row.sha256, 64);
    if ((sha !== null && !/^[0-9a-f]{64}$/u.test(sha)) || !MIMES.includes(row.mime as (typeof MIMES)[number])) invalid();
    artifact = { mime: row.mime as (typeof MIMES)[number], bytes: count(row.bytes), sha256: sha };
  }
  let download: OpenPixoCloudGenerationJob['download'] = null;
  if (item.download !== null && item.download !== undefined) {
    const row = record(item.download);
    download = { url: text(row.url, 4096), expiresAt: date(row.expiresAt) };
  }
  if (state === 'succeeded' && !artifact) invalid();
  return {
    jobId: uuid(item.jobId), service: serviceId(item.service), state, creditsReserved: count(item.creditsReserved),
    creditsCharged: item.creditsCharged === null ? null : count(item.creditsCharged),
    errorCode: item.errorCode === null ? null : text(item.errorCode, 64), artifact, download,
    createdAt: date(item.createdAt), updatedAt: date(item.updatedAt),
  };
}

/** Local pre-check only; the cloud re-validates every field against its own caps. */
export function generationParams(value: unknown): OpenPixoGenerationParams {
  const item = record(value);
  if (typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > 12_000) throw new AccountError('GENERATION_PARAMS_INVALID');
  if (item.aspect !== undefined && !ASPECTS.includes(item.aspect as OpenPixoGenerationAspect)) throw new AccountError('GENERATION_PARAMS_INVALID');
  if (item.style !== undefined && (typeof item.style !== 'string' || !item.style || item.style.length > 100)) throw new AccountError('GENERATION_PARAMS_INVALID');
  if (item.duration !== undefined && (typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > MAX_DURATION_SECONDS)) throw new AccountError('GENERATION_PARAMS_INVALID');
  if (item.references !== undefined && (!Array.isArray(item.references) || item.references.length > MAX_HOSTED_REFERENCES
    || item.references.some((ref) => typeof ref !== 'string' || !SHA256.test(ref)))) throw new AccountError('GENERATION_PARAMS_INVALID');
  return { prompt: item.prompt, ...(item.aspect !== undefined ? { aspect: item.aspect as OpenPixoGenerationAspect } : {}),
    ...(item.style !== undefined ? { style: item.style as string } : {}),
    ...(item.duration !== undefined ? { duration: item.duration as number } : {}),
    ...(Array.isArray(item.references) && item.references.length ? { references: item.references as string[] } : {}) };
}

export function assertServiceId(value: unknown): string {
  if (typeof value !== 'string' || !OPENPIXO_SERVICE_ID.test(value)) throw new AccountError('GENERATION_SERVICE_UNKNOWN');
  return value;
}

export function assertQuoteId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AccountError('GENERATION_CONFIRMATION_REQUIRED');
  return value;
}

export function assertJobId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AccountError('GENERATION_JOB_NOT_FOUND');
  return value;
}
