import { z } from 'zod';
import { ASSET_OP_NAMES } from '../api/asset-ops.js';

// `pixo.json` schema (v1). Mirrors docs/schemas/openpixo.plugin.v1.json
// with one addition: this Zod schema is permissive on the top level so adapter
// outputs (synthesized PluginManifest from SKILL.md frontmatter or claude
// plugin.json) parse cleanly without losing forward-compatible fields.

export const OPENPIXO_PLUGIN_SPEC_VERSION = '1.0.0';

export const OpenPixoSpecVersionSchema = z.string().min(1);

export const ReferenceSchema = z.object({
  ref:  z.string().optional(),
  path: z.string().optional(),
}).passthrough();

export const RefPathSchema = z.object({
  path: z.string().min(1),
}).passthrough();

export const McpServerSpecSchema = z.object({
  name:    z.string().min(1),
  command: z.string().optional(),
  args:    z.array(z.string()).optional(),
  env:     z.record(z.string()).optional(),
  url:     z.string().optional(),
}).passthrough();

export type McpServerSpec = z.infer<typeof McpServerSpecSchema>;

export const LocalizedTextSchema = z.record(z.string()).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Localized text must include at least one locale.' },
);

export type LocalizedText = string | z.infer<typeof LocalizedTextSchema>;

export const InputFieldSchema = z.object({
  name:        z.string().min(1),
  label:       z.string().optional(),
  label_i18n:  LocalizedTextSchema.optional(),
  type:        z.enum(['string', 'text', 'select', 'number', 'boolean', 'file', 'image-ref', 'asset-ref', 'character-ref', 'aspect', 'count']).optional(),
  required:    z.boolean().optional(),
  options:     z.array(z.string()).optional(),
  /** What each option reads as, by locale then option value. The recipe still receives the value from `options`. */
  optionLabels_i18n: z.record(z.record(z.string())).optional(),
  placeholder: z.string().optional(),
  placeholder_i18n: LocalizedTextSchema.optional(),
  default:     z.unknown().optional(),
  /** Prefill for a free-text field, by locale. The recipe receives what the box holds; `default` still serves the CLI and API. */
  default_i18n: LocalizedTextSchema.optional(),
}).passthrough();

export type InputField = z.infer<typeof InputFieldSchema>;

/** Translation changes what a form reads as, never which values a recipe can receive. */
function validateRecipeInputTranslations(input: InputField, report: (message: string) => void): void {
  for (const labels of Object.values(input.optionLabels_i18n ?? {})) {
    for (const value of Object.keys(labels)) {
      if (!input.options?.includes(value)) report(`Input ${input.name} translates an option it does not have: ${value}`);
    }
  }
  const freeText = input.type === undefined || input.type === 'string' || input.type === 'text';
  if (input.default_i18n && (!freeText || typeof input.default !== 'string')) {
    report(`Input ${input.name} has default_i18n, which only a free-text field with a default can use`);
  }
}

export const RecipeSurfaceSchema = z.enum(['image', 'audio', 'video', 'model3d', 'code']);
export type RecipeSurface = z.infer<typeof RecipeSurfaceSchema>;
export const RecipeCheckSchema = z.object({
  check: z.enum(['has-alpha', 'dimensions', 'grid-divisible', 'seamless', 'loudness-range', 'duration-range']),
  params: z.record(z.unknown()).optional(),
});

/** Portable relative paths, including before template substitution. */
export function isRecipeRelativePath(value: string): boolean {
  return value.length > 0 && !value.includes('..') && !/^(?:[\\/]|[a-z]:)/i.test(value)
    && !/[\x00-\x1f:]/.test(value.replace(/\{\{[^{}]+\}\}/g, ''));
}

