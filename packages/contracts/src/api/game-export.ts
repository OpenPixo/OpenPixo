/**
 * A web game exported as one HTML file that plays offline: double-click it, or send
 * it to someone, with no OpenPixo, server or install. Every built file is embedded,
 * because Chromium will not load module scripts or `fetch` files next to a page
 * opened from `file://`.
 *
 *   GET  /api/projects/:id/game/export  → GameExportStatusResponse
 *   POST /api/projects/:id/game/export  → the HTML file itself (an attachment), or an error
 *
 * The CLI (`pixo game export`) and the export menu call the same routes.
 */

export interface GameExportStatusResponse {
  /** False for projects that are not a web game (Godot, Unity...), which have their own exporters. */
  available: boolean;
  /** The project-relative HTML file that is the game, where the menu offers the export. */
  entry?: string;
  /** Why it is unavailable, in plain words. */
  message?: string;
}

export interface GameExportRequest {
  /**
   * The game was already built. An agent must build inside its own CLI process first
   * and send this, so the build runs in its sandbox and not in the daemon.
   */
  skipBuild?: boolean;
}

/** Response header on a successful export: how many built files the HTML carries. */
export const GAME_EXPORT_FILES_HEADER = 'x-openpixo-export-files';

export const GAME_EXPORT_ERROR_CODES = [
  'GAME_EXPORT_UNSUPPORTED',
  'GAME_EXPORT_BUILD_FAILED',
  'GAME_EXPORT_NO_OUTPUT',
  'GAME_EXPORT_TOO_LARGE',
  'GAME_EXPORT_SPLIT_SCRIPTS',
  'GAME_EXPORT_BUSY',
] as const;
export type GameExportErrorCode = (typeof GAME_EXPORT_ERROR_CODES)[number];

/** What the export may embed. A single page past this is slow to open and awkward to send. */
export const GAME_EXPORT_LIMITS = { totalBytes: 150 * 1024 * 1024, files: 2000 } as const;

/** The exported file's name: the game's title, made safe for every file system. */
export function gameExportFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '').slice(0, 80);
  return `${safe || 'game'}.html`;
}
