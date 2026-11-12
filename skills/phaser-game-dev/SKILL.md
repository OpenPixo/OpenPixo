---
name: phaser-game-dev
en_name: Phaser 3 game development craft
zh_name: Phaser 3 游戏开发规范
description: Implement or debug gameplay, scenes, input, assets and saves in an existing Phaser 3 + TypeScript project; not for other engines or art-only work.
zh_description: 在已有 Phaser 3 与 TypeScript 项目中实现或修复玩法、场景、输入、资源和存档；不用于其他引擎或纯美术任务。
triggers:
  - phaser 3
  - phaser scene
  - arcade physics
  - Phaser 开发
  - Phaser 场景
  - Phaser 物理
  - Phaser 存档
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - phaser
  category: game-development
  design_system:
    requires: false
  example_prompt: Split the game into Boot, Menu, Game and HUD scenes, keep the score in the registry, and save the best score to localStorage.
  example_prompt_i18n:
    zh-CN: 把游戏拆成 Boot、Menu、Game 和 HUD 场景，分数放进 registry，并把最高分存到 localStorage。
---

# Phaser 3 game development craft

Use for gameplay implementation or bugs in lifecycle, input or assets in an existing Phaser 3 project.
Project conventions, architecture, installed versions and explicit user choices take precedence over these defaults.
Read `package.json` and `node_modules/phaser/types/phaser.d.ts`; examples target Phaser 3.90, not Phaser 2, CE or 4.
Apply the relevant section; a local fix does not require new scenes, an input service or a save system.

## Quick path

1. Locate the owning Scene, its transitions and existing loader and input keys.
2. Identify the affected lifecycle stage using the table; keep the current project structure.
3. Patch that owner using installed Phaser types and correct asset URLs and the correct coordinate space for the body.
4. Run `pixo game verify --steps build --json`; inspect compiler and loader errors.
5. For browser behavior, discover `pixo game playtest --list-presets --json`, choose a matching preset or script, then inspect frames and logs.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
If `pixo` is absent from PATH in a host run, PowerShell invokes it as `& $env:PIXO_NODE_BIN $env:PIXO_BIN`.

## Choose the owner

| Need | Phaser 3 anchor | Lifecycle concern |
| --- | --- | --- |
| Load a texture or audio file | `preload()`: `this.load.image/spritesheet/atlas/audio` | Create dependent objects in `create()`, after loading |
| Enter or restart a level | `this.scene.start('Game', { level: 2 })`, `init(data)` | Restart reuses the Scene instance; reset per-round fields |
| Overlay a HUD | `this.scene.launch('Hud')` | Stop or reuse it deliberately so restarts do not duplicate it |
| Cross-scene state | `this.registry.set/get/inc` | Detach persistent registry listeners on Scene shutdown |
| Moving collisions | `this.physics.add.sprite`, `setVelocityX/Y` | Arcade integrates velocity; configure gravity in one place |
| No physics | Position update with `speed * delta / 1000` | Phaser delta is milliseconds |

## Loading and portable URLs

- Reuse the project's import style, package manager and bundler. A normal TS import is `import Phaser from 'phaser';`.
- In Vite, `public/sprites/fox.png` is served as `sprites/fox.png`; `public/` is not part of the URL.
- A `vite.config` needs `--configLoader native` on every `vite` script (`dev`, `build`, `preview`), as the OpenPixo starters have. The default loader bundles the config with esbuild, which reads every parent folder, and a Windows sandbox refuses that: `Cannot read directory "../../../../../.."`. Write the config as `vite.config.mjs` so any Node version loads it.
- For subpath hosting, use the configured base and document-relative URLs. Keep bundler-imported URLs as returned by the bundler.
- Texture and animation keys are global. Load shared assets in an existing preload owner; lazy per-scene loading is fine with unique keys and known ownership.

```ts
// preload():
this.load.spritesheet('fox', 'sprites/fox_walk.png', {
  frameWidth: 64, frameHeight: 64,
});
this.load.atlas('fox-atlas', 'sprites/fox.atlas.png', 'sprites/fox.atlas.json');
this.load.audio('jump', ['audio/jump.ogg', 'audio/jump.mp3']);
// Register loader diagnostics once with the chosen loader lifecycle:
this.load.on('loaderror', (file: Phaser.Loader.File) =>
  console.error(file.key, file.src));
```

Use `pixo asset info <path> --json` to confirm dimensions; `margin` and `spacing` must match the actual sheet.
A sheet uses row-major numeric frames; an atlas uses its JSON frame keys.
`pixo asset pack <frames...> --format texturepacker-json --out public/atlases --json` emits a PNG and JSON pair.
Read returned paths and descriptor keys: packed frame names are input project-relative paths, not assumed basenames.

## Animation and Scene cleanup

