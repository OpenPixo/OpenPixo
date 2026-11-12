import { describe, expect, it } from 'vitest';
import type { ArtStyle } from '@openpixo/contracts';

import {
  WIZARD_HIDDEN_STYLES,
  WIZARD_STYLE_ORDER_2D,
  WIZARD_STYLE_ORDER_3D,
  wizardStyleList,
} from '../../src/components/new-game/style-order';

const style = (id: string, dimension: Array<'2d' | '3d'>): ArtStyle => ({ id, title: id, description: '', dimension, medium: [] }) as unknown as ArtStyle;

// Every official style, in the daemon's (alphabetical) order, plus one from a community plugin.
const installed: ArtStyle[] = [
  style('cel-anime', ['2d']), style('chibi-cute', ['2d']), style('community-ink', ['2d']), style('cozy-pastel', ['2d']),
  style('crt-card-table', ['2d']), style('dark-gothic', ['2d']), style('flat-vector', ['2d']), style('horde-topdown', ['2d']),
  style('ink-woodcut', ['2d']), style('isometric-pixel', ['2d']), style('low-poly-3d', ['3d']), style('painted-cutout', ['2d']),
  style('painted-fantasy', ['2d']), style('pixel-16-bit', ['2d']), style('pixel-8-bit', ['2d']), style('retro-low-poly', ['3d']),
  style('sprite-diorama', ['2d', '3d']), style('toon-3d', ['3d']), style('vaporwave-crt', ['2d']), style('voxel-3d', ['3d']), style('watercolor-storybook', ['2d']),
];
const ids = (list: ArtStyle[]) => list.map(item => item.id);

describe('wizardStyleList', () => {
  it('lists the 2D styles in the curated order, then styles from other plugins', () => {
    expect(ids(wizardStyleList(installed, '2d'))).toEqual([...WIZARD_STYLE_ORDER_2D, 'community-ink']);
  });

  it('lists the 3D styles first for a 3D view, with sprite-diorama after them', () => {
    expect(ids(wizardStyleList(installed, '3d'))).toEqual([...WIZARD_STYLE_ORDER_3D, 'sprite-diorama']);
  });

  it('offers both when the view is both or not chosen yet, without the hidden styles', () => {
    for (const dimension of ['both', null] as const) {
      expect(ids(wizardStyleList(installed, dimension))).toEqual([...WIZARD_STYLE_ORDER_2D, ...WIZARD_STYLE_ORDER_3D, 'community-ink']);
    }
  });

  it('never offers the hidden styles to a new choice', () => {
    for (const dimension of ['2d', '3d', 'both', null] as const) {
      const offered = ids(wizardStyleList(installed, dimension, 'pixel-16-bit'));
      for (const hidden of WIZARD_HIDDEN_STYLES) expect(offered).not.toContain(hidden);
    }
  });

  it('still shows a hidden style the setup already uses, at the end', () => {
    const offered = ids(wizardStyleList(installed, '2d', 'vaporwave-crt'));
    expect(offered.at(-1)).toBe('vaporwave-crt');
    expect(offered).toEqual([...WIZARD_STYLE_ORDER_2D, 'community-ink', 'vaporwave-crt']);
    expect(offered).not.toContain('horde-topdown');
  });

  it('offers everything rather than nothing when no style fits the view', () => {
    const flat = [style('pixel-16-bit', ['2d']), style('ink-woodcut', ['2d'])];
    expect(ids(wizardStyleList(flat, '3d'))).toEqual(['pixel-16-bit']);
  });
});
