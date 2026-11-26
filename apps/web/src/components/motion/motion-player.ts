import { MOTION_PLAYER_URL } from '../../providers/motion';

/** What the Pixo Motion player gives for one character (`game-sdk/openpixo-motion/web`). */
export interface MotionActor {
  canvas: HTMLCanvasElement;
  moods?: string[];
  update(seconds: number): void;
  mood(name: string): string;
  talk(seconds?: number): void;
  lookAt(x: number, y: number): void;
  lookAway?(): void;
}
interface MotionPlayer { createPixoMotion(file: ArrayBuffer, options: { width: number; height: number }): Promise<MotionActor> }

let loading: Promise<MotionPlayer> | null = null;

/** The same player a game gets, loaded from the daemon once and kept out of the page's bundle. */
export function loadMotionPlayer(): Promise<MotionPlayer> {
  const url: string = MOTION_PLAYER_URL;
  loading ??= (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<MotionPlayer>).catch((error: unknown) => { loading = null; throw error; });
  return loading;
}

/** Whether this browser can show one: the player draws with WebGL 2. */
let webgl2: boolean | null = null;
export function canShowMotion(): boolean {
  if (webgl2 === null) {
    try {
      const context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('webgl2');
      webgl2 = Boolean(context);
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webgl2 = false; }
  }
  return webgl2;
}
