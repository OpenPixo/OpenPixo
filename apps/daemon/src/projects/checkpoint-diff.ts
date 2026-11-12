import { CHECKPOINT_DIFF_LIMITS, type CheckpointDiffHunk } from '@openpixo/contracts';

/**
 * A project-relative path a checkpoint diff may name, in Git's `/` form.
 *
 * Returns null for anything that could leave the project or that Git would
 * read as something other than one literal path: absolute and drive paths,
 * `.`/`..`/empty segments, NUL bytes. Backslashes are accepted as separators
 * so a Windows-shaped relative path names the same file.
 */
export function checkpointRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 4_096 || raw.includes('\0')) return null;
  const candidate = raw.replace(/\\/gu, '/');
  if (candidate.startsWith('/') || /^[A-Za-z]:/u.test(candidate)) return null;
  const segments = candidate.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

/** A Git pathspec that matches exactly `relative`, with no glob or magic interpretation. */
export function literalPathspec(relative: string): string {
  return `:(literal)${relative}`;
}

export interface ParsedFileDiff {
  hunks: CheckpointDiffHunk[];
  lines: number;
  truncated: boolean;
}

/**
 * Hunks of one file's `git diff` output, keeping at most `maxLines` lines.
 * Header lines before the first `@@` are skipped; `\ No newline at end of
 * file` markers carry no content and are dropped.
 */
export function parseUnifiedDiff(text: string, maxLines: number): ParsedFileDiff {
  const hunks: CheckpointDiffHunk[] = [];
  let current: CheckpointDiffHunk | null = null;
  let lines = 0;
  let truncated = false;
  const rows = text.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  for (const raw of rows) {
    const row = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (row.startsWith('@@')) {
      if (lines >= maxLines) { truncated = true; break; }
      current = { header: row, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    const marker = row[0];
    const kind = marker === '+' ? 'add' : marker === '-' ? 'del' : marker === ' ' || row === '' ? 'context' : null;
    if (!kind) continue;
    if (lines >= maxLines) { truncated = true; break; }
    let content = row.slice(1);
    if (content.length > CHECKPOINT_DIFF_LIMITS.maxLineChars) {
      content = content.slice(0, CHECKPOINT_DIFF_LIMITS.maxLineChars);
      truncated = true;
    }
    current.lines.push({ kind, text: content });
    lines += 1;
  }
  return { hunks, lines, truncated };
}

/**
 * Split a multi-file `git diff` into per-file sections, in output order.
 * Each section starts at its `diff --git ` line.
 */
export function splitFileDiffs(text: string): string[] {
  const sections: string[] = [];
  let start = -1;
  let cursor = 0;
  while (cursor <= text.length) {
    const end = text.indexOf('\n', cursor);
    const lineEnd = end === -1 ? text.length : end;
    if (text.startsWith('diff --git ', cursor)) {
      if (start !== -1) sections.push(text.slice(start, cursor));
      start = cursor;
    }
    if (end === -1) break;
    cursor = lineEnd + 1;
  }
  if (start !== -1) sections.push(text.slice(start));
  return sections;
}
