# Pixel platformer sample

A small, complete Phaser 3 + Vite + TypeScript game. Collect the four coins,
jump up the three platforms and reach the flag. No generation account or API
key is needed. Phaser and the build tools need a normal dependency install
before the first run; the media files are already included.

Run `pnpm install`, then `pnpm dev`. Run `pnpm build` for a production build.

## Controls

- Left / Right arrows or A / D: run.
- Up arrow, W or Space: jump while standing on a surface.
- R: restart at any time.
- After "You win!", press Space / Enter or click to play again.

## Layout

- `src/main.ts`: one scene containing the level, controls, score and win state.
- `public/assets/player.png`: six 32 x 32 frames; idle frames 0-1, run frames 2-5.
- `public/assets/ground.png`: repeating 32 x 32 ground/platform tile.
- `public/assets/coin.png`: 16 x 16 collectible.
- `public/assets/background.png`: 400 x 225 pixel landscape, displayed at 2x.
- `public/assets/jump.wav`, `coin.wav`: short mono PCM16 sound effects.
- `index.html`: page and canvas styling; `package.json` / `tsconfig.json`: build setup.

Try changing the platform coordinates, jump speed or coin locations in
`src/main.ts`, or edit one of the assets in OpenPixo's Assets panel and Studio.

## Original media

All included images are original pixel art drawn by code and all sounds are
original synthesized tones. They use no downloaded art, samples, fonts or
other third-party media. The OpenPixo repository includes the deterministic,
dependency-free source at
`game-templates/phaser3-sample-platformer/generate-assets.ts`; run it with Node
24 to regenerate the six files. It uses `node:zlib` for PNG encoding.

These generated assets are dedicated to the public domain under CC0 1.0 where
possible (CC0-style permission to copy, modify and redistribute without
attribution). They are also included as part of OpenPixo under Apache-2.0.
The sample source is part of OpenPixo under Apache-2.0; Phaser and the build
tools keep their own licenses.
