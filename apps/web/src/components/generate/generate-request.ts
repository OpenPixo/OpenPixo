import {
  OPENPIXO_MODEL3D_DEFAULT_QUALITY,
  OPENPIXO_MODEL3D_SERVICES,
  type GetMediaCapabilitiesResponse,
  type OpenPixoGenerationService,
  type OpenPixoModel3dQuality,
  type RecipeQuoteRequest,
  type RecipeRun,
} from '@openpixo/contracts';
import { estimateGenerationCredits } from '../studio/hosted-estimate';

/**
 * What the 生成 view makes (specs/current/asset-generator.md §4): each kind is one
 * plain recipe, so the generator, the agent and the CLI all run the same thing.
 */
export type GenerateKind = 'image' | 'sfx' | 'voice' | 'music' | 'model3d';
export const GENERATE_KINDS: readonly GenerateKind[] = ['image', 'sfx', 'voice', 'music', 'model3d'];
export type GenerateTab = 'image' | 'audio' | 'model3d';
export const AUDIO_KINDS: readonly GenerateKind[] = ['sfx', 'voice', 'music'];
export const tabOfKind = (kind: GenerateKind): GenerateTab => kind === 'image' || kind === 'model3d' ? kind : 'audio';

export interface GenerateKindSpec {
  /** The plain recipe's catalogue id. */
  recipeId: string;
  /** The media capability an own tool needs for it. */
  capability: string;
  /** The hosted service it is priced on when no own tool makes it. */
  service: string;
  maxCount: number;
  defaultCount: number;
  /** File name when the description gives none in Latin letters. */
  fallbackName: string;
  maxReferences: number;
}

export const KIND_SPECS: Readonly<Record<GenerateKind, GenerateKindSpec>> = {
  image: { recipeId: 'image', capability: 't2i', service: 'openpixo-image', maxCount: 4, defaultCount: 2, fallbackName: 'image', maxReferences: 3 },
  sfx: { recipeId: 'sound-effect', capability: 'sfx', service: 'openpixo-sfx', maxCount: 4, defaultCount: 3, fallbackName: 'sound', maxReferences: 0 },
  voice: { recipeId: 'npc-voice-lines', capability: 'tts', service: 'openpixo-voice', maxCount: 4, defaultCount: 1, fallbackName: 'voice', maxReferences: 0 },
  music: { recipeId: 'music', capability: 'music', service: 'openpixo-music', maxCount: 4, defaultCount: 1, fallbackName: 'music', maxReferences: 0 },
  model3d: { recipeId: 'model-from-image', capability: 'image-to-3d', service: OPENPIXO_MODEL3D_SERVICES[OPENPIXO_MODEL3D_DEFAULT_QUALITY], maxCount: 2, defaultCount: 1, fallbackName: 'model', maxReferences: 1 },
};

const IMAGE_REFERENCE_INPUTS = ['reference', 'reference2', 'reference3'] as const;

export interface GenerateForm {
  kind: GenerateKind;
  /** The description, or the line to speak. */
  text: string;
  /** Project-relative image paths, in the order picked. */
  references: string[];
  aspect: string;
  transparent: boolean;
  seconds: number;
  voice: string;
  quality: OpenPixoModel3dQuality;
  count: number;
}

export function initialGenerateForm(kind: GenerateKind = 'image', references: readonly string[] = []): GenerateForm {
  return { kind, text: '', references: references.slice(0, Math.max(KIND_SPECS[kind].maxReferences, 0)), aspect: '1:1', transparent: false,
    seconds: 1, voice: '', quality: OPENPIXO_MODEL3D_DEFAULT_QUALITY, count: KIND_SPECS[kind].defaultCount };
}

/** Switching kind keeps the description and whatever references still fit. */
export function withKind(form: GenerateForm, kind: GenerateKind): GenerateForm {
  if (form.kind === kind) return form;
  return { ...form, kind, references: form.references.slice(0, KIND_SPECS[kind].maxReferences), count: KIND_SPECS[kind].defaultCount };
}

/** A file name the recipe accepts: lowercase Latin letters, digits and underscores. */
export function fileNameFrom(text: string, fallback: string): string {
  const slug = text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 40).replace(/_+$/u, '');
  return slug || fallback;
}

/** Whether the box holds enough to make something. */
export function generateFormReady(form: GenerateForm): boolean {
  if (form.kind === 'model3d') return form.references.length === 1;
  if (!form.text.trim()) return false;
  if (form.kind === 'voice') return Boolean(form.voice.trim());
  return true;
}

