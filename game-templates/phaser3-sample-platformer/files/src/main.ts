import Phaser from 'phaser';
import { tuning } from './tuning';

const WIDTH = 800;
const HEIGHT = 450;
const COIN_POSITIONS = [[112, 388], [224, 308], [416, 244], [608, 180]];
const COINS = COIN_POSITIONS.slice(0, Math.max(0, Math.min(COIN_POSITIONS.length, Math.round(tuning.coinCount))));

class PlatformerScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<'left' | 'right' | 'jump' | 'restart' | 'enter', Phaser.Input.Keyboard.Key>;
  private scoreText!: Phaser.GameObjects.Text;
  private score = 0;
  private won = false;
  private wonAt = 0;

  preload(): void {
    this.load.spritesheet('player', 'assets/player.png', { frameWidth: 32, frameHeight: 32 });
    this.load.image('ground', 'assets/ground.png');
    this.load.image('coin', 'assets/coin.png');
    this.load.image('background', 'assets/background.png');
    this.load.audio('jump', 'assets/jump.wav');
    this.load.audio('coin-sound', 'assets/coin.wav');
  }

  create(): void {
    // Scene restarts keep the scene instance, so reset the round's state here.
    this.physics.resume();
    this.score = 0;
    this.won = false;
    this.add.image(0, 0, 'background').setOrigin(0).setScale(2);

    // One ground strip and three steps. The tile image repeats at its native size.
    const platforms = this.physics.add.staticGroup();
    for (const [x, y, width] of [[0, 418, WIDTH], [160, 338, 128], [352, 274, 128], [544, 210, 128]]) {
      const platform = this.add.tileSprite(x, y, width, 32, 'ground').setOrigin(0);
      platforms.add(platform);
    }

    this.player = this.physics.add.sprite(60, 380, 'player').setScale(1.5);
    this.player.setCollideWorldBounds(true).setSize(16, 26).setOffset(8, 6);
    this.physics.add.collider(this.player, platforms);
    if (!this.anims.exists('idle')) {
      this.anims.create({ key: 'idle', frames: this.anims.generateFrameNumbers('player', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
      this.anims.create({ key: 'run', frames: this.anims.generateFrameNumbers('player', { start: 2, end: 5 }), frameRate: 10, repeat: -1 });
    }
    this.player.play('idle');

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys({ left: 'A', right: 'D', jump: 'W', restart: 'R', enter: 'ENTER' }) as typeof this.keys;
    this.scoreText = this.add.text(20, 18, '', { fontFamily: 'monospace', fontSize: '22px', color: '#172b45' });
    this.updateScore();
    this.add.text(20, 48, 'Arrows / A D: move   Up / W / Space: jump   R: restart', { fontFamily: 'monospace', fontSize: '13px', color: '#172b45' });

    const coins = this.physics.add.staticGroup();
    for (const [x, y] of COINS) coins.create(x, y, 'coin').setScale(1.5).refreshBody();
    this.physics.add.overlap(this.player, coins, (_player, coin) => {
      if (this.won) return;
      (coin as Phaser.Physics.Arcade.Sprite).destroy();
      this.score += 1;
      this.updateScore();
      this.sound.play('coin-sound', { volume: tuning.soundVolume });
    });

    // The flag is intentionally simple geometry: try replacing it with your own art.
    this.add.rectangle(644, 184, 4, 52, 0x172b45);
    this.add.triangle(646, 158, 0, 0, 28, 10, 0, 20, 0xff785a).setOrigin(0);
    const goal = this.add.zone(646, 184, 36, 52);
    this.physics.add.existing(goal, true);
    this.physics.add.overlap(this.player, goal, () => this.win());

    this.input.on('pointerdown', () => {
      if (this.won && this.time.now - this.wonAt > 250) this.scene.restart();
    });
  }

  update(): void {
    // Read every edge, so holding the jump key cannot immediately dismiss a win.
    const jump = [this.cursors.up, this.cursors.space, this.keys.jump]
      .map((key) => Phaser.Input.Keyboard.JustDown(key)).some(Boolean);
    const enter = Phaser.Input.Keyboard.JustDown(this.keys.enter);
    if (Phaser.Input.Keyboard.JustDown(this.keys.restart)
      || (this.won && this.time.now - this.wonAt > 250 && (jump || enter))) {
      this.scene.restart();
      return;
    }
    if (this.won) return;

    const left = this.cursors.left.isDown || this.keys.left.isDown;
    const right = this.cursors.right.isDown || this.keys.right.isDown;
    const direction = Number(right) - Number(left);
    this.player.setVelocityX(direction * tuning.playerSpeed);
    if (direction !== 0) this.player.setFlipX(direction < 0);
    this.player.play(direction === 0 ? 'idle' : 'run', true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (jump && body.blocked.down) {
      this.player.setVelocityY(tuning.jumpVelocity);
      this.sound.play('jump', { volume: tuning.soundVolume });
    }
  }

  private updateScore(): void {
    this.scoreText.setText(`Coins: ${this.score} / ${COINS.length}   Reach the flag!`);
  }

  private win(): void {
    if (this.won) return;
    this.won = true;
    this.wonAt = this.time.now;
    this.player.setVelocity(0).play('idle');
    this.physics.pause();
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, 470, 150, 0x172b45, 0.94);
    this.add.text(WIDTH / 2, HEIGHT / 2, `You win!\nCoins: ${this.score} / ${COINS.length}\nSpace / Enter / click to restart`, {
      fontFamily: 'monospace', fontSize: '23px', color: '#ffffff', align: 'center', lineSpacing: 10,
    }).setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  pixelArt: true,
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: tuning.gravity } } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: PlatformerScene,
});
