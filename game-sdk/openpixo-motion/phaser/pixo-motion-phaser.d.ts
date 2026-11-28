// SPDX-License-Identifier: Apache-2.0
// Types for pixo-motion-phaser.js, for TypeScript games. The player itself is plain JavaScript.
import type { PixoMotion, PixoMotionOptions } from './pixo-motion.min.js';

export type { PixoMotion, PixoMotionOptions };

/** What addPixoMotion needs of a scene. Every Phaser.Scene has it. */
export interface PixoMotionScene {
  add: { image(x: number, y: number, texture: string): object };
}

/**
 * Adds the character loaded under `key` (with `this.load.binary(key, file)`) to the scene, as a normal Phaser Image
 * whose `motion` drives it.
 */
export function addPixoMotion<S extends PixoMotionScene>(
  scene: S, x: number, y: number, key: string, options?: PixoMotionOptions,
): Promise<ReturnType<S['add']['image']> & { motion: PixoMotion }>;
