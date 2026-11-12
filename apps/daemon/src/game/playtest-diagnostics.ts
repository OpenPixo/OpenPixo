import { GAME_PLAYTEST_LIMITS } from '@openpixo/contracts';
/** Scan the entire stream even after the persisted log fills; retain bounded, ANSI-free error lines. */
export function createGodotErrorCollector() {
  let tail = '';
  const errors: string[] = [];
  const line = (text: string) => {
    if (errors.length < GAME_PLAYTEST_LIMITS.pageErrors && /^\s*(?:SCRIPT ERROR|ERROR):/.test(text))
      errors.push(text.slice(0, GAME_PLAYTEST_LIMITS.messageLength));
  };
  return {
    append(chunk: Buffer | string) {
      const lines = (tail + chunk.toString()).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
      tail = lines.pop() ?? '';
      for (const text of lines) line(text);
      if (tail.length > 8192) { line(tail); tail = ''; }
    },
    finish() { line(tail); tail = ''; return [...errors]; },
  };
}
