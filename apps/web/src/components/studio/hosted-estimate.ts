import { openPixoResolutionCredits, type OpenPixoGenerationResolution, type OpenPixoGenerationService } from '@openpixo/contracts';

/**
 * Mirrors the cloud's token estimate for pricing: CJK characters count one token
 * each, everything else about four characters per token.
 */
export function estimatePromptTokens(prompt: string): number {
  const wide = prompt.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return wide + Math.ceil(([...prompt].length - wide) / 4);
}

/**
 * The approximate cost shown next to Generate. The cloud prices the real request
 * and charges exactly; if its quote comes back above this number the card stops
 * and asks instead of spending more than the button showed.
 */
export function estimateGenerationCredits(service: Pick<OpenPixoGenerationService, 'credits' | 'pricing'> & Partial<Pick<OpenPixoGenerationService, 'surface'>>, prompt: string, referenceCount: number,
  resolution?: OpenPixoGenerationResolution): number {
  // A 3D model has a fixed prompt and one picture, so nothing can add to its base price.
  if (service.surface === 'model3d') return service.credits;
  const longPrompt = estimatePromptTokens(prompt) > service.pricing.longPromptTokens ? service.pricing.longPromptCredits : 0;
  const extraReferences = Math.max(0, referenceCount - 1) * service.pricing.extraReferenceCredits;
  return service.credits + longPrompt + extraReferences + openPixoResolutionCredits(service, resolution);
}
