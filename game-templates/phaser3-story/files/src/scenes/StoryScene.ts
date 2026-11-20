import Phaser from 'phaser';
import { isHeld, listen, type Action } from '../controls.ts';
import { provide, withdraw } from '../inspect.ts';
import { Stage } from '../stage.ts';
import { loadEndings, loadGame, loadSettings, recordEnding, saveGame } from '../storage.ts';
import { endingIds } from '../story/check.ts';
import { asset, characterColor, characterName, loadBook, pickLanguage } from '../story/files.ts';
import { Runner, type Blocking } from '../story/runner.ts';
import { t } from '../strings.ts';
import { tuning } from '../tuning.ts';
import { Menu, panel, text, THEME } from '../ui.ts';

/**
 * One playthrough of the story. src/story/runner.ts decides what happens; this
 * scene shows it: the text box with its typewriter, the choices, the log, auto
 * and skip, the ending card, music and sound. It saves where the player is
 * after every choice, when they quit to the title and when the page closes.
 *
 * You rarely need to change this file to write a story: edit story/ instead.
 * Text speeds are in src/tuning.json; colours and fonts in src/ui.ts.
 */
export class StoryScene extends Phaser.Scene {
  runner!: Runner;
  private language = '';
  private stage!: Stage;
  private speaker!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private textBox!: Phaser.GameObjects.Container;
  private toolbar!: Phaser.GameObjects.Container;
  private autoButton!: Phaser.GameObjects.Text;
  private skipButton!: Phaser.GameObjects.Text;
  private choices: Menu | null = null;
  private log: Phaser.GameObjects.Container | null = null;
  private logOffset = 0;
  private endCard: Phaser.GameObjects.Container | null = null;
  private endMenu: Menu | null = null;
  private music: Phaser.Sound.BaseSound | null = null;
  private musicName = '';
  private current!: Blocking;
  private full: string[] = [];
  private shown = 0;
  private typing = false;
  private auto = false;
  private skipToggle = false;
  private autoLeft = 0;
  private skipLeft = 0;
  private waitLeft = 0;
  private ended = false;

  constructor() {
    super('Story');
  }

