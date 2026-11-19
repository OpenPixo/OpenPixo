import Phaser from 'phaser';

/** The look shared by every screen. */
export const THEME = {
  font: 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  text: '#f4f6fb',
  muted: '#9aa7bd',
  panel: 0x0c0f17,
  button: 0x24303f,
  buttonHover: 0x334153,
  buttonOn: 0x3b4a5e,
  focus: 0x6ee7b7,
};

export function text(scene: Phaser.Scene, x: number, y: number, value: string, size = 22, color = THEME.text): Phaser.GameObjects.Text {
  return scene.add.text(x, y, value, { fontFamily: THEME.font, fontSize: `${size}px`, color });
}

/** A rounded panel drawn into a Graphics object. */
export function panel(scene: Phaser.Scene, x: number, y: number, width: number, height: number, alpha = 0.96): Phaser.GameObjects.Graphics {
  return scene.add.graphics().fillStyle(THEME.panel, alpha).fillRoundedRect(x, y, width, height, 14);
}

export interface MenuButton {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setLabel(value: string): void;
}

/**
 * A column of buttons a player can use with the mouse, the keyboard or a gamepad:
 * up and down move the focus, confirm presses, and the pointer focuses what it is over.
 */
export class Menu {
  readonly buttons: MenuButton[] = [];
  focused = 0;
  private scene: Phaser.Scene;
  private actions: Array<() => void> = [];
  private backgrounds: Phaser.GameObjects.Graphics[] = [];
  private width: number;

  constructor(scene: Phaser.Scene, width = 340) {
    this.scene = scene;
    this.width = width;
  }

  add(x: number, y: number, label: string, onPress: () => void, height = 46): MenuButton {
    const index = this.buttons.length;
    const background = this.scene.add.graphics();
    const caption = text(this.scene, 0, 0, label, 21).setOrigin(0.5);
    const container = this.scene.add.container(x, y, [background, caption]).setSize(this.width, height);
    container.setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.focus(index))
      .on('pointerdown', () => { this.focus(index); onPress(); });
    const button: MenuButton = { container, label: caption, setLabel: value => caption.setText(value) };
    this.buttons.push(button);
    this.actions.push(onPress);
    this.backgrounds.push(background);
    this.draw();
    return button;
  }

  focus(index: number): void {
    if (!this.buttons.length) return;
    this.focused = (index + this.buttons.length) % this.buttons.length;
    this.draw();
  }

  move(step: number): void {
    this.focus(this.focused + step);
  }

  press(): void {
    this.actions[this.focused]?.();
  }

  destroy(): void {
    for (const button of this.buttons) button.container.destroy();
    this.buttons.length = 0;
    this.actions.length = 0;
    this.backgrounds.length = 0;
  }

  private draw(): void {
    this.backgrounds.forEach((background, index) => {
      const { width, height } = this.buttons[index]!.container;
      background.clear().fillStyle(index === this.focused ? THEME.buttonHover : THEME.button, 1)
        .fillRoundedRect(-width / 2, -height / 2, width, height, 8);
      if (index === this.focused) background.lineStyle(2, THEME.focus, 1).strokeRoundedRect(-width / 2 - 2, -height / 2 - 2, width + 4, height + 4, 9);
    });
  }
}
