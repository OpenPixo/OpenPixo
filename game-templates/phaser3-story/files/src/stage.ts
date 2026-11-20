import Phaser from 'phaser';
import { asset, characterColor, characterName } from './story/files.ts';
import type { OnStage } from './story/runner.ts';
import { text } from './ui.ts';

/**
 * The background and the characters on stage. A picture comes from assets/ by
 * name (src/story/files.ts); until one exists, a background is a soft gradient
 * and a character a coloured silhouette, so a story plays before any art is
 * made. The dev server labels each placeholder with its name.
 */

/** Horizontal centre of each stage position, as a share of the width. */
const POSITIONS: Record<string, number> = { left: 0.24, center: 0.5, right: 0.76 };
/** A character picture's height as a share of the screen height. */
const PORTRAIT_HEIGHT = 0.92;
/** How a character who is not speaking is tinted. */
const DIMMED = 0x8c91a6;

export class Stage {
  private scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.layer = scene.add.container(0, 0);
  }

  /** `speaker` is the character talking now; the others are drawn dimmer. '' lights everyone. */
  show(background: string, cast: Record<string, OnStage>, language: string, speaker = ''): void {
    this.layer.removeAll(true);
    const { width, height } = this.scene.scale;
    const lit = (id: string) => !speaker || !(speaker in cast) || speaker === id;
    const picture = background ? asset.background(background) : '';
    if (picture && this.scene.textures.exists(picture)) {
      const image = this.scene.add.image(width / 2, height / 2, picture);
      image.setScale(Math.max(width / image.width, height / image.height));
      this.layer.add(image);
    } else {
      this.layer.add(this.gradient(background, width, height));
      if (import.meta.env.DEV && background) this.layer.add(text(this.scene, 24, 24, `bg: ${background}`, 16, 'rgba(255,255,255,0.4)'));
    }
    for (const [id, onStage] of Object.entries(cast)) {
      const x = width * (POSITIONS[onStage.position] ?? 0.5);
      const portrait = asset.portrait(id, onStage.expression);
      if (portrait && this.scene.textures.exists(portrait)) {
        const image = this.scene.add.image(x, height, portrait).setOrigin(0.5, 1);
        image.setScale(height * PORTRAIT_HEIGHT / image.height);
        if (!lit(id)) image.setTint(DIMMED);
        this.layer.add(image);
        continue;
      }
      this.layer.add(this.silhouette(id, x, height, lit(id)));
      if (import.meta.env.DEV) {
        const label = `${characterName(id, language)} · ${onStage.expression || 'neutral'}`;
        this.layer.add(text(this.scene, x, height * 0.42 - height * 0.075 - 26, label, 16, lit(id) ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)').setOrigin(0.5, 0));
      }
    }
  }

  private gradient(name: string, width: number, height: number): Phaser.GameObjects.Graphics {
    let seed = 0;
    for (const char of name) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    const hue = (seed % 1000) / 1000;
    const top = Phaser.Display.Color.HSVToRGB(hue, 0.35, name ? 0.34 : 0.08) as Phaser.Types.Display.ColorObject;
    const bottom = Phaser.Display.Color.HSVToRGB((hue + 0.08) % 1, 0.45, name ? 0.14 : 0.04) as Phaser.Types.Display.ColorObject;
    const topColor = Phaser.Display.Color.GetColor(top.r, top.g, top.b);
    const bottomColor = Phaser.Display.Color.GetColor(bottom.r, bottom.g, bottom.b);
    return this.scene.add.graphics().fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1).fillRect(0, 0, width, height);
  }

  /** Head and shoulders in the character's colour, lit from above. */
  private silhouette(id: string, x: number, height: number, lit: boolean): Phaser.GameObjects.Graphics {
    const base = Phaser.Display.Color.IntegerToColor(characterColor(id));
    if (!lit) base.darken(35);
    const radius = height * 0.075;
    const headY = height * 0.42;
    const shoulders = headY + radius * 0.95;
    const half = radius * 2.1;
    const light = base.clone().lighten(8).color;
    const dark = base.clone().darken(45).color;
    const graphics = this.scene.add.graphics();
    // Rounded shoulders in the light colour, then shading that fades to the bottom of the screen.
    const corner = radius * 1.3;
    graphics.fillStyle(light, 1).fillRoundedRect(x - half, shoulders, half * 2, height - shoulders + corner, { tl: corner, tr: corner, bl: 0, br: 0 });
    graphics.fillGradientStyle(light, light, dark, dark, 1).fillRect(x - half, shoulders + corner, half * 2, height - shoulders - corner);
    graphics.fillStyle(base.clone().darken(40).color, 1).fillCircle(x, headY, radius + 3);
    graphics.fillStyle(base.clone().lighten(5).color, 1).fillCircle(x, headY, radius);
    return graphics;
  }
}
