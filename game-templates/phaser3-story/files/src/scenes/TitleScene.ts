import Phaser from 'phaser';
import { GAME } from '../config.ts';
import { listen } from '../controls.ts';
import { provide, withdraw } from '../inspect.ts';
import { loadGame, loadSettings } from '../storage.ts';
import { allAssets, pickLanguage } from '../story/files.ts';
import { t, useLanguage } from '../strings.ts';
import { Menu, text } from '../ui.ts';

/** The first screen: the game's name, Continue when there is a save, New game and Settings. */
export class TitleScene extends Phaser.Scene {
  private menu!: Menu;

  constructor() {
    super('Title');
  }

  preload(): void {
    // Every picture and sound under assets/, keyed by URL, so the story never waits on a file.
    for (const url of allAssets.pictures) if (!this.textures.exists(url)) this.load.image(url, url);
    for (const url of allAssets.sounds) if (!this.cache.audio.exists(url)) this.load.audio(url, url);
  }

  create(): void {
    const settings = loadSettings();
    useLanguage(settings.language || pickLanguage(navigator.language));
    this.sound.pauseOnBlur = false;
    // Scene events outlive a restart, so the handler goes when the scene does.
    const rebuild = () => this.build();
    this.events.on('resume', rebuild);
    this.events.once('shutdown', () => { this.events.off('resume', rebuild); this.menu.destroy(); withdraw('title'); });
    listen(this, action => {
      if (!this.scene.isActive()) return;
      if (action === 'up') this.menu.move(-1);
      else if (action === 'down') this.menu.move(1);
      else if (action === 'confirm') this.menu.press();
    });
    this.build();
  }

  /** Drawn again after Settings closes, in case the language changed. */
  private build(): void {
    const reopened = Boolean(this.menu?.buttons.length);
    this.children.removeAll(true);
    this.menu?.destroy();
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x182230).setOrigin(0);
    text(this, width / 2, height * 0.3, GAME.title, 56).setOrigin(0.5);
    this.menu = new Menu(this);
    const saved = loadGame();
    let y = height * 0.5;
    const add = (key: Parameters<typeof t>[0], onPress: () => void) => { this.menu.add(width / 2, y, t(key), onPress); y += 58; };
    if (saved) add('MENU_CONTINUE', () => this.scene.start('Story', { continue: true }));
    add('MENU_NEW_GAME', () => this.scene.start('Story', { continue: false }));
    const settingsRow = this.menu.buttons.length;
    add('MENU_SETTINGS', () => { this.scene.launch('Settings', { from: 'Title' }); this.scene.pause(); });
    // Back from Settings, the focus stays on Settings, as a gamepad player expects.
    if (reopened) this.menu.focus(settingsRow);
    provide('title', () => ({ buttons: this.menu.buttons.map(button => button.label.text), focused: this.menu.focused }));
  }
}
