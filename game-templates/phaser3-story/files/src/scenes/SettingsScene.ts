import Phaser from 'phaser';
import { listen } from '../controls.ts';
import { provide, withdraw } from '../inspect.ts';
import { loadSettings, saveSettings, type Settings } from '../storage.ts';
import { languages, pickLanguage } from '../story/files.ts';
import { languageName, t, useLanguage } from '../strings.ts';
import { Menu, panel, text, THEME } from '../ui.ts';

/**
 * Settings over the title screen or the pause menu: language, music and sound
 * volume, and fullscreen. Left and right change a row; Back or Esc closes it and
 * resumes the screen that opened it.
 */
export class SettingsScene extends Phaser.Scene {
  private from = 'Title';
  private settings!: Settings;
  private menu!: Menu;

  constructor() {
    super('Settings');
  }

  init(data: { from?: string }): void {
    this.from = data.from ?? 'Title';
  }

  create(): void {
    this.settings = loadSettings();
    this.events.once('shutdown', () => { this.menu.destroy(); withdraw('settings'); });
    listen(this, action => {
      if (action === 'up') this.menu.move(-1);
      else if (action === 'down') this.menu.move(1);
      else if (action === 'left') this.change(-1);
      else if (action === 'right') this.change(1);
      else if (action === 'confirm') this.menu.focused === 4 ? this.close() : this.change(1);
      else if (action === 'back' || action === 'pause') this.close();
    });
    this.build();
    provide('settings', () => ({ rows: this.menu.buttons.map(button => button.label.text), focused: this.menu.focused }));
  }

  /** `focused` keeps the row in focus when a change redraws the screen; a fresh visit starts on the first. */
  private build(focused = 0): void {
    this.children.removeAll(true);
    this.menu?.destroy();
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x05070b, 0.72).setOrigin(0).setInteractive();
    panel(this, width / 2 - 300, height / 2 - 250, 600, 500);
    text(this, width / 2, height / 2 - 210, t('MENU_SETTINGS'), 32).setOrigin(0.5);
    text(this, width / 2, height / 2 - 170, t('SETTINGS_HINT'), 16, THEME.muted).setOrigin(0.5);
    this.menu = new Menu(this, 480);
    const percent = (value: number) => `${Math.round(value * 100)}%`;
    const language = this.settings.language ? languageName(this.settings.language) : t('SETTINGS_LANGUAGE_SYSTEM');
    const row = (name: Parameters<typeof t>[0], value: string) => t('SETTINGS_ROW', { name: t(name), value });
    const rows: Array<[string, () => void]> = [
      [row('SETTINGS_LANGUAGE', language), () => this.change(1)],
      [row('SETTINGS_VOLUME_MUSIC', percent(this.settings.music)), () => this.change(1)],
      [row('SETTINGS_VOLUME_SFX', percent(this.settings.sfx)), () => this.change(1)],
      [row('SETTINGS_FULLSCREEN', t(this.scale.isFullscreen ? 'SETTINGS_ON' : 'SETTINGS_OFF')), () => this.change(1)],
      [t('SETTINGS_BACK'), () => this.close()],
    ];
    rows.forEach(([label, onPress], index) => this.menu.add(width / 2, height / 2 - 100 + index * 62, label, onPress));
    this.menu.focus(focused);
  }

  private change(step: number): void {
    const row = this.menu.focused;
    if (row === 0) {
      const options = ['', ...languages()];
      this.settings.language = options[(options.indexOf(this.settings.language) + step + options.length) % options.length]!;
      useLanguage(this.settings.language || pickLanguage(navigator.language));
    } else if (row === 1 || row === 2) {
      const key = row === 1 ? 'music' : 'sfx';
      this.settings[key] = Math.round(Math.min(1, Math.max(0, this.settings[key] + step * 0.1)) * 10) / 10;
    } else if (row === 3) {
      if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen();
      this.time.delayedCall(150, () => this.build(row));
    } else {
      return;
    }
    saveSettings(this.settings);
    this.game.events.emit('settings-changed');
    this.build(row);
  }

  private close(): void {
    this.scene.stop();
    this.scene.resume(this.from);
  }
}
