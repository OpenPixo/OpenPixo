import { GAME_PLAYTEST_LIMITS } from '@openpixo/contracts';
/** MovieMaker needs a renderer: --headless uses the dummy renderer. --minimized requests a hidden
 * game window; windowsHide separately suppresses console windows. Real Windows GPU testing remains required. */
export function godotMovieArgs(argv: string[], movie: string, durationMs: number): string[] {
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > GAME_PLAYTEST_LIMITS.durationMs) throw new Error('Invalid Godot capture duration');
  if (argv.some(arg => ['--headless', '--no-window', '--write-movie', '--fixed-fps', '--quit-after'].includes(arg))) throw new Error('Godot movie capture cannot use headless or conflicting movie flags');
  return [...argv, '--minimized', '--resolution', '1280x720', '--audio-driver', 'Dummy', '--write-movie', movie,
    '--fixed-fps', '30', '--quit-after', String(Math.ceil(durationMs * 30 / 1000))];
}
