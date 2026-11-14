import {
  OPENPIXO_GENERATION_ASPECTS,
  OPENPIXO_GENERATION_RESOLUTIONS,
  OPENPIXO_MODEL3D_DEFAULT_QUALITY,
  OPENPIXO_MODEL3D_SERVICES,
  type GetMediaCapabilitiesResponse,
  type InputField,
  type OpenPixoGenerationAspect,
  type OpenPixoGenerationResolution,
  type OpenPixoGenerationService,
  type OpenPixoModel3dQuality,
  parseOpenPixoResolution,
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
  image: { recipeId: 'image', capability: 't2i', service: 'openpixo-image', maxCount: 8, defaultCount: 2, fallbackName: 'image', maxReferences: 3 },
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
  /** Images only: how large, `1k` to `4k`. A larger one costs more credits. */
  resolution: OpenPixoGenerationResolution;
  transparent: boolean;
  seconds: number;
  voice: string;
  quality: OpenPixoModel3dQuality;
  count: number;
  /**
   * Images only: a style id, null for no style, or undefined for the default (the game's
   * style, or none with no game).
   */
  styleId?: string | null | undefined;
  /**
   * A preset put in the box as a tag: the description goes into its free-text field and
   * `inputs` holds its other settings. Absent for the box's own kinds.
   */
  preset?: GeneratePreset | undefined;
}

/** A preset in the box: which recipe, and the settings picked for it so far. */
export interface GeneratePreset { id: string; inputs: Record<string, unknown> }

export function initialGenerateForm(kind: GenerateKind = 'image', references: readonly string[] = []): GenerateForm {
  return { kind, text: '', references: references.slice(0, Math.max(KIND_SPECS[kind].maxReferences, 0)), aspect: '1:1', resolution: '1k', transparent: false,
    seconds: 1, voice: '', quality: OPENPIXO_MODEL3D_DEFAULT_QUALITY, count: KIND_SPECS[kind].defaultCount };
}

/** Switching kind keeps the description and whatever references still fit, and takes the preset tag off. */
export function withKind(form: GenerateForm, kind: GenerateKind): GenerateForm {
  if (form.kind === kind && !form.preset) return form;
  const { preset: _preset, ...rest } = form;
  return { ...rest, kind, references: form.references.slice(0, KIND_SPECS[kind].maxReferences),
    count: form.kind === kind ? form.count : KIND_SPECS[kind].defaultCount };
}

/** The tab a preset sits under, and the kind the box shows while it is in the box. */
export function presetKind(recipe: { surface: string; requires?: readonly string[] | undefined }): GenerateKind {
  if (recipe.surface === 'model3d') return 'model3d';
  if (recipe.surface !== 'audio') return 'image';
  return recipe.requires?.includes('music') ? 'music' : recipe.requires?.includes('tts') ? 'voice' : 'sfx';
}

/**
 * Puts a preset in the box as a tag; the box's references and its own settings step aside.
 * With a sample (做同款, one of the preset's examples) its settings come too, and its words
 * fill the description when the box has none of the user's own.
 */
export function withPreset(form: GenerateForm, recipe: { id: string; surface: string; requires?: readonly string[] | undefined },
  sample?: { prompt?: string | undefined; inputs?: Record<string, unknown> | undefined }): GenerateForm {
  if (form.preset?.id === recipe.id && !sample) return form;
  const text = form.text.trim() || !sample?.prompt ? form.text : sample.prompt;
  return { ...form, text, kind: presetKind(recipe), references: [], count: 1, preset: { id: recipe.id, inputs: { ...sample?.inputs } } };
}

/** A style picked on the page: the box makes images in it. */
export function withStyle(form: GenerateForm, styleId: string): GenerateForm {
  return { ...(form.kind === 'image' ? form : withKind(form, 'image')), styleId };
}

/** Fields the box fills from the description's words: a file name the recipe asks for. */
const NAME_FIELDS = new Set(['name', 'setName']);
const PICTURE_FIELDS = new Set(['image-ref', 'asset-ref', 'character-ref', 'file']);
const isText = (field: InputField) => field.type === undefined || field.type === 'string' || field.type === 'text';

