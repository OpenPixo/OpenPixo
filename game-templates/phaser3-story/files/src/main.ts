import Phaser from 'phaser';
import './inspect.ts';
import { PauseScene } from './scenes/PauseScene.ts';
import { SettingsScene } from './scenes/SettingsScene.ts';
import { StoryScene } from './scenes/StoryScene.ts';
import { TitleScene } from './scenes/TitleScene.ts';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // 1280x720, scaled to the window, so art and text stay sharp at any size.
  width: 1280,
  height: 720,
  backgroundColor: '#182230',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { gamepad: true },
  scene: [TitleScene, StoryScene, PauseScene, SettingsScene],
});
