// Which installed art styles the setup dialog offers, and in what order.
import type { ArtStyle } from '@openpixo/contracts';

/** The 2D looks, most common first. `sprite-diorama` is 2D and 3D and keeps this place whenever 2D shows. */
export const WIZARD_STYLE_ORDER_2D = [
  'pixel-16-bit', 'pixel-8-bit', 'isometric-pixel', 'sprite-diorama', 'crt-card-table', 'cel-anime', 'chibi-cute',
  'cozy-pastel', 'flat-vector', 'watercolor-storybook', 'painted-fantasy', 'painted-cutout', 'dark-gothic',
] as const;

export const WIZARD_STYLE_ORDER_3D = ['toon-3d', 'low-poly-3d', 'voxel-3d', 'retro-low-poly'] as const;

/**
 * Installed styles the dialog does not offer. They are not deleted: older
 * projects and the Store still use them.
 */
export const WIZARD_HIDDEN_STYLES = ['horde-topdown', 'vaporwave-crt', 'ink-woodcut'] as const;

/**
 * The styles the setup dialog offers for a game's view, in order:
 * - only styles that fit the view's dimension (2D or 3D); a view that is both,
 *   or none yet, offers all, and when nothing fits, everything is offered rather
 *   than nothing;
 * - the curated styles first, in their curated order: the 2D ones, then the 3D
 *   ones, except that a 3D-only view lists `sprite-diorama` after the 3D ones;
 * - then any other installed style (a user's or community plugin), in the order
 *   the daemon listed them;
 * - the hidden styles never, unless `chosenStyleId` is one of them (an older
 *   project being edited), which then comes last so the user still sees it.
 */
export function wizardStyleList(
  styles: readonly ArtStyle[],
  dimension: '2d' | '3d' | 'both' | null,
  chosenStyleId = '',
): ArtStyle[] {
  const fitting = dimension === '2d' || dimension === '3d' ? styles.filter(style => style.dimension.includes(dimension)) : [...styles];
  const offered = fitting.length ? fitting : [...styles];
  const curated: readonly string[] = dimension === '3d'
    ? [...WIZARD_STYLE_ORDER_3D, ...WIZARD_STYLE_ORDER_2D]
    : [...WIZARD_STYLE_ORDER_2D, ...WIZARD_STYLE_ORDER_3D];
  const hidden: readonly string[] = WIZARD_HIDDEN_STYLES;
  const rank = (style: ArtStyle) => {
    const place = curated.indexOf(style.id);
    return place >= 0 ? place : curated.length;
  };
  // Array.prototype.sort is stable, so styles outside the curated list keep the daemon's order.
  const visible = offered.filter(style => !hidden.includes(style.id)).sort((a, b) => rank(a) - rank(b));
  const kept = offered.filter(style => hidden.includes(style.id) && style.id === chosenStyleId);
  return [...visible, ...kept];
}
