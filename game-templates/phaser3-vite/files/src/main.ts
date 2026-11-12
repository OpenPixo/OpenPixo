import Phaser from 'phaser';
import { tuning } from './tuning';

class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  create(): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x6ee7b7).fillRoundedRect(0, 0, 32, 32, 6);
    graphics.generateTexture('player', 32, 32);
    graphics.destroy();
    this.player = this.add.sprite(400, 300, 'player');
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.add.text(24, 24, 'Move with the arrow keys', { fontSize: '20px', color: '#ffffff' });
  }

  update(_time: number, delta: number): void {
    const direction = new Phaser.Math.Vector2(
      Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown),
      Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown),
    ).normalize();
    const distance = tuning.playerSpeed * Math.min(delta, 50) / 1000;
    this.player.x = Phaser.Math.Clamp(this.player.x + direction.x * distance, 16, 784);
    this.player.y = Phaser.Math.Clamp(this.player.y + direction.y * distance, 16, 584);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  backgroundColor: '#182230',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: MainScene,
});