/** True when a tool of the user's own makes this kind, so nothing is spent. */
export function ownToolMakes(form: GenerateForm, media: GetMediaCapabilitiesResponse | null): boolean {
  const capability = form.kind === 'image' && form.references.length ? 'i2i' : KIND_SPECS[form.kind].capability;
  return media?.capabilities?.[capability]?.configured === true;
}

/** The hosted service this form is priced on when it is paid with credits. */
export function hostedServiceId(form: GenerateForm): string {
  if (form.kind === 'model3d') return OPENPIXO_MODEL3D_SERVICES[form.quality];
  if (form.kind === 'image' && form.references.length) return 'openpixo-image-edit';
  return KIND_SPECS[form.kind].service;
}

/**
 * The run request for this form. Built once per click: the quote and the run it
 * pays for must ask for the same thing, file name included.
 */
export function generateRequest(form: GenerateForm, options: { ownTool: boolean }): RecipeQuoteRequest {
  const spec = KIND_SPECS[form.kind];
  const text = form.text.trim();
  const count = Math.min(Math.max(1, Math.trunc(form.count) || 1), spec.maxCount);
  let inputs: Record<string, unknown>;
  switch (form.kind) {
    case 'image':
      inputs = { prompt: text, aspect: form.aspect, transparent: form.transparent, name: fileNameFrom(text, spec.fallbackName),
        ...Object.fromEntries(form.references.slice(0, IMAGE_REFERENCE_INPUTS.length).map((path, index) => [IMAGE_REFERENCE_INPUTS[index]!, path])) };
      break;
    case 'sfx': inputs = { prompt: text, duration: form.seconds, name: fileNameFrom(text, spec.fallbackName) }; break;
    case 'voice': inputs = { line: text, voice: form.voice.trim(), name: fileNameFrom(text, spec.fallbackName) }; break;
    case 'music': inputs = { prompt: text, name: fileNameFrom(text, spec.fallbackName) }; break;
    case 'model3d': {
      const image = form.references[0] ?? '';
      inputs = { image, name: fileNameFrom(image.replace(/^.*\//u, '').replace(/\.[^.]+$/u, ''), spec.fallbackName) };
      break;
    }
  }
  // Only a paid 3D run names its tier; an own tool picks its own model.
  return { recipeId: spec.recipeId, inputs, count, ...(form.kind === 'model3d' && !options.ownTool ? { model: hostedServiceId(form) } : {}) };
}

/** The approximate credits the button shows; the cloud's quote decides, and a higher one stops and asks. */
export function generateEstimate(form: GenerateForm, services: readonly OpenPixoGenerationService[]): number | null {
  const service = services.find(entry => entry.id === hostedServiceId(form));
  if (!service) return null;
  return estimateGenerationCredits(service, form.text, form.kind === 'image' ? form.references.length : 0) * Math.max(1, form.count);
}

/** The kind a run of a plain recipe was, or null for a preset. */
export function kindOfRun(run: Pick<RecipeRun, 'recipeId'>): GenerateKind | null {
  return GENERATE_KINDS.find(kind => KIND_SPECS[kind].recipeId === run.recipeId || `openpixo/${KIND_SPECS[kind].recipeId}` === run.recipeId) ?? null;
}

/** 改一下: the box filled with what made this run, or null when a preset made it. */
export function formFromRun(run: Pick<RecipeRun, 'recipeId' | 'inputs' | 'candidates' | 'model'>): GenerateForm | null {
  const kind = kindOfRun(run);
  if (!kind) return null;
  const inputs = run.inputs;
  const text = String(inputs.prompt ?? inputs.line ?? '');
  const references = kind === 'model3d' ? [String(inputs.image ?? '')].filter(Boolean)
    : IMAGE_REFERENCE_INPUTS.map(name => inputs[name]).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const quality = (Object.entries(OPENPIXO_MODEL3D_SERVICES).find(([, id]) => id === run.model.id)?.[0] ?? OPENPIXO_MODEL3D_DEFAULT_QUALITY) as OpenPixoModel3dQuality;
  return { ...initialGenerateForm(kind), text, references, aspect: typeof inputs.aspect === 'string' ? inputs.aspect : '1:1',
    transparent: inputs.transparent === true, seconds: typeof inputs.duration === 'number' ? inputs.duration : 1,
    voice: typeof inputs.voice === 'string' ? inputs.voice : '', quality, count: Math.max(1, run.candidates.length) };
}

/** What a run was asked for, as one line for its history card. */
export function runSummary(run: Pick<RecipeRun, 'inputs'>): string {
  const inputs = run.inputs;
  const text = inputs.prompt ?? inputs.line ?? inputs.items ?? inputs.image ?? inputs.name ?? '';
  return String(text);
}
