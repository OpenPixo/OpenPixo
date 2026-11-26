// SPDX-License-Identifier: Apache-2.0
// Pixo Motion for Phaser 3. Load the file as binary, then add the character to a scene:
//   preload() { this.load.binary('hero', 'hero.pxmo'); }
//   async create() { const hero = await addPixoMotion(this, 640, 360, 'hero', { width: 512, height: 640 }); hero.motion.mood('happy'); }
// The character is a normal Phaser Image (scale, depth, tweens, containers all work); hero.motion drives it.
import { createPixoMotion } from './pixo-motion.min.js';
let count = 0;
export async function addPixoMotion(scene, x, y, key, opts = {}) {
  const motion = await createPixoMotion(scene.cache.binary.get(key), opts);
  const texKey = `pxmo:${key}:${++count}`, tex = scene.textures.addImage(texKey, motion.canvas), img = scene.add.image(x, y, texKey);
  img.motion = motion;
  const tick = (_t, delta) => { if (img.active && img.visible) { motion.update(delta / 1000); tex.source[0].update(); } };
  scene.events.on('update', tick);
  img.once('destroy', () => { scene.events.off('update', tick); scene.textures.remove(texKey); });
  return img;
}