```ts
// create(), after the sheet is loaded:
if (!this.anims.exists('fox-walk')) {
  this.anims.create({ key: 'fox-walk',
    frames: this.anims.generateFrameNumbers('fox', { start: 0, end: 5 }),
    frameRate: 10, repeat: -1 });
}
player.play('fox-walk', true); // Retain progress when already playing.
this.registry.events.on('changedata-score', this.onScore, this);
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  this.registry.events.off('changedata-score', this.onScore, this);
});
```

For atlases, read `this.textures.get('fox-atlas').getFrameNames()` and use explicit ordered keys or `generateFrameNames` with the actual prefix.
Use `repeat: 0` for one-shots. Preserve asymmetric artwork when considering `setFlipX`.
External, window and game emitters outlive a Scene; remove the exact callback rather than another owner's listeners.
Fields assigned in `create()` can use definite assignment with an accurate type such as `Phaser.Types.Physics.Arcade.SpriteWithDynamicBody`.

## Physics, camera and scale

- Register colliders and overlaps in the existing setup path, once per Scene start.
- Static geometry: `this.physics.add.staticGroup()`; call `refreshBody()` after changing a static sprite's scale or position.
- Dynamic body: `player.body.setSize(w, h).setOffset(x, y)`; check the collider at the intended scale and origin.
- Ground contacts: `body.blocked.down || body.touching.down`; gate jump edges and consume any grace or buffer once.
- Tilemaps: `this.make.tilemap`, `addTilesetImage`, `createLayer`, `setCollisionByProperty({ collides: true })`, then a collider.
- World and camera bounds are separate: `this.physics.world.setBounds` and `this.cameras.main.setBounds`.
- Follow with `startFollow`; a HUD can use its own Scene or `setScrollFactor(0)`.
- `Phaser.Scale.FIT` preserves logical dimensions; `RESIZE` needs resize-aware layout. Use `this.scale.width/height`.
- Pixel art: zoom the world, keep the canvas large. Do not set `pixelArt: true` or `antialias: false` on the game: the browser then scales the whole canvas, text included, with hard edges, and text breaks apart at non-integer sizes and Windows display scaling. Filter the art textures instead, and keep HUD text on a camera at zoom 1.

```ts
// Game config: canvas 1280x720, scale FIT, roundPixels: true (no pixelArt).
// create(), after loading: nearest filtering on the art only, world zoom to the pixel resolution.
for (const key of ['player', 'tiles']) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
const zoom = Math.max(1, Math.floor(Math.min(this.scale.width / 320, this.scale.height / 180)));
this.cameras.main.setZoom(zoom);
// HUD in its own Scene (cameras at zoom 1); text at least 16 px tall on the 1280x720 canvas.
this.scene.launch('hud');
```

## Input, saves and audio

- Named actions can unify keyboard and gamepad when the project needs both; reuse existing mappings.
- Keyboard edges: `Phaser.Input.Keyboard.JustDown(key)`. Guard `this.input.keyboard` when keyboard input may be disabled.
- Gamepads need `input: { gamepad: true }`; guard `this.input.gamepad`, check `pad1`, and handle `connected` after a browser gesture.
- `pad.leftStick` is a Vector2; use a radial deadzone and preserve analog magnitude. Edge-detect buttons for one-shot actions.
- A connected pad should not disable working keyboard controls; clear held actions on blur and disconnect.
- Parse saves as `unknown`, validate version and every field (finite numbers, bounds, known IDs), then apply live state.
- A shallow `{ ...defaults, ...parsed }` merge does not validate data. Preserve bytes from corrupt saves or future versions; catch storage reads and writes.
- Keep a stable namespaced slot key and a payload version; settings can live at a separate key.
- Load audio before `this.sound.add/play`; let Phaser unlock it after a user gesture. Scene-owned music and listeners need shutdown cleanup.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Copy Phaser 2 `game.state` or Phaser 4 APIs | Use installed Phaser 3 Scene APIs and types |
| Move an Arcade sprite with `x += speed` | Use body velocity so physics can resolve collisions |
| Multiply a body velocity by delta | Velocity already has units per second; delta applies to acceleration and manual displacement |
| Guess atlas names or recreate global animations on restart | Read JSON keys; guard animation creation |
| Restart a clip every `update()` | `play(key, true)` retains the active animation |
| `pixelArt: true` on a small canvas scaled up by the browser | Large canvas, world camera zoom, nearest filtering per art texture; text stays readable |
| Treat a skipped `check` as typecheck success | Inspect build scripts; Vite templates often typecheck in `build` |

## Done when

- [ ] The affected Scene starts and restarts without duplicate handlers, assets or animations.
- [ ] Asset URLs, frame names and body placement match the real project; saves reject malformed fields.
- [ ] Supported input and first-gesture audio work in the browser.
- [ ] `pixo game verify --steps build --json` passes; for visible work inspect `pixo game verify --steps check,build,run --screenshot --json` results.
- [ ] Replay the relevant browser path, for example `pixo game playtest --preset runJump --json` only when ArrowRight and Space match the game; report unavailable checks.

API reference: [Phaser 3.90](https://docs.phaser.io/api-documentation/3.90.0/namespace/phaser); the installed package's types remain authoritative.
