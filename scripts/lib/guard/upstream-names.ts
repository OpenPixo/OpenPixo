import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface AllowlistEntry {
  path: string;
  reason: string;
  linePattern?: string;
}

function globPattern(glob: string): RegExp {
  const escaped = glob.split(/(\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*' ? '[^/]*'
    : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${escaped}$`);
}

// The only exception registry. Mixed files can exempt a reviewed line rather
// than granting permission to introduce old names throughout the file.
const allowlist = (JSON.parse(readFileSync(new URL('./upstream-name-allowlist.json', import.meta.url), 'utf8')) as AllowlistEntry[])
  .map(entry => {
    if (!entry.path || !entry.reason.trim()) throw new Error('Every naming exception requires a path and reason.');
    return { ...entry, pathPattern: globPattern(entry.path), line: entry.linePattern ? new RegExp(entry.linePattern) : undefined };
  });

interface NamingPattern {
  name: string;
  pattern: RegExp;
  styleOnly?: boolean;
}

// Character classes keep the policy and its tests subject to their own scan.
// Brand forms are separate so camel-case brands and case-insensitive whole
// words are caught without treating ordinary longer words as product names.
const patterns: NamingPattern[] = [
  { name: 'package scope', pattern: /@open[-]design\//i },
  { name: 'camel-case brand', pattern: /Open[D]esign/ },
  { name: 'spaced brand', pattern: /\bOpen[ ]Design\b/i },
  { name: 'product slug', pattern: /open[-]design/i },
  { name: 'underscore brand', pattern: /OPEN[_]DESIGN/i },
  { name: 'compact brand word', pattern: /\bopen[d]esign\b/i },
  // Match embedded identifiers too; the unrelated example name ending in s
  // is permitted. Embedded binary payloads are removed separately below.
  { name: 'upstream organization', pattern: /n[e]xu(?!s\b)/i },
  // Also catch embedded environment families following an underscore.
  { name: 'environment/constant prefix', pattern: /(?:\b|_)O[D]_[A-Z0-9_]/ },
  { name: 'owned wire key', pattern: /\bo[d]_[a-z]/i },
  { name: 'owned token/continuation prefix', pattern: /\bo[d](?:lt|tt|dl|token|next)[_-]/i },
  { name: 'HTTP header', pattern: /x-o[d]-/i },
  { name: 'card tag', pattern: /<o[d]-card\b/i },
  { name: 'manifest filename', pattern: /open[-]design[.]json/i },
  // A word boundary avoids unrelated scheme names that merely end in these letters.
  { name: 'OS protocol', pattern: /\bo[d]:\/\//i },
  { name: 'quoted event/storage prefix', pattern: /["'`]o[d]:[a-z]/i },
  // The leading boundary excludes unrelated filenames with a similar suffix.
  { name: 'project directory', pattern: /(^|[^\w-])[.]o[d]\// },
  { name: 'CSS custom property', pattern: /--o[d]-/i, styleOnly: true },
  // A delimiter is required: ordinary words ending in the same letters are safe.
  { name: 'CSS class/hook', pattern: /(^|[\s."'`])o[d]-[a-z]/, styleOnly: true },
  { name: 'retired cloud runtime', pattern: /\b[v]ela\b/i },
];

const sourceOrStyle = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html?|vue|svelte|mdx)$/i;
const shippedMarkdown = /^(?:skills|design-templates|plugins|craft|prompt-templates)\/.+\.md$/i;
const legacyPath = /open-?desig[n]|(?:^|\/)o[d][-.]/i;
// Case-sensitive camel-case boundary permits unrelated ordinary names.
const legacyCamelPath = /(?:^|\/)[oO]d[A-Z]/;

export interface UpstreamNameViolation {
  filePath: string;
  lineNumber: number;
  pattern: string;
  match: string;
}

function wholeFileAllowed(filePath: string): boolean {
  return allowlist.some(entry => !entry.line && entry.pathPattern.test(filePath));
}

export function collectUpstreamNameViolationsFromSource(filePath: string, source: string): UpstreamNameViolation[] {
  if (wholeFileAllowed(filePath)) return [];
  const violations: UpstreamNameViolation[] = [];
  for (const pattern of [legacyPath, legacyCamelPath]) {
    const match = pattern.exec(filePath);
    if (match) violations.push({ filePath, lineNumber: 1, pattern: 'tracked path', match: match[0] });
  }
  const checkStyle = sourceOrStyle.test(filePath) || shippedMarkdown.test(filePath);
  const allowedLines = allowlist.filter(entry => entry.line && entry.pathPattern.test(filePath)).map(entry => entry.line!);
  source.split(/\r?\n/).forEach((line, index) => {
    if (allowedLines.some(pattern => pattern.test(line))) return;
    // Embedded binary assets are evidence bytes, not identifiers. Keep their
    // surrounding markup visible to the scan; never exempt the containing file.
    const text = line.replace(/data:[^\s"'<>]*?;base64,[A-Za-z0-9+/=]+/gi, '');
    for (const { name, pattern, styleOnly } of patterns) {
      if (styleOnly && !checkStyle) continue;
      const match = pattern.exec(text);
      if (match) violations.push({ filePath, lineNumber: index + 1, pattern: name, match: match[0] });
    }
  });
  return violations;
}

export async function checkUpstreamNames(repoRoot: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  const files = [...new Set(stdout.split('\0').filter(Boolean))].sort();
  const violations: UpstreamNameViolation[] = [];
  let textFiles = 0;
  // Bound filesystem concurrency rather than launching thousands of reads.
  for (let offset = 0; offset < files.length; offset += 64) {
    await Promise.all(files.slice(offset, offset + 64).map(async file => {
      if (wholeFileAllowed(file)) return;
      let bytes: Buffer;
      try {
        bytes = await readFile(path.join(repoRoot, file));
      } catch (error) {
        // An indexed deletion has no worktree content to scan. Other I/O errors fail closed.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      if (bytes.includes(0)) {
        // Binary contents are excluded, but a binary artifact's tracked name is not.
        violations.push(...collectUpstreamNameViolationsFromSource(file, ''));
        return;
      }
      textFiles += 1;
      violations.push(...collectUpstreamNameViolationsFromSource(file, bytes.toString('utf8')));
    }));
  }
  if (violations.length) {
    console.error('Upstream-name regression check failed:');
    for (const violation of violations.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber || a.pattern.localeCompare(b.pattern))) {
      console.error(`${violation.filePath}:${violation.lineNumber} [${violation.pattern}] ${JSON.stringify(violation.match)}`);
    }
    console.error('Use OpenPixo/pixo/PIXO names from ADR 0011. For required legal, historical or recorded evidence, review a precise path/line exception in scripts/lib/guard/upstream-name-allowlist.json with a reason; do not add compatibility names.');
    return false;
  }
  console.log(`Upstream-name regression check passed: ${files.length} tracked paths, ${textFiles} non-exempt text files.`);
  return true;
}
