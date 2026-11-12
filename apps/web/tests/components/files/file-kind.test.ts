import { describe, expect, it } from 'vitest';
import { projectFileKind, projectFileKindLabel } from '../../../src/components/files/file-kind';
import type { ProjectFileKind } from '../../../src/types';

describe('projectFileKind', () => {
  it.each(['gd', 'gdshader', 'cs', 'shader', 'glsl', 'hlsl', 'tsx'])(
    'opens .%s source as code even when inventory metadata says binary',
    (extension) => {
      expect(projectFileKind({ name: 'game/player.' + extension, kind: 'binary' })).toBe('code');
    },
  );

  it.each([
    'tscn', 'tres', 'godot', 'cfg', 'import', 'json', 'yaml', 'yml', 'toml', 'ini',
    'ldtk', 'tmx', 'unity', 'prefab', 'meta', 'asset', 'uproject',
  ])('opens .%s project and resource data as text', (extension) => {
    expect(projectFileKind({ name: 'game/project.' + extension, kind: 'binary' })).toBe('text');
  });

  it('recognizes dotfiles and Windows paths without changing unknown binary resources', () => {
    expect(projectFileKind({ name: '.gitignore', kind: 'binary' })).toBe('text');
    expect(projectFileKind({ name: 'game\\Player.GD', kind: 'binary' })).toBe('code');
    expect(projectFileKind({ name: 'game/model.glb', kind: 'binary' })).toBe('binary');
    expect(projectFileKind({ name: 'unknown.bin', kind: 'binary' })).toBe('binary');
  });

  it.each<ProjectFileKind>(['sketch', 'image', 'audio', 'video', 'html', 'code', 'text'])(
    'preserves the explicitly selected %s viewer',
    (kind) => {
      expect(projectFileKind({ name: 'special.asset.json', kind })).toBe(kind);
    },
  );
});

describe('projectFileKindLabel', () => {
  it.each(['text', 'code', 'audio', 'video'] as const)('shares the %s label across workspace surfaces', (kind) => {
    expect(projectFileKindLabel(kind, (key) => key)).toBe(
      'filesPanel.kind' + kind.charAt(0).toUpperCase() + kind.slice(1),
    );
  });
});
