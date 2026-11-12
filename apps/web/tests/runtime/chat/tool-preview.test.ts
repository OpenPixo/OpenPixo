import { describe, expect, it } from 'vitest';
import { diffStat } from '../../../src/runtime/chat/format';
import {
  languageOfCommandTool,
  languageOfPath,
  outputLanguage,
  previewCopyText,
  previewLines,
  toolPreview,
} from '../../../src/runtime/chat/tool-preview';

describe('toolPreview reads what each runtime calls its fields', () => {
  it('Claude Code: file_path / old_string / new_string', () => {
    expect(toolPreview('edit', 'Edit', { file_path: 'a.js', old_string: 'x', new_string: 'y' }, null))
      .toEqual({ kind: 'edit', edits: [{ before: 'x', after: 'y' }] });
    expect(toolPreview('write', 'Write', { file_path: 'a.js', content: 'hello' }, null)).toEqual({ kind: 'write', text: 'hello' });
  });

  it('OpenCode, which the credits model runs on: oldString / newString', () => {
    expect(toolPreview('edit', 'edit', { filePath: 'a.js', oldString: 'x', newString: 'y' }, null))
      .toEqual({ kind: 'edit', edits: [{ before: 'x', after: 'y' }] });
  });

  it('several edits in one call and a patch', () => {
    expect(toolPreview('edit', 'MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, null))
      .toEqual({ kind: 'edit', edits: [{ before: 'a', after: 'b' }, { before: 'c', after: 'd' }] });
    expect(toolPreview('edit', 'apply_patch', { patchText: '+x' }, null)).toEqual({ kind: 'patch', text: '+x' });
  });

  it('has nothing to show for Codex, whose patch the daemon counted and dropped', () => {
    expect(toolPreview('write', 'Write', { file_path: 'a.js', pixo_diff_stat: { added: 2, removed: 0 } }, null)).toBeNull();
  });

  it('shows what a read returned, without its line numbers', () => {
    const numbered = toolPreview('read', 'Read', { file_path: 'a.js' }, '     1→const a = 1;\n     2→const b = 2;\n')!;
    expect(previewLines(numbered).map((line) => line.text)).toEqual(['const a = 1;', 'const b = 2;']);
    expect(previewCopyText(numbered)).toBe('const a = 1;\nconst b = 2;');
    expect(previewCopyText(toolPreview('read', 'Read', { file_path: 'a.js' }, 'plain text')!)).toBe('plain text');
    expect(toolPreview('read', 'Read', { file_path: 'a.js' }, null)).toBeNull();
  });
});

describe('previewLines', () => {
  it('marks only what changed, with a few lines of context', () => {
    const before = ['1', '2', '3', '4', '5', 'old', '6', '7', '8', '9'].join('\n');
    const after = ['1', '2', '3', '4', '5', 'new', 'more', '6', '7', '8', '9'].join('\n');
    expect(previewLines({ kind: 'edit', edits: [{ before, after }] })).toEqual([
      { kind: 'context', text: '3' }, { kind: 'context', text: '4' }, { kind: 'context', text: '5' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' }, { kind: 'add', text: 'more' },
      { kind: 'context', text: '6' }, { kind: 'context', text: '7' }, { kind: 'context', text: '8' },
    ]);
  });

  it('separates the edits of one call', () => {
    const lines = previewLines({ kind: 'edit', edits: [{ before: 'a', after: 'b' }, { before: 'c', after: 'd' }] });
    expect(lines.map((line) => line.kind)).toEqual(['del', 'add', 'gap', 'del', 'add']);
  });

  it('reads a patch without its file headers', () => {
    const patch = '*** Begin Patch\n*** Update File: a.js\n@@\n keep\n-old\n+new\n*** End Patch\n';
    expect(previewLines({ kind: 'patch', text: patch })).toEqual([
      { kind: 'context', text: 'keep' }, { kind: 'del', text: 'old' }, { kind: 'add', text: 'new' },
    ]);
  });
});

describe('previewCopyText', () => {
  it('gives the code as it now is, without diff marks', () => {
    expect(previewCopyText({ kind: 'edit', edits: [{ before: 'old', after: 'new' }] })).toBe('new');
    expect(previewCopyText({ kind: 'patch', text: ' keep\n-old\n+new' })).toBe('keep\nnew');
    expect(previewCopyText({ kind: 'write', text: 'all of it\n' })).toBe('all of it\n');
  });
});

describe('languages', () => {
  it('knows the engines', () => {
    expect(languageOfPath('Assets/Player.cs')).toBe('csharp');
    expect(languageOfPath('scripts\\player.gd')).toBe('gdscript');
    expect(languageOfPath('src/game.ts')).toBe('typescript');
    expect(languageOfPath('README')).toBeNull();
    expect(languageOfPath('.gitignore')).toBeNull();
  });

  it('picks the shell by tool', () => {
    expect(languageOfCommandTool('PowerShell')).toBe('powershell');
    expect(languageOfCommandTool('Bash')).toBe('bash');
  });

  it('calls output JSON only when all of it is', () => {
    expect(outputLanguage('{"ok":true}\n')).toBe('json');
    expect(outputLanguage('building {x}')).toBeNull();
    expect(outputLanguage('{not json')).toBeNull();
  });
});

describe('diffStat', () => {
  it('counts the lines an edit really changed', () => {
    expect(diffStat('Edit', { old_string: 'a\nb\nc', new_string: 'a\nX\nc' })).toEqual({ added: 1, removed: 1 });
  });

  it('counts OpenCode edits, which used to show no numbers at all', () => {
    expect(diffStat('edit', { oldString: 'a', newString: 'a\nb\nc' })).toEqual({ added: 2, removed: 0 });
  });
});
