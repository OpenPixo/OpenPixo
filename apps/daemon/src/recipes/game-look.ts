import type { ArtStyle } from '@openpixo/contracts';

/**
 * The look a recipe run is made in. Inside a game, the game's look fills a recipe's
 * `style` slot whenever the request leaves it empty, so a preset never brings a look of
 * its own (reported 2026-11-18: a recipe's "pixel art" default turned a hand-painted
 * game's icons into pixel art, because once the user had set the look nothing else in
 * the request named it).
 *
 * The style reference image is not attached here: whether new art passes it stays the
 * agent's or the user's choice (owner, 2026-11-11). The slot only names it in words.
 */
export interface RecipeLook {
  /**
   * An installed style the request names, or the game's own while the user has not set
   * the look (`resolveArtStyleForGeneration`). Its prompt is merged below the recipe's.
   */
  artStyle: ArtStyle | null;
  /** The look the user wrote in Game setup (`gameSetup.art.direction`). */
  direction?: string | undefined;
  /** The run is for a game, so "the game's existing art" means something. */
  inGame?: boolean | undefined;
  /** The user gave the game a pixel grid in Game setup, so resizes keep hard pixels. */
  pixelGrid?: boolean | undefined;
}

/** Older callers pass just the style; a bare style is a look with nothing else known. */
export function recipeLook(value: RecipeLook | ArtStyle | null | undefined): RecipeLook {
  if (!value) return { artStyle: null };
  return 'artStyle' in value ? value : { artStyle: value };
}

/** What a game's metadata says about its look, for a recipe run in it. */
export function gameLookFromMetadata(metadata: unknown): Pick<RecipeLook, 'direction' | 'pixelGrid'> {
  const art = (metadata as { gameSetup?: { art?: { direction?: unknown; pixelSize?: unknown } } } | null | undefined)?.gameSetup?.art;
  const direction = typeof art?.direction === 'string' ? art.direction.trim() : '';
  return { ...(direction ? { direction } : {}), ...(typeof art?.pixelSize === 'number' ? { pixelGrid: true } : {}) };
}

/**
 * The words for a recipe's `style` slot when the request left it empty. The order is
 * the order of authority: a style the request named (or the game's, before the user set
 * the look), then the user's own words from Game setup, then the game's existing art.
 * Only with no game and no style does the slot ask for a neutral, consistent look.
 */
export function recipeStyleSlot(look: RecipeLook, hasReferences: boolean): string {
  if (look.artStyle) return look.artStyle.title || look.artStyle.id;
  if (look.direction) return look.direction;
  const detail = 'the same medium, outline, shading and level of detail';
  if (look.inGame) return `match the game's existing art${hasReferences ? ' and the reference images' : ''} (${detail})`;
  return hasReferences ? `match the reference images (${detail})` : 'one consistent, readable game-art style';
}