  create(data: { continue?: boolean }): void {
    this.language = this.pickLanguage();
    this.runner = new Runner(loadBook(this.language));
    for (const problem of this.runner.book.errors) console.error(problem);
    if (!(data.continue && this.runner.fromSave(loadGame()))) this.runner.start();
    this.ended = false;
    this.auto = false;
    this.skipToggle = false;
    this.choices = null;
    this.log = null;
    this.endCard = null;
    this.endMenu = null;
    this.music = null;
    this.musicName = '';
    this.stage = new Stage(this);
    this.buildTextBox();
    this.buildToolbar();

    const save = () => this.save();
    const settingsChanged = () => this.applySettings();
    window.addEventListener('pagehide', save);
    this.game.events.on('settings-changed', settingsChanged);
    this.events.once('shutdown', () => {
      this.save();
      this.music?.stop();
      window.removeEventListener('pagehide', save);
      this.game.events.off('settings-changed', settingsChanged);
      withdraw('story');
    });
    listen(this, action => this.onAction(action));
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || this.log || this.endCard) return;
      if (pointer.rightButtonDown()) return;
      if (!this.choices) this.advance();
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.log) this.scrollLog(dy < 0 ? 1 : -1);
      else if (dy < 0 && !this.endCard) this.openLog();
    });
    this.input.mouse?.disableContextMenu();
    this.show(this.runner.step());
    provide('story', () => this.inspect());
  }

  update(_time: number, delta: number): void {
    if (this.log || this.endCard) return;
    const seconds = Math.min(delta, 100) / 1000;
    const skipping = this.skipToggle || isHeld(this, 'skip');
    if (this.typing) {
      this.shown += seconds * tuning.charactersPerSecond * (skipping ? 20 : 1);
      this.body.setText(this.full.slice(0, Math.floor(this.shown)).join(''));
      if (this.shown >= this.full.length) this.finishTyping();
      return;
    }
    if (this.current.kind === 'wait') {
      this.waitLeft -= seconds;
      if (this.waitLeft <= 0 || skipping) this.advance();
    } else if (this.current.kind === 'line') {
      if (skipping) {
        this.skipLeft -= seconds;
        if (this.skipLeft <= 0) { this.skipLeft = tuning.skipInterval; this.advance(); }
      } else if (this.auto) {
        this.autoLeft -= seconds;
        if (this.autoLeft <= 0) this.advance();
      }
    }
  }

  /** Finishes the line being typed, or moves on to the next one. */
  advance(): void {
    if (this.typing) this.finishTyping();
    else if (this.current.kind === 'line' || this.current.kind === 'wait') this.show(this.runner.next());
  }

  choose(optionIndex: number): void {
    this.show(this.runner.choose(optionIndex));
    this.save();
  }

  private onAction(action: Action): void {
    if (this.log) {
      if (action === 'back' || action === 'log' || action === 'pause') this.closeLog();
      else if (action === 'up') this.scrollLog(1);
      else if (action === 'down') this.scrollLog(-1);
      return;
    }
    if (this.endCard) {
      if (action === 'confirm') this.endMenu?.press();
      return;
    }
    if (action === 'pause') {
      this.save();
      this.scene.launch('Pause');
      this.scene.pause();
    } else if (action === 'log') this.openLog();
    else if (action === 'auto') this.setAuto(!this.auto);
    else if (this.choices) {
      if (action === 'up') this.choices.move(-1);
      else if (action === 'down') this.choices.move(1);
      else if (action === 'confirm') this.choices.press();
    } else if (action === 'advance') this.advance();
  }

  private show(command: Blocking): void {
    this.current = command;
    this.clearChoices();
    this.stage.show(this.runner.background, this.runner.cast, this.language, command.kind === 'line' ? command.speaker : '');
    this.playAudio();
    if (command.kind === 'line') this.showText(command.speaker, command.text);
    else if (command.kind === 'choice') {
      if (command.prompt) this.showText('', command.prompt);
      this.setSkip(false);
      this.showChoices();
    } else if (command.kind === 'wait') this.waitLeft = command.seconds;
    else this.showEnd(command);
  }

  private showText(speaker: string, value: string): void {
    this.speaker.setText(speaker ? characterName(speaker, this.language) : '');
    this.speaker.setColor(Phaser.Display.Color.IntegerToColor(characterColor(speaker)).rgba);
    this.full = Array.from(value);
    this.shown = 0;
    this.typing = true;
    this.body.setText('');
    this.textBox.setVisible(true);
  }

  private finishTyping(): void {
    this.typing = false;
    this.body.setText(this.full.join(''));
    this.autoLeft = tuning.autoDelay + tuning.autoDelayPerCharacter * this.full.length;
  }

  private showChoices(): void {
    const open = this.runner.options();
    if (!open.length) { this.show(this.runner.skipChoice()); return; }
    const { width, height } = this.scale;
    const menu = new Menu(this, 620);
    const top = (height - 220) / 2 - (open.length - 1) * 29;
    open.forEach((option, row) => menu.add(width / 2, top + row * 58, option.text, () => this.choose(option.index)));
    this.choices = menu;
  }

  private clearChoices(): void {
    this.choices?.destroy();
    this.choices = null;
  }

  private showEnd(command: Extract<Blocking, { kind: 'end' }>): void {
    this.ended = true;
    this.textBox.setVisible(false);
    this.toolbar.setVisible(false);
    const found = recordEnding(command.id);
    const all = endingIds(this.runner.book);
    const { width, height } = this.scale;
    const card = this.add.container(0, 0);
    card.add(panel(this, width / 2 - 260, height / 2 - 150, 520, 300));
    card.add(text(this, width / 2, height / 2 - 100, t('STORY_THE_END'), 44).setOrigin(0.5));
    if (command.title) card.add(text(this, width / 2, height / 2 - 40, command.title, 26).setOrigin(0.5));
    if (all.length) {
      const count = all.filter(id => found.includes(id)).length;
      card.add(text(this, width / 2, height / 2 + 4, t('STORY_ENDINGS_FOUND', { found: count, total: all.length }), 20, THEME.muted).setOrigin(0.5));
    }
    this.endMenu = new Menu(this, 440);
    const back = this.endMenu.add(width / 2, height / 2 + 84, t('STORY_BACK_TO_TITLE'), () => this.scene.start('Title'));
    card.add(back.container);
    this.endCard = card;
    // A finished story starts over: without a save the title screen offers New game.
    saveGame(null);
  }

  private openLog(): void {
    this.logOffset = 0;
    this.drawLog();
  }

  private closeLog(): void {
    this.log?.destroy();
    this.log = null;
  }

  private scrollLog(step: number): void {
    this.logOffset = Math.max(0, Math.min(this.logOffset + step, Math.max(0, this.runner.history.length - 1)));
    this.drawLog();
  }

  /** The newest lines at the bottom; scrolling up shows older ones. */
  private drawLog(): void {
    this.log?.destroy();
    const { width, height } = this.scale;
    const log = this.add.container(0, 0);
    log.add(this.add.rectangle(0, 0, width, height, 0x05070b, 0.72).setOrigin(0).setInteractive());
    log.add(panel(this, 160, 60, width - 320, height - 120));
    log.add(text(this, 200, 92, t('STORY_LOG_TITLE'), 30));
    const entries = this.runner.history.flatMap(entry => {
      const command = this.runner.commandAt(entry);
      if (command?.kind === 'line' && entry.length === 2) return [{ speaker: command.speaker, value: command.text }];
      if (command?.kind === 'choice' && entry.length === 3 && command.options[entry[2]]) return [{ speaker: '', value: `→ ${command.options[entry[2]]!.text}`, choice: true }];
      return [];
    });
    if (!entries.length) log.add(text(this, 200, 150, t('STORY_LOG_EMPTY'), 22, THEME.muted));
    let bottom = height - 150;
    for (let i = entries.length - 1 - this.logOffset; i >= 0 && bottom > 150; i--) {
      const entry = entries[i]!;
      let x = 200;
      const row: Phaser.GameObjects.Text[] = [];
      if (entry.speaker) {
        const name = text(this, x, 0, characterName(entry.speaker, this.language), 22, Phaser.Display.Color.IntegerToColor(characterColor(entry.speaker)).rgba);
        row.push(name);
        x += name.width + 14;
      }
      const line = text(this, x, 0, entry.value, 22, 'choice' in entry ? THEME.muted : THEME.text).setWordWrapWidth(width - 360 - (x - 200));
      row.push(line);
      bottom -= line.height + 12;
      for (const item of row) { item.setY(bottom); log.add(item); }
      if (bottom < 150) for (const item of row) item.setVisible(false);
    }
    const menu = new Menu(this, 160);
    const close = menu.add(width - 280, height - 104, t('STORY_LOG_CLOSE'), () => this.closeLog(), 42);
    log.add(close.container);
    this.log = log;
  }

  private buildTextBox(): void {
    const { width, height } = this.scale;
    const box = this.add.container(0, 0);
    box.add(this.add.graphics().fillStyle(0x0c0f17, 0.93).fillRoundedRect(90, height - 232, width - 180, 206, 14));
    this.speaker = text(this, 124, height - 210, '', 24);
    this.body = text(this, 124, height - 168, '', 24).setWordWrapWidth(width - 248).setLineSpacing(6);
    box.add([this.speaker, this.body]).setVisible(false);
    this.textBox = box;
  }

  private buildToolbar(): void {
    const { width } = this.scale;
    const bar = this.add.container(0, 0);
    const make = (x: number, key: 'STORY_LOG' | 'STORY_AUTO' | 'STORY_SKIP', onPress: () => void) => {
      const label = text(this, x, 42, t(key), 20).setOrigin(1, 0.5).setPadding(16, 9, 16, 9)
        .setBackgroundColor('#24303f').setInteractive({ useHandCursor: true }).on('pointerdown', onPress);
      bar.add(label);
      return label;
    };
    this.skipButton = make(width - 24, 'STORY_SKIP', () => this.setSkip(!this.skipToggle));
    this.autoButton = make(this.skipButton.x - this.skipButton.width - 8, 'STORY_AUTO', () => this.setAuto(!this.auto));
    make(this.autoButton.x - this.autoButton.width - 8, 'STORY_LOG', () => this.openLog());
    this.toolbar = bar;
  }

  private setAuto(on: boolean): void {
    this.auto = on;
    this.autoButton.setBackgroundColor(on ? '#3b4a5e' : '#24303f');
    if (!this.typing) this.autoLeft = tuning.autoDelay + tuning.autoDelayPerCharacter * this.full.length;
  }

  private setSkip(on: boolean): void {
    this.skipToggle = on;
    this.skipButton.setBackgroundColor(on ? '#3b4a5e' : '#24303f');
  }

  private playAudio(): void {
    const settings = loadSettings();
    if (this.runner.music !== this.musicName) {
      this.musicName = this.runner.music;
      this.music?.stop();
      this.music = null;
      const url = this.musicName ? asset.music(this.musicName) : '';
      if (url && this.cache.audio.exists(url)) {
        this.music = this.sound.add(url, { loop: true, volume: settings.music });
        this.music.play();
      }
    }
    for (const name of this.runner.pendingSounds) {
      const url = asset.sound(name);
      if (url && this.cache.audio.exists(url)) this.sound.play(url, { volume: settings.sfx });
    }
    this.runner.pendingSounds = [];
  }

  /** A language picked in Settings switches the story to that folder at the same place. */
  private applySettings(): void {
    const settings = loadSettings();
    if (this.music && 'setVolume' in this.music) (this.music as Phaser.Sound.WebAudioSound).setVolume(settings.music);
    const picked = this.pickLanguage();
    if (picked === this.language) return;
    const place = this.runner.toSave();
    this.language = picked;
    this.runner = new Runner(loadBook(picked));
    if (!this.runner.fromSave(place)) this.runner.start();
    if (this.ended) return;
    this.show(this.runner.step());
    this.finishTyping();
  }

  private pickLanguage(): string {
    const chosen = loadSettings().language;
    return pickLanguage(chosen || navigator.language);
  }

  private save(): void {
    if (!this.ended && this.runner) saveGame(this.runner.toSave());
  }

  private inspect(): Record<string, unknown> {
    return {
      language: this.language,
      label: this.runner.label,
      index: this.runner.index,
      variables: this.runner.variables,
      background: this.runner.background,
      cast: this.runner.cast,
      speaker: this.speaker.text,
      text: this.full.join(''),
      typing: this.typing,
      choices: this.choices?.buttons.map(button => button.label.text) ?? [],
      focusedChoice: this.choices?.focused ?? null,
      auto: this.auto,
      skip: this.skipToggle,
      logOpen: Boolean(this.log),
      logLines: this.log ? this.runner.history.length : 0,
      ending: this.endCard ? { id: this.current.kind === 'end' ? this.current.id : '', title: this.current.kind === 'end' ? this.current.title : '', found: loadEndings() } : null,
    };
  }
}
