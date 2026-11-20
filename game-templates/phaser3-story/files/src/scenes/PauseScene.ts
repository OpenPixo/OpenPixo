import Phaser from 'phaser';
import { listen } from '../controls.ts';
import { provide, withdraw } from '../inspect.ts';
import { t } from '../strings.ts';
import { Menu, text } from '../ui.ts';

/** Opens over the story on Esc or Start: resume, settings, or quit to the title (the story saves as it closes). */
export class PauseScene extends Phaser.Scene {
  private menu!: Menu;

  constructor() {
    super('Pause');
  }

  create(): void {
    // Scene events outlive a restart, so the handler goes when the scene does.
    const rebuild = () => this.build();
    this.events.on('resume', rebuild);
    this.events.once('shutdown', () => { this.events.off('resume', rebuild); withdraw('pause'); });
    listen(this, action => {
      if (action === 'up') this.menu.move(-1);
      else if (action === 'down') this.menu.move(1);
      else if (action === 'confirm') this.menu.press();
      else if (action === 'back' || action === 'pause') this.resumeStory();
    });
    this.build();
    provide('pause', () => ({ buttons: this.menu.buttons.map(button => button.label.text), focused: this.menu.focused }));
  }

  private build(): void {
    this.children.removeAll(true);
    this.menu?.destroy();
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x0a0e15, 0.8).setOrigin(0).setInteractive();
    text(this, width / 2, height / 2 - 130, t('MENU_PAUSED'), 34).setOrigin(0.5);
    this.menu = new Menu(this);
    this.menu.add(width / 2, height / 2 - 50, t('MENU_RESUME'), () => this.resumeStory());
    this.menu.add(width / 2, height / 2 + 8, t('MENU_SETTINGS'), () => { this.scene.launch('Settings', { from: 'Pause' }); this.scene.pause(); });
    this.menu.add(width / 2, height / 2 + 66, t('MENU_QUIT_TITLE'), () => {
      this.scene.stop('Story');
      this.scene.start('Title');
    });
  }

  private resumeStory(): void {
    this.scene.stop();
    this.scene.resume('Story');
  }
}
