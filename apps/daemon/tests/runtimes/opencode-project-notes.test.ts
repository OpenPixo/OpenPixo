import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderProjectNotesTurnNote } from '@openpixo/contracts';

import { buildOpenCodeMcpConfigContent } from '../../src/mcp-config.js';
import { openCodeRunExtraConfig } from '../../src/runtimes/opencode-permissions.js';
import {
  OPENCODE_PROJECT_NOTES_MAX_BYTES,
  stageOpenCodeProjectNotes,
} from '../../src/runtimes/opencode-project-notes.js';

let root: string;
let dataDir: string;
let projectDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pixo-project-notes-'));
  dataDir = path.join(root, 'data');
  projectDir = path.join(root, 'game');
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('project notes for OpenCode', () => {
  const stage = (extra: { conversationId?: string | null; resumingSession?: boolean; projectId?: string; projectDir?: string | null } = {}) =>
    stageOpenCodeProjectNotes({ dataDir, projectId: extra.projectId ?? 'p1', projectDir: extra.projectDir === undefined ? projectDir : extra.projectDir,
      conversationId: extra.conversationId ?? 'c1', resumingSession: extra.resumingSession ?? false });

  it('hands a copy of the game folder AGENTS.md to the run', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), '# Notes\nPlayer: src/player.ts\n');
    const { files, changedSinceSnapshot } = await stage();
    expect(files).toHaveLength(1);
    expect(files[0]!.startsWith(path.join(dataDir, 'agent-runtime', 'opencode', 'project-notes', 'p1'))).toBe(true);
    expect(await readFile(files[0]!, 'utf8')).toBe('# Notes\nPlayer: src/player.ts\n');
    expect(changedSinceSnapshot).toBeNull();
  });

  it('takes the first name OpenCode looks for', async () => {
    await writeFile(path.join(projectDir, 'CLAUDE.md'), 'claude');
    await writeFile(path.join(projectDir, 'CONTEXT.md'), 'context');
    const { files: [file] } = await stage();
    expect(path.basename(file!)).toBe('CLAUDE.md');
  });

  it('keeps a resumed conversation on the notes it started with, byte for byte', async () => {
    const notes = path.join(projectDir, 'AGENTS.md');
    await writeFile(notes, 'first');
    const turn1 = await stage();
    const prefix = await readFile(turn1.files[0]!);
    // The agent updates its notes as the last step of turn 1.
    await writeFile(notes, 'edited at the end of the turn');
    const turn2 = await stage({ resumingSession: true });
    expect(turn2.files).toEqual(turn1.files);
    expect((await readFile(turn2.files[0]!)).equals(prefix)).toBe(true);
    expect(turn2.changedSinceSnapshot).toBe('AGENTS.md');
    // A new session (compaction, a changed prompt) takes the current notes.
    const fresh = await stage({ resumingSession: false });
    expect(await readFile(fresh.files[0]!, 'utf8')).toBe('edited at the end of the turn');
    expect(fresh.changedSinceSnapshot).toBeNull();
    expect((await stage({ resumingSession: true })).changedSinceSnapshot).toBeNull();
  });

  it('keeps a conversation that started without notes without them', async () => {
    expect(await stage()).toEqual({ files: [], changedSinceSnapshot: null });
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'written in turn 1');
    expect(await stage({ resumingSession: true })).toEqual({ files: [], changedSinceSnapshot: 'AGENTS.md' });
    expect((await stage({ resumingSession: false })).files).toHaveLength(1);
  });

  it('gives each conversation its own snapshot', async () => {
    const notes = path.join(projectDir, 'AGENTS.md');
    await writeFile(notes, 'v1');
    const a = await stage({ conversationId: 'a' });
    await writeFile(notes, 'v2');
    const b = await stage({ conversationId: 'b' });
    expect(await readFile(a.files[0]!, 'utf8')).toBe('v1');
    expect(await readFile(b.files[0]!, 'utf8')).toBe('v2');
  });

  it('takes a snapshot when a resumed session has none yet', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'notes');
    const { files, changedSinceSnapshot } = await stage({ resumingSession: true });
    expect(await readFile(files[0]!, 'utf8')).toBe('notes');
    expect(changedSinceSnapshot).toBeNull();
  });

  it('leaves an unchanged copy alone', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'same');
    const { files: [file] } = await stage();
    const before = (await stat(file!)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await stage();
    expect((await stat(file!)).mtimeMs).toBe(before);
  });

  it('stages nothing without notes, without a project folder, or for an oversized file', async () => {
    expect((await stage()).files).toEqual([]);
    expect((await stage({ projectDir: null })).files).toEqual([]);
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'x'.repeat(OPENCODE_PROJECT_NOTES_MAX_BYTES + 1));
    expect((await stage()).files).toEqual([]);
  });

  it('refuses a project id that is not a plain folder name', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'notes');
    expect((await stage({ projectId: '../escape' })).files).toEqual([]);
  });
});

describe('the per-turn project notes line', () => {
  it('says only that the file is newer, and nothing when it is not', () => {
    expect(renderProjectNotesTurnNote(null)).toBe('');
    expect(renderProjectNotesTurnNote('AGENTS.md')).toContain('`AGENTS.md` in the project folder changed since this conversation started');
  });
});

describe('project notes in the OpenCode run config', () => {
  it.each(['openpixo-agent', 'byok-opencode', 'opencode'])('reaches OpenCode for %s', (agentId) => {
    const extraConfig = openCodeRunExtraConfig(agentId, null, false, ['/data/notes/AGENTS.md'])!;
    const content = JSON.parse(buildOpenCodeMcpConfigContent([], {}, { extraConfig })!);
    expect(content.instructions).toEqual(['/data/notes/AGENTS.md']);
  });

  it('keeps instructions a provider config already had, and survives a read-only turn', () => {
    const config = openCodeRunExtraConfig('openpixo-agent', { instructions: ['/a.md'] }, true, ['/b.md'])!;
    expect(config.instructions).toEqual(['/a.md', '/b.md']);
    expect((config.permission as Record<string, unknown>).edit).toBe('deny');
  });

  it("adds nothing to the user's own OpenCode when there are no notes", () => {
    expect(openCodeRunExtraConfig('opencode', null, false, [])).toBeNull();
  });
});
