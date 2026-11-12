import { GAME_PLAYTEST_LIMITS, GAME_PLAYTEST_SEEDED_PRESETS, isGamePlaytestPresetId, isGamePlaytestSeed,
  type GamePlaytestReport, type GameVerifyScreenshot } from '@openpixo/contracts';

/** Rebuild report frames (and the overview) from validated on-disk artifacts; ignore all client-supplied paths. */
export function normalizeGamePlaytestReport(value: GamePlaytestReport, shots: GameVerifyScreenshot[], overview?: GameVerifyScreenshot): GamePlaytestReport {
  const invalid = (): never => { throw new Error('Invalid playtest report'); };
  if (!value || typeof value.completed !== 'boolean' || typeof value.inputSupported !== 'boolean'
    || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > GAME_PLAYTEST_LIMITS.durationMs + 5000
    || !Array.isArray(value.frames) || value.frames.length > GAME_PLAYTEST_LIMITS.frames
    || !Array.isArray(value.console) || value.console.length > GAME_PLAYTEST_LIMITS.consoleMessages
    || !Array.isArray(value.pageErrors) || value.pageErrors.length > GAME_PLAYTEST_LIMITS.pageErrors
    || value.pageErrors.some(message => typeof message !== 'string' || message.length > GAME_PLAYTEST_LIMITS.messageLength)) return invalid();
  const time = (ms: number) => Number.isFinite(ms) && ms >= 0 && ms <= GAME_PLAYTEST_LIMITS.durationMs + 5000;
  const frames = value.frames.map(frame => {
    const shot = shots.find(candidate => candidate.ref === frame.ref);
    if (!shot || !time(frame.atMs) || (frame.label !== undefined && (typeof frame.label !== 'string' || !/^[\w-]{1,64}$/.test(frame.label)))) return invalid();
    return { ...shot, atMs: frame.atMs, ...(frame.label ? { label: frame.label } : {}) };
  });
  if (new Set(frames.map(frame => frame.ref)).size !== frames.length || shots.length !== frames.length) return invalid();
  const messages = value.console.map(message => {
    if (!message || !['debug', 'info', 'log', 'warning', 'error'].includes(message.level)
      || typeof message.text !== 'string' || message.text.length > GAME_PLAYTEST_LIMITS.messageLength || !time(message.atMs)) return invalid();
    return { level: message.level, text: message.text, atMs: message.atMs };
  });
  const fps = value.fps;
  if (fps !== null && (!fps || !Number.isFinite(fps.min) || !Number.isFinite(fps.avg) || fps.min <= 0 || fps.avg < fps.min
    || fps.avg > 100_000 || !Number.isInteger(fps.samples) || fps.samples < 1 || fps.samples > 10_000)) return invalid();
  if (value.reasonCode && !['UNSUPPORTED_ENGINE', 'RUN_COMMAND_UNAVAILABLE', 'SCRIPT_UNSUPPORTED', 'SCREENSHOT_HOST_UNAVAILABLE',
    'CAPTURE_UNAVAILABLE', 'GODOT_CAPTURE_UNAVAILABLE'].includes(value.reasonCode)) return invalid();
  // Provenance follows the request rule: a seed exists exactly when the preset is a seeded one.
  if (value.preset !== undefined && !isGamePlaytestPresetId(value.preset)) return invalid();
  const seeded = value.preset !== undefined && GAME_PLAYTEST_SEEDED_PRESETS.includes(value.preset);
  if (seeded ? !isGamePlaytestSeed(value.seed) : value.seed !== undefined) return invalid();
  return { completed: value.completed, inputSupported: value.inputSupported, durationMs: value.durationMs,
    frames, console: messages, pageErrors: value.pageErrors, fps: fps ? { min: fps.min, avg: fps.avg, samples: fps.samples } : null,
    ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}), ...(overview ? { overview } : {}),
    ...(value.preset !== undefined ? { preset: value.preset } : {}), ...(seeded ? { seed: value.seed! } : {}) };
}
