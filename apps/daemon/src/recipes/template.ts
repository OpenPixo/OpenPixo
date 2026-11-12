import type { CharacterCard, EngineProfile, Recipe } from '@openpixo/contracts';
import { isRecipeRelativePath } from '@openpixo/contracts';

export function validateRecipeInputs(recipe: Recipe, supplied: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const name of Object.keys(supplied)) if (!recipe.inputs.some(field => field.name === name)) throw new Error(`Unknown input: ${name}`);
  for (const field of recipe.inputs) {
    let value = supplied[field.name] ?? field.default;
    if (value === undefined || value === '') { if (field.required) throw new Error(`Missing input: ${field.name}`); if (value === undefined) continue; }
    const type = field.type ?? 'string';
    if (type === 'number' || type === 'count') {
      if (typeof value === 'string' && value.trim()) value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'count' && (!Number.isInteger(value) || value < 1 || value > 32))) throw new Error(`Invalid numeric input: ${field.name}`);
    } else if (type === 'boolean') {
      if (value === 'true' || value === 'false') value = value === 'true';
      if (typeof value !== 'boolean') throw new Error(`Invalid boolean input: ${field.name}`);
    } else {
      if (typeof value !== 'string') throw new Error(`Input must be text: ${field.name}`);
      if (type === 'select' && !field.options?.includes(value)) throw new Error(`Invalid option: ${field.name}`);
      if (type === 'aspect' && !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid aspect: ${field.name}`);
      if (['image-ref', 'asset-ref', 'file'].includes(type) && !isRecipeRelativePath(value)) throw new Error(`Invalid reference: ${field.name}`);
    }
    inputs[field.name] = value;
  }
  return inputs;
}

export function recipeVariables(inputs: Record<string, unknown>, engine?: EngineProfile | null, character?: CharacterCard): Record<string, unknown> {
  const root = (engine?.assetRoots[0] || 'assets').replaceAll('\\', '/').replace(/\/$/, '') || 'assets';
  return { ...inputs, 'engine.id': engine?.engine ?? 'unknown', 'engine.assetRoot': root,
    ...Object.fromEntries(Object.entries({ sprite: 'sprites', texture: 'textures', ui: 'ui', audio: 'audio', model: 'models' })
      .map(([key, dir]) => [`engine.${key}Root`, `${root}/${dir}`])),
    ...(character ? Object.fromEntries(['slug', 'name', 'description', 'style'].map(key => [`character.${key}`, character[key as keyof CharacterCard]])) : {}),
  };
}
export function renderRecipeTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([^{}]*)\}\}/g, (_match, name: string) => {
    const value = Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : undefined;
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Missing template variable: ${name}`);
    return String(value);
  });
}
export function renderRecipeParams(value: Record<string, unknown> | undefined, variables: Record<string, unknown>): Record<string, unknown> {
  function render(item: unknown): unknown {
    if (typeof item === 'string') {
      const rendered = renderRecipeTemplate(item, variables);
      // Select inputs carry strings; a whole numeric slot must reach the typed asset op as a number.
      return /^\{\{[^{}]+\}\}$/.test(item) && /^-?\d+(?:\.\d+)?$/.test(rendered) ? Number(rendered) : rendered;
    }
    if (Array.isArray(item)) return item.map(render);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, render(val)]));
    return item;
  }
  return render(value ?? {}) as Record<string, unknown>;
}