export const RecipeSchema = z.object({
  surface: RecipeSurfaceSchema,
  category: z.string().min(1),
  engines: z.array(z.string().min(1)).default(['any']),
  inputs: z.array(InputFieldSchema).default([]),
  prompt: z.string().min(1).optional(),
  negative: z.string().optional(),
  models: z.object({
    requires: z.array(z.string()).default([]),
    recommended: z.array(z.string()).default([]),
    fallback: z.array(z.string()).default([]),
  }).optional(),
  generation: z.object({
    count: z.object({ default: z.number().int().min(1).max(32), max: z.number().int().min(1).max(32) })
      .refine(value => value.default <= value.max, 'Default count exceeds max'),
    aspect: z.string().optional(),
    /**
     * Ask the image model for a transparent background. A model that cannot
     * return alpha paints a key colour chosen away from the prompt's colours,
     * and the host keys it out with a soft edge, so no remove-bg step is needed.
     */
    background: z.enum(['transparent']).optional(),
  }).optional(),
  postprocess: z.array(z.object({ op: z.enum(ASSET_OP_NAMES), params: z.record(z.unknown()).optional(), optional: z.boolean().optional() })).optional(),
  checks: z.array(RecipeCheckSchema).optional(),
  output: z.object({
    dir: z.string().refine(isRecipeRelativePath, 'output.dir must be relative and contain no ..'),
    name: z.string().min(1),
  }).optional(),
}).superRefine((recipe, ctx) => {
  if (recipe.surface === 'code') {
    if (recipe.prompt || recipe.models || recipe.postprocess) ctx.addIssue({ code: 'custom', message: 'Code recipes use pixo.useCase.query and pixo.context.skills' });
  } else if (!recipe.prompt || !recipe.models || !recipe.output) {
    ctx.addIssue({ code: 'custom', message: 'Media recipes require prompt, models, and output' });
  }
  const names = recipe.inputs.map(input => input.name);
  if (new Set(names).size !== names.length || names.some(name => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))) {
    ctx.addIssue({ code: 'custom', message: 'Recipe input names must be unique bare names' });
  }
  for (const input of recipe.inputs) validateRecipeInputTranslations(input, message => ctx.addIssue({ code: 'custom', message }));
  validateRecipeTemplateVariables(recipe, recipe, message => ctx.addIssue({ code: 'custom', message }));
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** Substitution only: no property traversal beyond the documented host variables. */
export function validateRecipeTemplateVariables(
  value: unknown, recipe: { inputs: InputField[] }, report: (message: string) => void,
): void {
  const allowed = new Set(recipe.inputs.map(input => input.name));
  for (const name of ['id', 'assetRoot', 'spriteRoot', 'textureRoot', 'uiRoot', 'audioRoot', 'modelRoot']) allowed.add(`engine.${name}`);
  if (recipe.inputs.some(input => input.type === 'character-ref')) {
    for (const name of ['slug', 'name', 'description', 'style']) allowed.add(`character.${name}`);
  }
  function visit(item: unknown): void {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/\{\{([^{}]*)\}\}/g)) if (!allowed.has(match[1]!)) report(`Unknown template variable: ${match[1]}`);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  }
  visit(value);
}

/** Portable starter prompts; keep this wire shape identical for skills, recipes and styles. */
export const PluginExampleSchema = z.object({
  title: z.string(),
  title_i18n: z.object({ 'zh-CN': z.string() }).strict().optional(),
  prompt: z.string(),
  prompt_i18n: z.object({ 'zh-CN': z.string() }).strict().optional(),
}).strict();
export type PluginExample = z.infer<typeof PluginExampleSchema>;

export const ArtStyleConstraintsSchema = z.object({
  pixelSize: z.number().int().positive().optional(),
  colorCount: z.number().int().min(1).max(256).optional(),
  outline: z.string().optional(),
  background: z.enum(['transparent', 'scene']).optional(),
  recommendedResolution: z.string().optional(),
}).strict();
export type ArtStyleConstraints = z.infer<typeof ArtStyleConstraintsSchema>;

/** Style data is independent from its plugin's title, description and distribution metadata. */
export const ArtStyleSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  dimension: z.array(z.enum(['2d', '3d'])).min(1),
  medium: z.array(z.string().min(1)).min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string(),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  constraints: ArtStyleConstraintsSchema.optional(),
  previews: z.array(z.string().refine(isRecipeRelativePath, 'Preview must be relative and contain no ..')),
}).strict();
export type ArtStyleDefinition = z.infer<typeof ArtStyleSchema>;

export function resolveLocalizedText(
  value: LocalizedText | undefined,
  locale?: string,
  fallbackLocale = 'en',
): string {
  if (!value) return '';
  if (typeof value === 'string') return value;

  const candidates = [
    locale,
    locale?.split('-')[0],
    fallbackLocale,
    fallbackLocale.split('-')[0],
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = value[candidate];
    if (typeof resolved === 'string' && resolved.length > 0) return resolved;
  }

  return Object.values(value).find((text) => text.length > 0) ?? '';
}

