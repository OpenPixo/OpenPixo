export type DesktopGameCaptureInput = {
  url: string;
  timeoutMs: number;
  waitMs: number;
  // Opaque application payload. The desktop capture host validates the shared
  // game contract before it creates a window; the protocol only bounds the wire.
  playtest?: unknown;
};

export function normalizeDesktopGameCaptureInput(value: unknown): DesktopGameCaptureInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid game capture input');
  const input = value as Record<string, unknown>;
  if (typeof input.url !== 'string' || typeof input.timeoutMs !== 'number' || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000
    || typeof input.waitMs !== 'number' || !Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 5000) throw new Error('invalid game capture input');
  const url = new URL(input.url);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('game capture requires a loopback HTTP URL');
  if (input.playtest !== undefined) {
    if (!input.playtest || typeof input.playtest !== 'object' || Array.isArray(input.playtest)) throw new Error('invalid game playtest input');
    let wire: string;
    try { wire = JSON.stringify(input.playtest); } catch { throw new Error('invalid game playtest input'); }
    if (!wire || wire.length > 32_768) throw new Error('game playtest input exceeds capture limit');
  }
  return { url: url.href, timeoutMs: input.timeoutMs, waitMs: input.waitMs, ...(input.playtest !== undefined ? { playtest: input.playtest } : {}) };
}
