import type { ArtStyle, AssetOpRequest } from '@openpixo/contracts';

export interface RecipePostprocessStep {
  op: AssetOpRequest['op'];
  params: Record<string, unknown>;
  optional?: boolean | undefined;
}

const pixelTag = (value: string) => /(?:^|[\s,_-])pixel(?:s|[\s_-]?art)?(?:$|[\s,_-])|像素/i.test(value);

/** Style defaults enter after final frame geometry and before analysis/export. Explicit op parameters win. */
export function applyRecipePostprocessStyle(steps: RecipePostprocessStep[], style: ArtStyle | null, inputs: Record<string, unknown>): RecipePostprocessStep[] {
  const tags = (style as (ArtStyle & { tags?: string[] }) | null)?.tags ?? [];
  const explicit = Object.entries(inputs).filter(([key]) => /^(?:art_?style|style)$/i.test(key)).map(([, value]) => String(value));
  const pixel = style?.constraints?.pixelSize !== undefined || [...(style?.medium ?? []), ...tags, style?.id ?? '', ...explicit].some(pixelTag);
  if (!pixel) return steps;
  const result = steps.map(step => ({ ...step, params: { ...(step.op === 'resize' ? { filter: 'nearest' } : {}), ...step.params } }));
  const additions: RecipePostprocessStep[] = [];
  if (!steps.some(step => step.op === 'pixelate')) additions.push({ op: 'pixelate', params: { pixelSize: style?.constraints?.pixelSize ?? 1 } });
  const colorCount = style?.constraints?.colorCount ?? style?.palette?.length;
  const explicitPalette = steps.some(step => (step.op === 'palette' && step.params.apply === true) || (step.op === 'pixelate' && step.params.palette !== undefined));
  if (colorCount && !explicitPalette) {
    additions.push({ op: 'palette', params: { apply: true, colors: colorCount, ...(style?.palette?.length ? { palette: [...style.palette] } : {}) } });
  }
  const geometry = result.reduce((last, step, index) => ['resize', 'trim', 'remove-bg', 'slice', 'pixelate'].includes(step.op) ? index : last, -1);
  result.splice(geometry + 1, 0, ...additions);
  return result;
}
