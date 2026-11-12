# OpenPixo rooms: host-authoritative Phaser example

Only the host simulates. Everyone, including the host, sends input through `sendToHost`, and the host's own input arrives as an ordinary `message`, so there is one code path. The host broadcasts state 15 times a second and other players draw the latest state.

```ts
import Phaser from 'phaser';
import { createRoom, joinFromUrl, joinRoom, RoomError, type Room } from './openpixo-rooms';

type Input = { dx: number; dy: number };
type State = { players: Record<string, { x: number; y: number }> };
const SPEED = 180, SEND_EVERY_MS = 66, INPUT_EVERY_MS = 33;

class MatchScene extends Phaser.Scene {
  private room!: Room;
  private state: State = { players: {} };
  private inputs: Record<string, Input> = {};
  private sprites = new Map<string, Phaser.GameObjects.Rectangle>();
  private sinceSend = 0;
  private sinceInput = 0;
  private keys!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Scene.start('Match') finds this scene by this key.
  constructor() { super('Match'); }

  init(data: { room: Room }) { this.room = data.room; }

  create() {
    this.keys = this.input.keyboard!.createCursorKeys();
    const { room } = this;
    if (room.isHost) for (const id of room.players) this.addPlayer(id);
    room.on('playerJoined', ({ id }) => { if (room.isHost) this.addPlayer(id); });
    room.on('playerLeft', ({ id }) => { delete this.state.players[id]; delete this.inputs[id]; });
    room.on('message', ({ from, data }) => {
      if (room.isHost) this.inputs[from] = this.validInput(data);
      else if (from === room.host) this.state = data as State;
    });
    room.on('closed', ({ message }) => this.scene.start('Lobby', { notice: message }));
    this.add.text(8, 8, `Invite: ${room.inviteUrl()}`);
  }

  // Input comes from other players' browsers, so the host checks it before using it.
  private validInput(data: unknown): Input {
    const { dx, dy } = (data ?? {}) as Partial<Input>;
    const axis = (value: unknown) => (value === -1 || value === 1 ? value : 0);
    return { dx: axis(dx), dy: axis(dy) };
  }

  private addPlayer(id: string) { this.state.players[id] = { x: 100 + Math.random() * 300, y: 200 }; }

  update(_time: number, delta: number) {
    const { room, keys } = this;
    // Not every frame: a 144 Hz display would go over 60 messages a second and be disconnected.
    this.sinceInput += delta;
    if (this.sinceInput >= INPUT_EVERY_MS) {
      this.sinceInput = 0;
      room.sendToHost({ dx: keys.left.isDown ? -1 : keys.right.isDown ? 1 : 0, dy: keys.up.isDown ? -1 : keys.down.isDown ? 1 : 0 });
    }
    if (room.isHost) {
      for (const [id, player] of Object.entries(this.state.players)) {
        const input = this.inputs[id] ?? { dx: 0, dy: 0 };
        player.x += input.dx * SPEED * delta / 1000;
        player.y += input.dy * SPEED * delta / 1000;
      }
      this.sinceSend += delta;
      if (this.sinceSend >= SEND_EVERY_MS) { this.sinceSend = 0; room.send(this.state); }
    }
    this.draw();
  }

  private draw() {
    for (const [id, player] of Object.entries(this.state.players)) {
      const sprite = this.sprites.get(id) ?? this.add.rectangle(player.x, player.y, 24, 24, id === this.room.you ? 0x66ccff : 0xffaa33);
      this.sprites.set(id, sprite);
      sprite.setPosition(player.x, player.y);
    }
    for (const [id, sprite] of this.sprites) {
      if (!this.state.players[id]) { sprite.destroy(); this.sprites.delete(id); }
    }
  }
}

// Lobby: register both scenes in the game config, for example scene: [Lobby, MatchScene]. Call joinFromUrl once
// at startup, not every time the lobby opens, or a player returned from a closed room tries that room again.
// Wire the buttons to createRoom() and joinRoom(code).
export async function enterMatch(scene: Phaser.Scene, open: () => Promise<Room | null>) {
  try {
    const room = await open();
    if (room) scene.scene.start('Match', { room });
  } catch (error) {
    scene.add.text(8, 40, error instanceof RoomError ? error.message : 'Could not connect.');
  }
}
// enterMatch(this, joinFromUrl);
// enterMatch(this, () => createRoom());
// enterMatch(this, () => joinRoom(codeBox.value));
```

Send state 10 to 30 times a second and keep each message under 16 KB, with deltas for large worlds. For a game with moves or turns, send one message per action and let the host answer with the result.
