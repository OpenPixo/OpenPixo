// SPDX-License-Identifier: Apache-2.0
// Types for pixo-motion.min.js, for TypeScript games. The player itself is plain JavaScript.

export interface PixoMotionOptions {
  /** Size the character is drawn at, in pixels. Defaults to 512 by 640. */
  width?: number;
  height?: number;
  /** Draw into this canvas instead of a new one. */
  canvas?: HTMLCanvasElement;
  /** Called when a line started with `talk` ends. */
  onLineEnd?: () => void;
}

/** One character, drawn into its canvas. */
export interface PixoMotion {
  /** Where it is drawn. Put it in the page, or use it as a texture. */
  readonly canvas: HTMLCanvasElement;
  /** The moods `mood` takes. */
  readonly moods: string[];
  /** Moves it on by this many seconds and draws it. Call it every frame. */
  update(seconds: number): void;
  /** Changes its mood and returns the mood it now has (the old one when the name is not one of `moods`). */
  mood(name: string): string;
  /** Moves its mouth as if talking, for this many seconds (2.5 when left out). */
  talk(seconds?: number): void;
  /** Turns it to look at a point, x and y from -1 to 1. */
  lookAt(x: number, y: number): void;
  /** Lets it look where it likes again. */
  lookAway(): void;
  /** Places it in the canvas again after the canvas changed size. */
  fit(): void;
}

/** Reads a .pxmo file and makes the character. */
export function createPixoMotion(file: ArrayBuffer, options?: PixoMotionOptions): Promise<PixoMotion>;

/** Reads a .pxmo file without making a character; `createPixoMotion` also takes what it returns. */
export function loadPxmo(file: ArrayBuffer): Promise<unknown>;
