import { resolveLocalizedText, type InputField, type PluginManifest } from '@openpixo/contracts';
import { studioCopy } from './copy';

type RecipeCopy = Pick<PluginManifest, 'title_i18n' | 'description_i18n'> & {
  title: string;
  description: string;
};

/** Canonical recipe copy remains the English fallback when a manifest only translates other locales. */
export function localizedRecipeCopy(recipe: RecipeCopy, locale: string) {
  return {
    title: resolveLocalizedText({ en: recipe.title, ...recipe.title_i18n }, locale),
    description: resolveLocalizedText({ en: recipe.description, ...recipe.description_i18n }, locale),
  };
}

/**
 * A recipe's fields as this locale's form reads them. Names and option values stay as the manifest
 * wrote them, because those are what the recipe receives. A free-text prefill changes, and the
 * recipe receives what the box shows.
 */
export function localizedRecipeInputs(fields: InputField[], locale: string): InputField[] {
  return fields.map((field) => {
    const optionLabels = field.optionLabels_i18n?.[locale];
    return {
      ...field,
      label: resolveLocalizedText({ en: field.label ?? field.name, ...field.label_i18n }, locale),
      ...(field.placeholder === undefined ? {} : {
        placeholder: resolveLocalizedText({ en: field.placeholder, ...field.placeholder_i18n }, locale),
      }),
      ...(optionLabels ? { optionLabels } : {}),
      ...(typeof field.default === 'string' && field.default_i18n ? {
        default: resolveLocalizedText({ en: field.default, ...field.default_i18n }, locale),
      } : {}),
    };
  });
}

type ProviderKind = keyof ReturnType<typeof studioCopy>['needsProvider'];

const CAPABILITY_PROVIDER_KINDS: Record<string, ProviderKind> = {
  t2i: 'image',
  i2i: 'image',
  inpaint: 'image',
  t2v: 'video',
  i2v: 'video',
  music: 'audio',
  tts: 'audio',
  sfx: 'audio',
  audio: 'audio',
  'voice-clone': 'audio',
  'image-to-3d': 'model3d',
};

function providerKind(capabilities: string[]): ProviderKind {
  const kinds = new Set(capabilities.map((capability) => (
    Object.hasOwn(CAPABILITY_PROVIDER_KINDS, capability) ? (CAPABILITY_PROVIDER_KINDS[capability] ?? 'generic') : 'generic'
  )));
  const [only] = kinds;
  return kinds.size === 1 && only ? only : 'generic';
}

/** The quiet hint on a recipe's row. */
export function missingProviderCopy(capabilities: string[], locale: string): string {
  return studioCopy(locale).needsProvider[providerKind(capabilities)];
}

/**
 * Says what a recipe needs to run. Recipe runs do not spend credits today, so a
 * user with credits must not read this as "credits will do".
 */
export function recipeNeedsSentence(capabilities: string[], locale: string): string {
  return studioCopy(locale).recipeNeeds[providerKind(capabilities)];
}