/** The preset field the box's description fills: its first required free text that is not a file name. */
export function presetPromptField(fields: readonly InputField[]): InputField | null {
  return fields.find(field => isText(field) && field.required && !NAME_FIELDS.has(field.name))
    ?? fields.find(field => isText(field) && !NAME_FIELDS.has(field.name)) ?? null;
}

/**
 * Whether a preset can run from the box: it takes a description and needs no picture,
 * file or character. One that does opens its own form instead.
 */
export function presetFitsBox(fields: readonly InputField[]): boolean {
  return presetPromptField(fields) !== null && !fields.some(field => field.required && PICTURE_FIELDS.has(field.type ?? ''));
}

/** The preset's settings the box shows along its bottom: everything but the description, file names and pictures. */
export function presetSettings(fields: readonly InputField[]): InputField[] {
  const prompt = presetPromptField(fields);
  return fields.filter(field => field !== prompt && !NAME_FIELDS.has(field.name) && !PICTURE_FIELDS.has(field.type ?? '') && field.type !== 'count');
}

const filled = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';

/** A preset's recipe as the box needs it: its fields and how many it may make. */
export interface PresetRecipe {
  id: string;
  surface: string;
  fields: readonly InputField[];
  count?: { default: number; max: number } | undefined;
}

/** Whether the box holds enough to run this preset: a description and every required setting. */
export function presetReady(form: GenerateForm, recipe: PresetRecipe): boolean {
  if (!form.text.trim() || !presetFitsBox(recipe.fields)) return false;
  return presetSettings(recipe.fields).every(field => !field.required || filled(form.preset?.inputs[field.name] ?? field.default));
}

