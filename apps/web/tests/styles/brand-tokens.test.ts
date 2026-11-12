import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const blocks = [...css.matchAll(/(?:^|\n)(?::root|\[data-theme="dark"\]|\s*html:not\(\[data-theme\]\))\s*\{([^}]+)\}/g)].map(match => Object.fromEntries([...match[1]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()])));
function resolve(tokens: Record<string, string>, name: string): string {
 const value = tokens[name];
 if (!value) throw new Error(`Missing token --${name}`);
 const alias = /^var\(--([\w-]+)\)$/.exec(value);
 return alias ? resolve(tokens, alias[1]!) : value;
}
function contrast(a: string, b: string): number {
 const luminance = (hex: string) => {
  const rgb = hex.slice(1).match(/../g)!.map(pair => parseInt(pair, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
 };
 const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe('OpenPixo brand contrast', () => {
 it('maps existing app roles to the approved violet and ink foundation', () => {
  const tokens = blocks[0]!;
  for (const [name, value] of Object.entries({
   ink: '#141128', 'ink-2': '#2a2645', muted: '#545070', faint: '#726e8c',
   violet: '#6c4bff', 'violet-strong': '#4a2de0', 'violet-soft': '#f1eeff',
   lime: '#c4f542', mint: '#1bc38d', amber: '#ffa51f', green: '#14825e',
  })) expect(resolve(tokens, name).toLowerCase()).toBe(value);
  for (const name of ['accent', 'brand-ink', 'selected']) {
   expect(resolve(tokens, name)).toBe(resolve(tokens, 'violet'));
  }
  for (const name of ['accent-soft', 'brand-surface', 'selected-soft']) {
   expect(resolve(tokens, name)).toBe(resolve(tokens, 'violet-soft'));
  }
  expect(resolve(tokens, 'accent')).not.toBe(resolve(tokens, 'lime'));
  expect(resolve(tokens, 'border')).toBe('rgba(20, 17, 40, 0.14)');
  expect(resolve(tokens, 'border-strong')).toBe('rgba(20, 17, 40, 0.24)');
 });

 for (const [index, block] of blocks.entries()) it(`keeps readable text, controls and distinct status in theme ${index}`, () => {
  const tokens = { ...blocks[0], ...block };
  for (const surface of ['bg', 'bg-app', 'bg-panel', 'bg-elevated', 'bg-subtle', 'sidebar-bg']) {
   expect(contrast(resolve(tokens, 'text'), resolve(tokens, surface))).toBeGreaterThanOrEqual(4.5);
   expect(contrast(resolve(tokens, 'text-strong'), resolve(tokens, surface))).toBeGreaterThanOrEqual(4.5);
   expect(contrast(resolve(tokens, 'text-muted'), resolve(tokens, surface))).toBeGreaterThanOrEqual(3);
   expect(contrast(resolve(tokens, 'text-soft'), resolve(tokens, surface))).toBeGreaterThanOrEqual(3);
   // Small secondary labels use this one, so it must stay legible at 11-12px.
   expect(contrast(resolve(tokens, 'text-faint'), resolve(tokens, surface))).toBeGreaterThanOrEqual(4);
  }
  expect(contrast(resolve(tokens, 'accent'), resolve(tokens, 'accent-contrast'))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(resolve(tokens, 'accent'), resolve(tokens, 'bg-panel'))).toBeGreaterThanOrEqual(3);
  expect(resolve(tokens, 'green')).not.toBe(resolve(tokens, 'accent'));
 });

 it('keeps shared material, focus and motion tokens available to primitives', () => {
  const tokens = blocks[0]!;
  expect(tokens['radius-card']).toBe('16px');
  expect(tokens['radius-control']).toBe('10px');
  expect(tokens['ease-out']).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
  expect(resolve(tokens, 'dur-enter')).toBe('200ms');
  expect(resolve(tokens, 'dur-exit')).toBe('140ms');
  expect(tokens['focus-shadow']).toBe('0 0 0 1px var(--violet), 0 0 0 4px var(--violet-soft)');
  for (const name of ['sh-1', 'sh-2', 'sh-3']) expect(tokens[name]).toContain('rgba(');
 });
 it('keeps explicit and system dark definitions aligned', () => { expect(blocks).toHaveLength(3); expect(blocks[2]).toEqual(blocks[1]); });
});
