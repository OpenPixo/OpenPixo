import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthorizeProjectRequest } from '../../src/projects/project-access.js';

describe('local project access', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-project-access-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function fixture(project: { metadata?: { baseDir?: string } } | null = {}) {
    const sendApiError = vi.fn();
    const getProject = vi.fn(() => project);
    return {
      sendApiError, getProject,
      authorize: createAuthorizeProjectRequest({ db: {}, PROJECTS_DIR: path.join(root, 'projects'), getProject, sendApiError }),
    };
  }
  it('allows reads and writes of a local project before its lazy directory exists', async () => {
    const { authorize, sendApiError } = fixture();
    await expect(authorize({}, {} as never, 'local-project', { mode: 'read' })).resolves.toBe(true);
    await expect(authorize({}, {} as never, 'local-project', { mode: 'write', capability: 'writeFiles' })).resolves.toBe(true);
    expect(sendApiError).not.toHaveBeenCalled();
  });
  it('allows a selected imported game directory outside the managed project root', async () => {
    const baseDir = path.join(root, 'game');
    await mkdir(baseDir);
    const { authorize } = fixture({ metadata: { baseDir } });
    await expect(authorize({}, {} as never, 'imported-game', { mode: 'write', capability: 'comment' })).resolves.toBe(true);
  });
  it('rejects traversal ids before reading the project store', async () => {
    const { authorize, getProject, sendApiError } = fixture();
    await expect(authorize({}, {} as never, '../outside', { mode: 'read' })).resolves.toBe(false);
    expect(getProject).not.toHaveBeenCalled();
    expect(sendApiError).toHaveBeenCalledWith({}, 400, 'BAD_REQUEST', 'invalid project id');
  });
  it('rejects a managed directory redirected outside its storage root', async () => {
    const projects = path.join(root, 'projects');
    const outside = path.join(root, 'outside');
    await mkdir(projects);
    await mkdir(outside);
    await symlink(outside, path.join(projects, 'redirected'), 'junction');
    const { authorize, sendApiError } = fixture();
    await expect(authorize({}, {} as never, 'redirected', { mode: 'write', capability: 'writeFiles' })).resolves.toBe(false);
    expect(sendApiError).toHaveBeenCalledWith({}, 403, 'FORBIDDEN', 'project directory is outside its storage root');
  });
  it('rejects missing records and relative imported roots', async () => {
    const missing = fixture(null);
    await expect(missing.authorize({}, {} as never, 'missing', { mode: 'read' })).resolves.toBe(false);
    expect(missing.sendApiError).toHaveBeenCalledWith({}, 404, 'PROJECT_NOT_FOUND', 'project not found');
    const invalid = fixture({ metadata: { baseDir: '../outside' } });
    await expect(invalid.authorize({}, {} as never, 'invalid', { mode: 'read' })).resolves.toBe(false);
    expect(invalid.sendApiError).toHaveBeenCalledWith({}, 403, 'FORBIDDEN', 'invalid project directory');
  });
});
