import type { GetMediaCapabilitiesResponse, RecipeSummary } from '@openpixo/contracts';

export async function getStudioMediaCapabilities(signal: AbortSignal): Promise<GetMediaCapabilitiesResponse> {
  const response = await fetch('/api/media/capabilities', { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function missingRecipeCapabilities(recipe: Pick<RecipeSummary, 'requires'>, media: GetMediaCapabilitiesResponse | null): string[] {
  if (!media) return [];
  return recipe.requires.filter(capability => !media.capabilities[capability]?.configured);
}

/** The daemon reports availability for keyed and keyless providers alike. */
export function hasAvailableMediaProvider(media: GetMediaCapabilitiesResponse | null): boolean {
  return !!media && Object.values(media.capabilities).some(capability => capability.configured);
}