/** The run request for a preset in the box: its defaults, the settings picked, the description and a file name from it. */
export function presetRequest(form: GenerateForm, recipe: PresetRecipe): RecipeQuoteRequest {
  const text = form.text.trim();
  const prompt = presetPromptField(recipe.fields);
  const inputs: Record<string, unknown> = {};
  for (const field of recipe.fields) if (field.default !== undefined) inputs[field.name] = field.default;
  Object.assign(inputs, form.preset?.inputs ?? {});
  if (prompt) inputs[prompt.name] = text;
  const fallback = recipe.id.replace(/^.*\//u, '').replace(/-/gu, '_');
  for (const field of recipe.fields) if (NAME_FIELDS.has(field.name)) inputs[field.name] = fileNameFrom(text, fallback);
  const takesCount = !recipe.fields.some(field => field.type === 'count');
  const count = Math.min(Math.max(1, Math.trunc(form.count) || 1), recipe.count?.max ?? 4);
  return { recipeId: recipe.id, inputs, ...(takesCount ? { count } : {}),
    ...(recipe.surface === 'image' && form.styleId !== undefined ? { styleId: form.styleId } : {}) };
}

/** The hosted service a preset is priced on, from the first capability it needs. */
const CAPABILITY_SERVICE: Record<string, string> = {
  t2i: 'openpixo-image', i2i: 'openpixo-image-edit', sfx: 'openpixo-sfx', music: 'openpixo-music', tts: 'openpixo-voice',
  'image-to-3d': OPENPIXO_MODEL3D_SERVICES[OPENPIXO_MODEL3D_DEFAULT_QUALITY],
};
export function presetServiceId(requires: readonly string[]): string | null {
  for (const capability of requires) if (CAPABILITY_SERVICE[capability]) return CAPABILITY_SERVICE[capability]!;
  return null;
}

/** The approximate credits for a preset; its own template adds to the words, so the cloud's quote may come back higher and ask. */
export function presetEstimate(form: GenerateForm, requires: readonly string[], services: readonly OpenPixoGenerationService[]): number | null {
  const id = presetServiceId(requires);
  const service = id ? services.find(entry => entry.id === id) : undefined;
  if (!service) return null;
  return estimateGenerationCredits(service, form.text, 0) * Math.max(1, form.count);
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
      inputs = { prompt: text, aspect: form.aspect, resolution: form.resolution, transparent: form.transparent, name: fileNameFrom(text, spec.fallbackName),
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
  return { recipeId: spec.recipeId, inputs, count, ...(form.kind === 'model3d' && !options.ownTool ? { model: hostedServiceId(form) } : {}),
    ...(form.kind === 'image' && form.styleId !== undefined ? { styleId: form.styleId } : {}) };
}

/** The approximate credits the button shows; the cloud's quote decides, and a higher one stops and asks. */
export function generateEstimate(form: GenerateForm, services: readonly OpenPixoGenerationService[]): number | null {
  const service = services.find(entry => entry.id === hostedServiceId(form));
  if (!service) return null;
  const image = form.kind === 'image';
  return estimateGenerationCredits(service, form.text, image ? form.references.length : 0, image ? sizeOffer(form, service).resolution : undefined) * Math.max(1, form.count);
}

/**
 * The shapes and resolutions the box offers, and which of them this form gets. An own tool
 * takes any; a hosted service only what it sells, and a pick it does not sell falls back
 * (the daemon renders the nearest shape, and 1K, and says so).
 */
export function sizeOffer(form: Pick<GenerateForm, 'aspect' | 'resolution'>, service: Pick<OpenPixoGenerationService, 'aspects' | 'resolutions'> | undefined): {
  aspects: readonly OpenPixoGenerationAspect[]; resolutions: readonly OpenPixoGenerationResolution[]; resolution: OpenPixoGenerationResolution;
} {
  const aspects = service ? OPENPIXO_GENERATION_ASPECTS.filter(aspect => service.aspects.includes(aspect)) : OPENPIXO_GENERATION_ASPECTS;
  const resolutions = service ? OPENPIXO_GENERATION_RESOLUTIONS.filter(value => value === '1k' || service.resolutions?.includes(value)) : OPENPIXO_GENERATION_RESOLUTIONS;
  return { aspects, resolutions, resolution: resolutions.includes(form.resolution) ? form.resolution : '1k' };
}

/** The kind a run of a plain recipe was, or null for a preset. */
export function kindOfRun(run: Pick<RecipeRun, 'recipeId'>): GenerateKind | null {
  return GENERATE_KINDS.find(kind => KIND_SPECS[kind].recipeId === run.recipeId || `openpixo/${KIND_SPECS[kind].recipeId}` === run.recipeId) ?? null;
}

/** 改一下: the box filled with what made this run, or null when a preset made it. */
export function formFromRun(run: Pick<RecipeRun, 'recipeId' | 'inputs' | 'candidates' | 'model'> & Partial<Pick<RecipeRun, 'styleId'>>): GenerateForm | null {
  const kind = kindOfRun(run);
  if (!kind) return null;
  const inputs = run.inputs;
  const text = String(inputs.prompt ?? inputs.line ?? '');
  const references = kind === 'model3d' ? [String(inputs.image ?? '')].filter(Boolean)
    : IMAGE_REFERENCE_INPUTS.map(name => inputs[name]).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const quality = (Object.entries(OPENPIXO_MODEL3D_SERVICES).find(([, id]) => id === run.model.id)?.[0] ?? OPENPIXO_MODEL3D_DEFAULT_QUALITY) as OpenPixoModel3dQuality;
  return { ...initialGenerateForm(kind), text, references, aspect: typeof inputs.aspect === 'string' ? inputs.aspect : '1:1',
    resolution: parseOpenPixoResolution(inputs.resolution) ?? '1k',
    transparent: inputs.transparent === true, seconds: typeof inputs.duration === 'number' ? inputs.duration : 1,
    voice: typeof inputs.voice === 'string' ? inputs.voice : '', quality, count: Math.max(1, run.candidates.length),
    ...(kind === 'image' && run.styleId !== undefined ? { styleId: run.styleId } : {}) };
}

/** What a run was asked for, as one line for its history card. */
export function runSummary(run: Pick<RecipeRun, 'inputs'>): string {
  const inputs = run.inputs;
  const text = inputs.prompt ?? inputs.line ?? inputs.items ?? inputs.image ?? inputs.name ?? '';
  return String(text);
}
