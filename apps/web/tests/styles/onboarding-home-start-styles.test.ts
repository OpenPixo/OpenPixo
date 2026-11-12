import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The onboarding guided-start surface is a component owned CSS Module. This pins what a reviewer
// cannot see in a static screenshot: motion following the house rules in AGENTS.md.
const sheets = {
  onboarding: '../../src/components/onboarding/Onboarding.module.css',
  hero: '../../src/components/onboarding/WelcomeHero.module.css',
} as const;

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('guided-start styles', () => {
  it('animates with the house ease-out and never from scale(0) or ease-in', () => {
    for (const path of Object.values(sheets)) {
      const css = read(path);
      expect(css).not.toMatch(/scale\(0\)/);
      expect(css).not.toMatch(/\bease-in\b/);
      for (const match of css.matchAll(/(?:transition|animation)\s*:([^;]+);/g)) {
        const value = match[1] ?? '';
        if (/\b\d+ms\b/.test(value) && !/^\s*none/.test(value)) {
          expect(value).toMatch(/cubic-bezier\(0\.23, 1, 0\.32, 1\)|var\(--onb-ease\)|var\(--ease-out\)|linear/);
        }
      }
    }
  });

});
