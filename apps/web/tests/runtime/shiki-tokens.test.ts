import { describe, expect, it } from 'vitest';
import { highlightTokens } from '../../src/runtime/shiki';

describe('highlightTokens', () => {
  it('gives each line its coloured tokens', async () => {
    const lines = await highlightTokens('const a = 1;\nreturn a;', 'javascript');
    expect(lines).toHaveLength(2);
    expect(lines![0]!.map((token) => token.content).join('')).toBe('const a = 1;');
    expect(new Set(lines![0]!.map((token) => token.color)).size).toBeGreaterThan(1);
  }, 30_000);

  it('loads a game language the web bundle leaves out on first use', async () => {
    const lines = await highlightTokens('func _ready():\n\tpass', 'gdscript');
    expect(lines).toHaveLength(2);
    expect(new Set(lines![0]!.map((token) => token.color)).size).toBeGreaterThan(1);
  }, 30_000);

  it('stays plain for an unknown language or text too long to highlight', async () => {
    expect(await highlightTokens('x', 'not-a-language')).toBeNull();
    expect(await highlightTokens('x'.repeat(200_000), 'javascript')).toBeNull();
  }, 30_000);
});
