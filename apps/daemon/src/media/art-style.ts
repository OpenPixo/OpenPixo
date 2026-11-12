import type { ArtStyle } from '@openpixo/contracts';

/** The merged constraint line; providers without native alpha get a keyable backdrop instead. */
export const TRANSPARENT_BACKGROUND_CONSTRAINT = 'Background: transparent.';

export interface ImageArtStyleRequest {
  prompt?: string | undefined;
  negativePrompt?: string | undefined;
  resolution?: string | undefined;
  background?: 'transparent' | 'scene' | undefined;
}

/**
 * Preserve the subject first, then add the preset and its effective constraints.
 * Explicit request settings override preset defaults. Negative fragments retain
 * caller-before-preset order in one provider-neutral Avoid block, so every image
 * backend receives the same instruction even without a negative-prompt field.
 */
export function mergeImageArtStyle(request: ImageArtStyleRequest, style: ArtStyle | null): {
  prompt: string;
  resolution?: string | undefined;
} {
  const resolution = request.resolution || style?.constraints?.recommendedResolution;
  const background = request.background ?? style?.constraints?.background;
  const constraints: string[] = [];
  if (style?.palette?.length) constraints.push(`Palette: ${style.palette.join(', ')}.`);
  if (style?.constraints?.pixelSize !== undefined) constraints.push(`Pixel grid unit: ${style.constraints.pixelSize}px.`);
  if (style?.constraints?.outline) constraints.push(`Outline: ${style.constraints.outline}.`);
  if (background) constraints.push(background === 'transparent' ? TRANSPARENT_BACKGROUND_CONSTRAINT : 'Background: a complete scene.');
  if (resolution && style) constraints.push(`${request.resolution ? 'Output resolution' : 'Recommended output resolution'}: ${resolution}.`);
  const negative = [request.negativePrompt, style?.negativePrompt].filter((part): part is string => Boolean(part?.trim()));
  const prompt = [request.prompt, style?.prompt, constraints.join('\n'), negative.length ? `Avoid: ${negative.join(', ')}` : undefined]
    .filter((part): part is string => Boolean(part)).join('\n\n');
  return { prompt, ...(resolution ? { resolution } : {}) };
}

