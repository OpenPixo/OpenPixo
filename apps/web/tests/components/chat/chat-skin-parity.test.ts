import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * OPEND-2204 — chat style ownership.
 *
 * `routines.css` carries the chat skin behind a `.app` ancestor, the only host
 * `ChatPane` still renders under. The `.app ` prefix must never simply be
 * deleted: dropping it would take a rule from (0,2,0) to (0,1,0) and invert its
 * relationship with the `chat.css` base rules.
 */

const routinesCss = readFileSync(
  new URL('../../../src/styles/viewer/routines.css', import.meta.url),
  'utf8',
);


interface Rule {
  line: number;
  branches: string[];
}

function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
}

/** Split a selector list on top-level commas (ignores commas in `()`/`[]`). */
function splitBranches(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const c = prelude[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out.filter(Boolean);
}

/** Collect every declaration block's selector list (at any at-rule nesting). */
function declarationRules(source: string): Rule[] {
  const scan = blankComments(source);
  const rules: Rule[] = [];
  const stack: Array<{ start: number; open: number }> = [];
  let preludeStart = 0;
  for (let i = 0; i < scan.length; i += 1) {
    const c = scan[i];
    if (c === '{') {
      stack.push({ start: preludeStart, open: i });
      preludeStart = i + 1;
    } else if (c === '}') {
      const frame = stack.pop();
      if (frame && !scan.slice(frame.open + 1, i).includes('{')) {
        rules.push({
          line: source.slice(0, frame.start).split('\n').length,
          branches: splitBranches(scan.slice(frame.start, frame.open)),
        });
      }
      preludeStart = i + 1;
    } else if (c === ';' && stack.length === 0) {
      preludeStart = i + 1;
    }
  }
  return rules;
}

function normalize(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim();
}

describe('OPEND-2204 chat skin parity', () => {
  it('keeps the `.app` ancestor so specificity never drops to a single class', () => {
    // Sentinels for the transcript ground and assistant prose metrics.
    for (const selector of [
      '.app .chat-log',
      '.app .msg.assistant',
      '.app .msg.user',
      '.app .msg.assistant .prose-block',
    ]) {
      expect(
        declarationRules(routinesCss).some((rule) =>
          rule.branches.some((branch) => normalize(branch) === selector),
        ),
        `expected ${selector} to still exist verbatim in routines.css`,
      ).toBe(true);
    }
  });

  
});
