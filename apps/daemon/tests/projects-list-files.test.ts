import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listFiles, listProjectFolders } from '../src/projects.js';
import { makeIgnored } from '../src/project-watchers.js';

const tempRoots: string[] = [];

async function makeProjectsRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-project-files-'));
  tempRoots.push(root);
  return path.join(root, 'projects');
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('listFiles', () => {
  it('includes the absolute local path for each visible project file', async () => {
    const projectsRoot = await makeProjectsRoot();
    const projectId = 'project-1';
    const projectDir = path.join(projectsRoot, projectId);
    const filePath = path.join(projectDir, 'alpha.html');
    await mkdir(projectDir, { recursive: true });
    await writeFile(filePath, '<!doctype html>');

    const files = await listFiles(projectsRoot, projectId);

    expect(files).toEqual([
      expect.objectContaining({
        name: 'alpha.html',
        path: 'alpha.html',
        localPath: filePath,
      }),
    ]);
  });
});

describe('engine cache folders', () => {
  // A game repository whose Unity project sits in a subfolder: the root-level
  // engine profile is `unknown`, yet Unity's Library/ cache can hold tens of
  // thousands of files that must not be walked on every listing.
  async function makeNestedUnityProject() {
    const projectsRoot = await makeProjectsRoot();
    const projectId = 'game-repo';
    const root = path.join(projectsRoot, projectId);
    for (const dir of [
      'unity/Assets/Sprites',
      'unity/ProjectSettings',
      'unity/Library/PackageCache',
      'unity/Temp',
      'unity/Logs',
      'unity/obj',
      'docs/library',
    ]) {
      await mkdir(path.join(root, dir), { recursive: true });
    }
    await writeFile(path.join(root, 'unity/ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.0.0f1');
    await writeFile(path.join(root, 'unity/Assets/Sprites/hero.png'), 'png');
    await writeFile(path.join(root, 'unity/Library/PackageCache/cached.json'), '{}');
    await writeFile(path.join(root, 'unity/Temp/lock'), '');
    await writeFile(path.join(root, 'unity/Logs/editor.log'), '');
    await writeFile(path.join(root, 'unity/obj/build.json'), '{}');
    await writeFile(path.join(root, 'docs/library/notes.md'), '# notes');
    return { projectsRoot, projectId, root };
  }

  it('skips Unity caches beside a nested Unity project but keeps same-named folders elsewhere', async () => {
    const { projectsRoot, projectId } = await makeNestedUnityProject();

    const files = (await listFiles(projectsRoot, projectId)).map((file) => file.path).sort();
    expect(files).toEqual([
      'docs/library/notes.md',
      'unity/Assets/Sprites/hero.png',
      'unity/ProjectSettings/ProjectVersion.txt',
    ]);

    const folders = (await listProjectFolders(projectsRoot, projectId)).map((folder) => folder.path).sort();
    expect(folders).toEqual([
      'docs',
      'docs/library',
      'unity',
      'unity/Assets',
      'unity/Assets/Sprites',
      'unity/ProjectSettings',
    ]);
  });

  it('keeps the file watcher out of the same caches', async () => {
    const { root } = await makeNestedUnityProject();
    const ignored = makeIgnored(root);

    expect(ignored(path.join(root, 'unity/Library'))).toBe(true);
    expect(ignored(path.join(root, 'unity/Library/PackageCache/cached.json'))).toBe(true);
    expect(ignored(path.join(root, 'unity/Temp/lock'))).toBe(true);
    expect(ignored(path.join(root, 'unity/Assets/Sprites/hero.png'))).toBe(false);
    expect(ignored(path.join(root, 'docs/library/notes.md'))).toBe(false);
  });
});
