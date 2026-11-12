/**
 * 一次文件调用**自己带着**的内容 —— 工具行展开时画的就是它。纯函数,无 DOM。
 *
 * 只读这一次调用的入参和结果,不问 daemon:所以三家运行时、没有快照的项目、
 * 回放的历史轮次都能看。入参里没有内容时(codex 的 `file_change` 只留两个数字,
 * 补丁在 daemon 那头数完就丢了)返回 null,那一行点文件名去面板看快照 diff。
 *
 * 入参的字段名按运行时分叉,这里是唯一认它们的地方:
 *   claude    file_path / content / old_string / new_string / edits[]
 *   opencode  filePath  / content / oldString  / newString  / patchText
 */
import type { CodeLine, ToolPreview } from './contract';

/** 编辑前后各留几行上下文 —— 够看出改在哪,又不把整段搬进聊天 */
const CONTEXT_LINES = 3;

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function editPair(rec: Record<string, unknown>): { before: string; after: string } | null {
  const before = text(rec.old_string) ?? text(rec.oldString) ?? text(rec.old_str);
  if (before == null) return null;
  return { before, after: text(rec.new_string) ?? text(rec.newString) ?? text(rec.new_str) ?? '' };
}

/** 去掉 Read 结果每行前面的行号(`     1→code` / `00001| code`),留下能高亮的源码 */
function stripLineNumbers(content: string): string {
  const lines = content.replace(/\s+$/, '').split('\n');
  const numbered = /^\s*\d+(?:→|\|\s?|\t)/;
  if (lines.length === 0 || !lines.every((line) => numbered.test(line) || line.trim() === '')) return content;
  return lines.map((line) => line.replace(numbered, '')).join('\n');
}

export function toolPreview(
  tool: string,
  name: string,
  input: unknown,
  resultContent: string | null | undefined,
): ToolPreview | null {
  const rec = asRecord(input);
  if (tool === 'read') {
    // 这里只留引用:`buildTurnBlocks` 每个流式增量都跑一遍,切行去行号等真的展开时再做
    return resultContent ? { kind: 'read', text: resultContent } : null;
  }
  if (tool === 'write') {
    const content = text(rec.content);
    return content == null ? null : { kind: 'write', text: content };
  }
  if (tool === 'edit') {
    const pair = editPair(rec);
    if (pair) return { kind: 'edit', edits: [pair] };
    if (Array.isArray(rec.edits)) {
      const edits = rec.edits.flatMap((edit) => {
        const next = editPair(asRecord(edit));
        return next ? [next] : [];
      });
      if (edits.length > 0) return { kind: 'edit', edits };
    }
    const patch = text(rec.patchText) ?? text(rec.patch) ?? (name.toLowerCase() === 'apply_patch' ? text(rec.input) : null);
    if (patch) return { kind: 'patch', text: patch };
  }
  return null;
}

/** 新旧两段去掉共同的头尾,中间就是这次真正改的那几行 */
function editLines(before: string, after: string): CodeLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const context = (lines: string[]): CodeLine[] => lines.map((line) => ({ kind: 'context', text: line }));
  return [
    ...context(a.slice(Math.max(0, start - CONTEXT_LINES), start)),
    ...a.slice(start, a.length - end).map((line): CodeLine => ({ kind: 'del', text: line })),
    ...b.slice(start, b.length - end).map((line): CodeLine => ({ kind: 'add', text: line })),
    ...context(a.slice(a.length - end, a.length - end + CONTEXT_LINES)),
  ];
}

function patchLines(patch: string): CodeLine[] {
  return patch.replace(/\s+$/, '').split('\n').flatMap((line): CodeLine[] => {
    if (/^(\*\*\*|---|\+\+\+|@@)/.test(line)) return [];
    if (line.startsWith('+')) return [{ kind: 'add', text: line.slice(1) }];
    if (line.startsWith('-')) return [{ kind: 'del', text: line.slice(1) }];
    return [{ kind: 'context', text: line.replace(/^ /, '') }];
  });
}

/** 工具行展开后要画的行;`separators` 是多段编辑之间的分隔(空行不够明显,交给渲染层画) */
export function previewLines(preview: ToolPreview): CodeLine[] {
  switch (preview.kind) {
    case 'read':
      return stripLineNumbers(preview.text).replace(/\n$/, '').split('\n').map((line) => ({ kind: 'plain', text: line }));
    case 'write':
      return preview.text.replace(/\n$/, '').split('\n').map((line) => ({ kind: 'plain', text: line }));
    case 'patch':
      return patchLines(preview.text);
    case 'edit':
      return preview.edits.flatMap((edit, index) => [
        ...(index > 0 ? [{ kind: 'gap', text: '' } satisfies CodeLine] : []),
        ...editLines(edit.before, edit.after),
      ]);
  }
}

/** 「复制」拿到的是改完之后的样子,不带 +/− 和行号 —— 复制出来要能直接用 */
export function previewCopyText(preview: ToolPreview): string {
  switch (preview.kind) {
    case 'read':
      return stripLineNumbers(preview.text);
    case 'write':
      return preview.text;
    case 'patch':
      return patchLines(preview.text).filter((line) => line.kind !== 'del').map((line) => line.text).join('\n');
    case 'edit':
      return preview.edits.map((edit) => edit.after).join('\n\n');
  }
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  html: 'html', htm: 'html', css: 'css', json: 'json', jsonc: 'json',
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', svg: 'xml',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', rs: 'rust', go: 'go', java: 'java',
  swift: 'swift', rb: 'ruby', php: 'php', sql: 'sql', lua: 'lua',
  // 游戏引擎
  cs: 'csharp', gd: 'gdscript', gdshader: 'glsl', glsl: 'glsl', vert: 'glsl', frag: 'glsl',
  hlsl: 'hlsl', shader: 'hlsl', tscn: 'ini', tres: 'ini', cfg: 'ini', ini: 'ini',
};

/** 认不出来返回 null:画成不带颜色的等宽字,不猜语言 */
export function languageOfPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null : null;
}

/** 这条命令用哪门语言高亮:工具名说了算,PowerShell 和 POSIX shell 的语法差太多 */
export function languageOfCommandTool(toolName: string): string {
  return /^(powershell|pwsh)$/i.test(toolName) ? 'powershell' : 'bash';
}

/** 整段输出是一个 JSON 才按 JSON 高亮;一行日志里夹点花括号不算 */
export function outputLanguage(output: string): string | null {
  const trimmed = output.trim();
  if (trimmed.length < 2 || !/^[[{]/.test(trimmed)) return null;
  try { JSON.parse(trimmed); return 'json'; } catch { return null; }
}
