import { describe, expect, it } from 'vitest';
import { hasAvailableMediaProvider, missingRecipeCapabilities } from '../../src/components/studio/media-capabilities';

describe('daemon media availability', () => {
  it('accepts a keyless provider the daemon reports as available', () => {
    const media = { capabilities: { t2i: { configured: true, providers: ['codex'] } } };
    expect(hasAvailableMediaProvider(media)).toBe(true);
    expect(missingRecipeCapabilities({ requires: ['t2i'] }, media)).toEqual([]);
  });
  it('does not treat a listed but unavailable provider as ready', () => {
    const media = { capabilities: { t2i: { configured: false, providers: ['codex'] } } };
    expect(hasAvailableMediaProvider(media)).toBe(false);
    expect(missingRecipeCapabilities({ requires: ['t2i'] }, media)).toEqual(['t2i']);
    expect(hasAvailableMediaProvider(null)).toBe(false);
  });
});
