import { describe, expect, it } from 'vitest';
import { normalizeDesktopSidecarMessage, SIDECAR_MESSAGES } from '../src/index.js';
const input = { url: 'http://127.0.0.1:9001/', timeoutMs: 5000, waitMs: 0 };
describe('game playtest transport', () => {
  it('preserves the input script and duration through desktop IPC', () => {
    const playtest = { durationMs: 1000, script: [{ key: 'Space', press: true, holdMs: 120 }, { capture: 'after-jump' }] };
    expect(normalizeDesktopSidecarMessage({ type: SIDECAR_MESSAGES.CAPTURE_GAME, input: { ...input, playtest } })).toEqual({ type: SIDECAR_MESSAGES.CAPTURE_GAME, input: { ...input, playtest } });
  });
  it('keeps legacy screenshot requests unchanged', () => {
    expect(normalizeDesktopSidecarMessage({ type: SIDECAR_MESSAGES.CAPTURE_GAME, input })).toEqual({ type: SIDECAR_MESSAGES.CAPTURE_GAME, input });
  });
  it('rejects a remote page and malformed or oversized script envelopes', () => {
    const normalize = (extra: object) => normalizeDesktopSidecarMessage({ type: SIDECAR_MESSAGES.CAPTURE_GAME, input: { ...input, ...extra } });
    expect(() => normalize({ url: 'https://example.com' })).toThrow(/loopback/);
    expect(() => normalize({ playtest: [] })).toThrow(/playtest/);
    expect(() => normalize({ playtest: { script: 'x'.repeat(32769) } })).toThrow(/playtest/);
  });
});
