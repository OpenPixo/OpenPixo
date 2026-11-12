import { describe, expect, it } from 'vitest';
import { isPlainSearchTerm, plainCommandWords, plainSearchToolWords } from '../../../src/runtime/chat/plain-command';

/** The commands the owner saw on screen come first; the rest are shapes from real sessions. */
describe('plainCommandWords', () => {
  it.each([
    ['Get-Location; Get-ChildItem -Force | Select-Object Mode,Name,Length', 'listFolder'],
    ['ls -la', 'listFolder'],
    ['Get-ChildItem -Filter *.gd', 'listFolder'],
    ['rg --files -g "!logs/**"', 'findFiles'],
    ['find . -name "*.gd"', 'findFiles'],
    ['rg -n "move_and_slide|velocity" src', 'searchProject'],
    ['pwd', 'where'],
    ['Get-Location', 'where'],
    ['which godot', 'findTool'],
    ['node --version', 'version'],
    ['Test-Path .\\project.godot', 'exists'],
    ['wc -l a.gd b.gd', 'readFiles'],
    ['mkdir assets sprites', 'makeFolder'],
    ['mv a.gd b.gd scripts/', 'moveFiles'],
    ['rm -f a.gd b.gd', 'deleteFiles'],
    ['npm install', 'install'],
    ['cd game && pnpm add phaser', 'install'],
    ['npm run build', 'build'],
    ['npx tsc --noEmit', 'build'],
    ['npm test', 'test'],
    ['npm run dev', 'run'],
    ['git status --short', 'gitRead'],
    ['git commit -m "first level"', 'gitSave'],
    ['git add .', 'git'],
    ['node scripts/make-level.js', 'script'],
    ['curl https://example.com/data.json', 'fetch'],
    ['Start-Sleep -Seconds 2', 'wait'],
    ['some-unknown-tool --flag', 'command'],
    ['$env:FOO_BIN run', 'command'],
  ])('%s -> %s', (command, key) => {
    expect(plainCommandWords(command).key).toBe(key);
  });

  it('unwraps the shell an agent wraps its command in', () => {
    expect(plainCommandWords(`powershell.exe -NoProfile -Command 'Get-Location; Get-ChildItem -Force'`).key).toBe('listFolder');
    expect(plainCommandWords(`/bin/zsh -lc 'npm run build'`).key).toBe('build');
  });

  it('names a folder only when the command names exactly that', () => {
    expect(plainCommandWords('ls -la assets/sprites')).toEqual({ key: 'listNamedFolder', vars: { folder: 'sprites' } });
    expect(plainCommandWords('Get-ChildItem -Path scenes -Force')).toEqual({ key: 'listNamedFolder', vars: { folder: 'scenes' } });
    expect(plainCommandWords('ls .').key).toBe('listFolder');
    expect(plainCommandWords('ls $DIR').key).toBe('listFolder');
  });

  it('repeats a search term only when a person could have typed it', () => {
    expect(plainCommandWords('rg -n Player src', 'Player')).toEqual({ key: 'searchFor', vars: { term: 'Player' } });
    expect(plainCommandWords('rg -n "a|b" src', 'a|b').key).toBe('searchProject');
  });
});

describe('isPlainSearchTerm', () => {
  it.each(['Player', '商品卡', 'jump height', 'player_controller.gd'])('accepts %s', (term) => {
    expect(isPlainSearchTerm(term)).toBe(true);
  });
  it.each(['!logs/**', '*.gd', 'move_and_slide|velocity', '^func\\s+', ''])('rejects %s', (term) => {
    expect(isPlainSearchTerm(term)).toBe(false);
  });
});

describe('plainSearchToolWords', () => {
  it('tells a file search from a content search', () => {
    expect(plainSearchToolWords('Glob').key).toBe('findFiles');
    expect(plainSearchToolWords('Grep').key).toBe('searchProject');
  });
});
