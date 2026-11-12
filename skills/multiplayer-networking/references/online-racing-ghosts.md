# Racing ghosts with online features

While the player drives, the game records where the car was about 10 times a second. Their best lap on each track is saved online. Next time anyone races that track, they can race a see-through "ghost" of the leader's lap, or of another player's, and the leaderboard shows the times. Nobody is online at the same time.

## 1. Record a lap

Sample position and heading every 100 ms of game time (not wall-clock time, so a paused game does not stretch the ghost). Quantize, then store differences between samples, which are small numbers and keep the JSON short.

```ts
import { online, OnlineError, type OnlineDoc } from './openpixo-online';

export interface Ghost { v: 1; track: string; stepMs: number; lapMs: number; x0: number; y0: number; dx: number[]; dy: number[]; h: number[] }

const STEP_MS = 100;
const SCALE = 10;               // positions to 0.1 px
const TURN = 256;               // heading to 1/256 of a turn

export class LapRecorder {
  private elapsed = 0;
  private next = 0;
  private last: [number, number] | null = null;
  private ghost: Ghost;

  constructor(track: string) {
    this.ghost = { v: 1, track, stepMs: STEP_MS, lapMs: 0, x0: 0, y0: 0, dx: [], dy: [], h: [] };
  }

  /** Call every frame with the game-time delta. */
  update(deltaMs: number, x: number, y: number, headingRadians: number): void {
    this.elapsed += deltaMs;
    while (this.elapsed >= this.next) {
      const qx = Math.round(x * SCALE);
      const qy = Math.round(y * SCALE);
      if (!this.last) { this.ghost.x0 = qx; this.ghost.y0 = qy; this.ghost.dx.push(0); this.ghost.dy.push(0); }
      else { this.ghost.dx.push(qx - this.last[0]); this.ghost.dy.push(qy - this.last[1]); }
      this.last = [qx, qy];
      const turn = headingRadians / (2 * Math.PI);
      this.ghost.h.push(((Math.round(turn * TURN) % TURN) + TURN) % TURN);
      this.next += STEP_MS;
    }
  }

  finish(): Ghost { return { ...this.ghost, lapMs: Math.round(this.elapsed) }; }
}
```

A one-minute lap is 600 samples, well under 20 KB of JSON. A document holds 64 KB, so for laps over about three minutes record every 200 ms instead, and check `JSON.stringify(ghost).length` before saving.

## 2. Save the best lap per track

The track is the key, and the lap time in seconds is the score. `put` replaces what was there, so only save a lap that beats the player's own best:

```ts
export async function saveIfBest(ghost: Ghost): Promise<boolean> {
  const seconds = Math.round(ghost.lapMs / 10) / 100;               // 83.21
  const mine = await online.get<Ghost>('ghosts', { key: ghost.track });
  if (mine?.score != null && mine.score <= seconds) return false;
  await online.put('ghosts', ghost, { key: ghost.track, score: seconds });
  return true;
}
```

Track ids are keys, so they follow the name rule: `track-1`, `desert_loop`.

## 3. Leaderboard and choosing a ghost

Lap times are better when lower, so ask for ascending order:

```ts
export const board = (track: string) => online.top<Ghost>('ghosts', { key: track, by: 'score', order: 'asc', limit: 10 });
export const myPlace = (track: string) => online.rank('ghosts', { key: track, by: 'score', order: 'asc' });  // { rank, total } or null

/** Someone about as fast as me: the most fun to race. */
export async function closeRival(track: string): Promise<OnlineDoc<Ghost> | null> {
  return (await online.pick<Ghost>('ghosts', { key: track, by: 'score' }))?.doc ?? null;
}
```

Offer the leader's ghost (`board(track)[0]`), a close rival, and any name on the board: tapping a row races that ghost. A ghost picked for racing does not need `recordMatch`; ghosts have no rating.

## 4. Play a ghost back

Rebuild the positions once, then interpolate between samples by race time so the ghost moves smoothly at any frame rate. Turn the heading the short way round.

```ts
export function ghostPath(ghost: Ghost) {
  if (ghost.v !== 1 || ghost.dx.length !== ghost.dy.length || ghost.dx.length !== ghost.h.length || !ghost.dx.length) return null;
  const xs: number[] = []; const ys: number[] = [];
  let x = ghost.x0; let y = ghost.y0;
  for (let index = 0; index < ghost.dx.length; index += 1) {
    x += index ? ghost.dx[index]! : 0; y += index ? ghost.dy[index]! : 0;
    xs.push(x / SCALE); ys.push(y / SCALE);
  }
  return (timeMs: number) => {
    const at = Math.max(0, Math.min(timeMs / ghost.stepMs, xs.length - 1));
    const i = Math.floor(at); const j = Math.min(i + 1, xs.length - 1); const f = at - i;
    let turn = ghost.h[j]! - ghost.h[i]!;
    if (turn > TURN / 2) turn -= TURN;
    if (turn < -TURN / 2) turn += TURN;
    return { x: xs[i]! + (xs[j]! - xs[i]!) * f, y: ys[i]! + (ys[j]! - ys[i]!) * f,
      heading: ((ghost.h[i]! + turn * f) / TURN) * 2 * Math.PI };
  };
}
```

Draw the ghost half-transparent, with no collision, and its `name` (or `nameZh`) above it. Start its clock when the player's lap starts. A `null` path means the data is from another version or damaged: race without a ghost.

## 5. When online is not there

Wrap the board, the ghost load and the save in `try`/`catch` for `OnlineError`. The race must always start. If saving fails with `read-only`, keep the lap in `localStorage` and show the error's `message` on the results screen.

## Testing locally

1. `pixo online add --json`, then drive one lap on a track so a real ghost exists.
2. `pixo online seed --json` adds 20 players with ghosts on that track. They copy your lap with different times, so they all drive your line; that is expected in a test.
3. `pixo online test --json` and open the URL. Check the board is in ascending order with your rank, race the leader's ghost and a close rival, and beat your time: the board updates and a slower lap does not replace the faster one.
4. `pixo online data --collection ghosts --json` shows the saved entries; check a lap's size stays well under 64 KB.
5. `pixo game verify --steps build --json`.
