import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  it('hands a copy of the game folder AGENTS.md to the run', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), '# Notes\nPlayer: src/player.ts\n');
    const files = await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir });
    expect(files).toHaveLength(1);
    expect(files[0]!.startsWith(path.join(dataDir, 'agent-runtime', 'opencode', 'project-notes', 'p1'))).toBe(true);
    expect(await readFile(files[0]!, 'utf8')).toBe('# Notes\nPlayer: src/player.ts\n');
  });

  it('takes the first name OpenCode looks for', async () => {
    await writeFile(path.join(projectDir, 'CLAUDE.md'), 'claude');
    await writeFile(path.join(projectDir, 'CONTEXT.md'), 'context');
    const [file] = await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir });
    expect(path.basename(file!)).toBe('CLAUDE.md');
  });

  it('keeps a turn on the copy it started with until the next run stages again', async () => {
    const notes = path.join(projectDir, 'AGENTS.md');
    await writeFile(notes, 'first');
    const [file] = await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir });
    await writeFile(notes, 'edited mid-turn');
    expect(await readFile(file!, 'utf8')).toBe('first');
    const [next] = await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir });
    expect(next).toBe(file);
    expect(await readFile(next!, 'utf8')).toBe('edited mid-turn');
  });

  it('leaves an unchanged copy alone', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'same');
    const [file] = await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir });
    const before = (await stat(file!)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir });
    expect((await stat(file!)).mtimeMs).toBe(before);
  });

  it('stages nothing without notes, without a project folder, or for an oversized file', async () => {
    expect(await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir })).toEqual([]);
    expect(await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir: null })).toEqual([]);
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'x'.repeat(OPENCODE_PROJECT_NOTES_MAX_BYTES + 1));
    expect(await stageOpenCodeProjectNotes({ dataDir, projectId: 'p1', projectDir })).toEqual([]);
  });

  it('refuses a project id that is not a plain folder name', async () => {
    await writeFile(path.join(projectDir, 'AGENTS.md'), 'notes');
    expect(await stageOpenCodeProjectNotes({ dataDir, projectId: '../escape', projectDir })).toEqual([]);
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
