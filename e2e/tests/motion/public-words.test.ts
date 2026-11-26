import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * This repository is public, and how a moving character is made is not. Nothing that ships with Pixo Motion (the
 * players in `game-sdk/openpixo-motion`, the app's code for it and the words its page shows) may name what goes
 * into making one. The patterns are narrow on purpose, so ordinary words and minified code do not trip them.
 */
const root = path.resolve(import.meta.dirname, '../../..');
const SOURCES = [
  'game-sdk/openpixo-motion', 'apps/daemon/src/motion', 'apps/web/src/components/motion', 'apps/web/src/providers/motion.ts', 'packages/contracts/src/api/pixo-motion.ts',
];
const FORBIDDEN: [string, RegExp][] = [
  // `--prompt-file` is the CLI's flag for long text, and `promptFacts` the daemon's name for what an agent is told
  ['a prompt', /\bprompts?\b(?!-file)/iu],
  ['a vendor', /\bfal\b|\bfal\.ai\b|openai|gpt-image/iu],
];

function files(entry: string): string[] {
  const full = path.join(root, entry);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [entry];
  return readdirSync(full).flatMap(name => files(`${entry}/${name}`));
}

/** The words the page shows, in both languages. */
function pageWords(): string {
  return ['en', 'zh-CN'].map(locale => readFileSync(path.join(root, `apps/web/src/i18n/locales/${locale}.ts`), 'utf8').split('\n').filter(line => /^\s*'motion\./u.test(line)).join('\n')).join('\n');
}

describe('Pixo Motion in the public repository', () => {
  const shipped = SOURCES.flatMap(files);

  it('[P1] finds the players and the app code it checks', () => {
    for (const expected of ['game-sdk/openpixo-motion/web/pixo-motion.min.js', 'game-sdk/openpixo-motion/phaser/pixo-motion-phaser.js', 'apps/daemon/src/motion/routes.ts', 'apps/web/src/components/motion/MotionPage.tsx']) expect(shipped).toContain(expected);
    expect(pageWords()).toContain("'motion.title'");
  });

  it.each(FORBIDDEN)('[P1] never names %s', (_what, pattern) => {
    const found = [...shipped.map(file => [file, readFileSync(path.join(root, file), 'utf8')] as const), ['page words', pageWords()] as const]
      .flatMap(([file, text]) => { const hit = pattern.exec(text); return hit ? [`${file}: ${text.slice(Math.max(0, hit.index - 30), hit.index + 30)}`] : []; });
    expect(found).toEqual([]);
  });

  it('[P1] trips on the words it looks for', () => {
    const samples = ['an image prompt', 'via fal', 'gpt-image-1'];
    expect(samples.filter(sample => !FORBIDDEN.some(([, pattern]) => pattern.test(sample)))).toEqual([]);
    const ordinary = ['--prompt-file <path|->', 'promptFacts', 'false'];
    expect(ordinary.filter(sample => FORBIDDEN.some(([, pattern]) => pattern.test(sample)))).toEqual([]);
  });
});
