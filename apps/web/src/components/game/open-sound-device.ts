/** A wave file with no sound in it. */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

/**
 * Opens the sound device before the first game asks for it. An engine opens it while the
 * game starts and the game waits: 2.2 s the first time on a computer where starting a
 * process is slow, after the 2.2 s its frame already took (measured 2026-11-24). Asked
 * for early, the two overlap. A media element opens it without holding up this page,
 * which an audio context would.
 */
export function openSoundDevice(): void {
  if (typeof AudioContext === 'undefined') return;
  new Audio(SILENCE).play().catch(() => { /* no sound device, or sound is not allowed here */ });
}