export const PipelineStageSchema = z.object({
  id:        z.string().min(1),
  atoms:     z.array(z.string()),
  repeat:    z.boolean().optional(),
  until:     z.string().optional(),
  onFailure: z.enum(['abort', 'skip', 'retry']).optional(),
}).passthrough();

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const PluginPipelineSchema = z.object({
  stages: z.array(PipelineStageSchema),
}).passthrough();

export type PluginPipeline = z.infer<typeof PluginPipelineSchema>;

export const PluginManifestSchema = z.object({
  $schema:     z.string().optional(),
  specVersion: OpenPixoSpecVersionSchema.optional(),
  name:        z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/),
  title:       z.string().optional(),
  title_i18n:  LocalizedTextSchema.optional(),
  version:     z.string().min(1),
  description: z.string().optional(),
  description_i18n: LocalizedTextSchema.optional(),
  examples: z.array(PluginExampleSchema).optional(),
  author:   z.object({
    name: z.string().optional(),
    url:  z.string().optional(),
  }).passthrough().optional(),
  license:  z.string().optional(),
  homepage: z.string().optional(),
  // ISO 8601 timestamp of when the plugin was first published to its
  // catalog. Shipped metadata — unlike the installed-record timestamps it
  // does not depend on when a particular machine seeded its database, so
  // recency ordering survives fresh installs and catalog re-stamps.
  publishedAt: z.string().optional(),
  icon:     z.string().optional(),
  tags:     z.array(z.string()).optional(),
  compat: z.object({
    agentSkills:   z.array(RefPathSchema).optional(),
    claudePlugins: z.array(RefPathSchema).optional(),
  }).passthrough().optional(),
  pixo: z.object({
    kind:     z.enum(['skill', 'scenario', 'atom', 'bundle', 'recipe', 'style']).optional(),
    recipe: RecipeSchema.optional(),
    style: ArtStyleSchema.optional(),
    taskKind: z.enum(['new-generation', 'code-migration', 'figma-migration', 'tune-collab']).optional(),
    mode:     z.string().optional(),
    platform: z.string().optional(),
    scenario: z.string().optional(),
    engineRequirements: z.object({
      pixo: z.string().optional(),
    }).passthrough().optional(),
    preview: z.object({
      type:   z.string().optional(),
      entry:  z.string().optional(),
      poster: z.string().optional(),
      video:  z.string().optional(),
      gif:    z.string().optional(),
      // How the gallery bakes this HTML preview's hover clip: 'scroll' (vertical
      // pan), 'deck' (walk a horizontal slideshow), 'static' (hold a single
      // screen). Omit to auto-detect from the page's scroll height.
      motion: z.enum(['scroll', 'deck', 'static']).optional(),
    }).passthrough().optional(),
    useCase: z.object({
      query: z.union([z.string(), LocalizedTextSchema]).optional(),
      exampleOutputs: z.array(z.object({
        path:  z.string(),
        title: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
    context: z.object({
      skills:        z.array(ReferenceSchema).optional(),
      designSystem:  z.union([
        ReferenceSchema,
        z.object({ ref: z.string().optional(), primary: z.boolean().optional() }).passthrough(),
      ]).optional(),
      assets:        z.array(z.string()).optional(),
      claudePlugins: z.array(ReferenceSchema).optional(),
      mcp:           z.array(McpServerSpecSchema).optional(),
      atoms:         z.array(z.string()).optional(),
    }).passthrough().optional(),
    pipeline: PluginPipelineSchema.optional(),
    inputs: z.array(InputFieldSchema).optional(),
    capabilities: z.array(z.string()).optional(),
  }).passthrough().superRefine((pixo, ctx) => {
    if (pixo.kind === 'style' && !pixo.style) ctx.addIssue({ code: 'custom', message: 'Style plugins require pixo.style' });
    if (pixo.kind !== 'recipe') return;
    if (!pixo.recipe) { ctx.addIssue({ code: 'custom', message: 'Recipe plugins require pixo.recipe' }); return; }
    if (pixo.recipe.surface === 'code' && !pixo.useCase?.query) ctx.addIssue({ code: 'custom', message: 'Code recipes require pixo.useCase.query' });
    if (pixo.recipe.surface === 'code') validateRecipeTemplateVariables(pixo.useCase?.query, pixo.recipe, message => ctx.addIssue({ code: 'custom', message }));
  }).optional(),
}).passthrough();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
