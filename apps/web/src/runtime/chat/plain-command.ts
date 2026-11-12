/**
 * What a command did, said the way a game developer would say it.
 *
 * Most agents run everything through a shell and give no description, so the
 * execution record used to show `Get-Location; Get-ChildItem -Force | Select…`
 * and `!logs/**`. A row now leads with these words and keeps the raw command in
 * its fold. Every answer comes from the command's own syntax, the same evidence
 * `tool-kind.ts` classifies with: when nothing is certain the row says "Ran a
 * command" rather than guess at the agent's intent.
 *
 * Agent-written descriptions and single-file rows ("Read player.gd") already read
 * plainly, so they never come through here. Decision D58 in
 * `specs/current/chat-panel-next.md`.
 */
import { commandIntent } from './tool-kind';

export type PlainWordsKey =
  | 'listFolder' | 'listNamedFolder' | 'findFiles' | 'searchProject' | 'searchFor'
  | 'findTool' | 'where' | 'version' | 'exists'
  | 'readFiles' | 'writeFiles' | 'makeFolder' | 'copyFiles'
  | 'editFiles' | 'moveFiles' | 'deleteFiles'
  | 'install' | 'build' | 'test' | 'run' | 'engine'
  | 'gitRead' | 'gitSave' | 'git'
  | 'script' | 'fetch' | 'wait' | 'command';

export interface PlainWords {
  key: PlainWordsKey;
  /** Filled in by the wording that names something (`listNamedFolder`, `searchFor`, `engine`). */
  vars?: Record<string, string>;
}

const LIST_TOKENS = /^(ls|dir|tree|get-childitem|gci)$/;
const FIND_FILE_TOKENS = /^(find|fd)$/;
const FIND_TOOL_TOKENS = /^(which|where|locate|get-command|gcm)$/;
const PACKAGE_TOKENS = /^(npm|pnpm|yarn|bun)$/;
const SCRIPT_TOKENS = /^(node|tsx|deno|python|python3|py|ruby|perl|powershell|pwsh|bash|sh)$/;
const FETCH_TOKENS = /^(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)$/;
const VALUE_OPTIONS = /^-(path|literalpath)$/i;

/**
 * Whether a search pattern is something a person would type: words, not a glob or
 * a regex. Only those are worth repeating on the row.
 */
export function isPlainSearchTerm(pattern: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u.test(pattern);
}

/** The one folder a listing names, or null for "here", a filter, or anything dynamic. */
function listedFolder(args: readonly string[]): string | null {
  let target: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (VALUE_OPTIONS.test(arg)) { target = args[i + 1]; break; }
    if (arg.startsWith('-')) {
      // PowerShell and `tree` options that take a value: their value is not a folder.
      if (/^-(filter|include|exclude|depth|l|i)$/i.test(arg)) i += 1;
      continue;
    }
    target = arg;
    break;
  }
  if (!target || !/^[\w./\\-]+$/.test(target) || /^\d+$/.test(target)) return null;
  const name = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return name && name !== '.' && name !== '..' ? name : null;
}

function packageWords(args: readonly string[]): PlainWords | null {
  const script = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0];
  if (args[0] === undefined) return null;
  if (/^(install|i|add|ci)$/.test(args[0])) return { key: 'install' };
  if (script === undefined) return null;
  if (/^build(:|$)/.test(script)) return { key: 'build' };
  if (/^test(:|$)/.test(script)) return { key: 'test' };
  if (/^(dev|start|preview|serve)(:|$)/.test(script)) return { key: 'run' };
  return null;
}

function gitWords(args: readonly string[]): PlainWords {
  const sub = args.find((arg) => !arg.startsWith('-'));
  if (sub && /^(status|log|diff|show|branch|blame|rev-parse)$/.test(sub)) return { key: 'gitRead' };
  if (sub === 'commit') return { key: 'gitSave' };
  return { key: 'git' };
}

function execWords(token: string, args: readonly string[]): PlainWords {
  if (args.length === 1 && /^(--version|-v|-version|version)$/i.test(args[0] ?? '')) return { key: 'version' };
  if (/^(sleep|start-sleep)$/.test(token)) return { key: 'wait' };
  if (/^(get-location|gl)$/.test(token)) return { key: 'where' };
  if (token === 'test-path') return { key: 'exists' };
  if (FIND_TOOL_TOKENS.test(token)) return { key: 'findTool' };
  if (token === 'git') return gitWords(args);
  if (token === 'npx' && args[0]) return execWords(args[0], args.slice(1));
  if (PACKAGE_TOKENS.test(token)) {
    const words = packageWords(args);
    if (words) return words;
  }
  if (token === 'pip' || token === 'pip3') return { key: args[0] === 'install' ? 'install' : 'command' };
  if (/^(tsc|webpack|esbuild|rollup)$/.test(token) || (token === 'vite' && args[0] === 'build')) return { key: 'build' };
  if (/^(vitest|jest|pytest)$/.test(token)) return { key: 'test' };
  if (/^godot/.test(token)) return { key: 'engine', vars: { name: 'Godot' } };
  if (FETCH_TOKENS.test(token)) return { key: 'fetch' };
  if (SCRIPT_TOKENS.test(token)) return { key: 'script' };
  return { key: 'command' };
}

function searchWords(token: string, args: readonly string[], pattern: string | null): PlainWords {
  if (LIST_TOKENS.test(token)) {
    const folder = listedFolder(args);
    return folder ? { key: 'listNamedFolder', vars: { folder } } : { key: 'listFolder' };
  }
  if (FIND_TOOL_TOKENS.test(token)) return { key: 'findTool' };
  if (FIND_FILE_TOKENS.test(token) || args.includes('--files')) return { key: 'findFiles' };
  if (pattern && isPlainSearchTerm(pattern)) return { key: 'searchFor', vars: { term: pattern } };
  return { key: 'searchProject' };
}

/** The words for a shell command the agent gave no description for. */
export function plainCommandWords(command: string, pattern: string | null = null): PlainWords {
  const { kind, token: rawToken, args } = commandIntent(command);
  const token = rawToken.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  switch (kind) {
    case 'search': return searchWords(token, args, pattern);
    case 'read': return { key: token === 'pwd' ? 'where' : 'readFiles' };
    case 'write':
      if (token === 'mkdir') return { key: 'makeFolder' };
      if (token === 'cp') return { key: 'copyFiles' };
      return { key: FETCH_TOKENS.test(token) ? 'fetch' : 'writeFiles' };
    case 'edit': return { key: token === 'mv' ? 'moveFiles' : 'editFiles' };
    case 'delete': return { key: 'deleteFiles' };
    default: return execWords(token, args);
  }
}

/** The words for a native search tool (Grep, Glob, WebSearch…) whose pattern is not readable. */
export function plainSearchToolWords(toolName: string): PlainWords {
  return { key: /glob|file/i.test(toolName) ? 'findFiles' : 'searchProject' };
}
