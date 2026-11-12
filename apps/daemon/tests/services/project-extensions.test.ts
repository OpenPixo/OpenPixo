import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../../src/db.js';
import { getInstalledPlugin } from '../../src/plugins/registry.js';
import {
  changeProjectExtension,
  importProjectExtension,
  listProjectExtensions,
  resolveProjectExtensions,
  type ProjectExtensionOptions,
} from '../../src/services/project-extensions.js';

let directory: string;
let options: ProjectExtensionOptions;

async function skill(name = 'game-assets', body = 'Preserve originals and create derived assets.'): Promise<string> {
  const folder = path.join(directory, `source-${name}`);
  await mkdir(path.join(folder, 'scripts'), { recursive: true });
  await writeFile(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: Asset helper\n---\n${body}\n`);
  await writeFile(path.join(folder, 'scripts', 'check.ts'), 'console.log("checked")');
  return folder;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'openpixo-extensions-'));
  options = { dataDir: path.join(directory, 'data'), projectId: 'game-a', skillsRoots: [] };
});
afterEach(async () => {
  closeDatabase();
  await rm(directory, { recursive: true, force: true });
});

async function legacyManifest() {
  const root = path.join(options.dataDir, 'project-extensions', options.projectId);
  const entries = [];
  for (const [id, source, enabled] of [
    ['local-assets', path.join(directory, 'original-local'), true],
    ['github-assets', 'https://github.com/example/game-tools/tree/main/skills/github-assets', false],
  ] as const) {
    const original = await skill(id);
    const packageDirectory = `package-${id}`;
    await cp(original, path.join(root, 'skills', packageDirectory, id), { recursive: true });
    await rm(original, { recursive: true });
    entries.push({ kind: 'skill', id, name: id, description: 'Asset helper', source, enabled, version: `sha256:${id}`, directory: packageDirectory });
  }
  entries.push({
    kind: 'mcp', id: 'legacy-mcp', name: 'Legacy MCP', description: 'Project MCP', source: 'inline', enabled: true,
    version: 'sha256:mcp', server: { id: 'legacy-mcp', transport: 'stdio', command: process.execPath, enabled: true, env: { TOKEN: 'legacy-secret' } },
  });
  const file = path.join(root, 'manifest.json');
  const raw = JSON.stringify({ version: 1, entries }, null, 2);
  await writeFile(file, raw);
  return { root, file, raw, entries, backup: path.join(root, 'manifest.v1.bak.json') };
}

describe('project extension manifest v2', () => {
  it('migrates local and GitHub skills and MCP offline, preserving sources, enabled state and a v1 backup', async () => {
    const legacy = await legacyManifest();
    const listed = await listProjectExtensions(options);
    expect(listed.skills.map(({ id, enabled, source }) => ({ id, enabled, source }))).toEqual(
      legacy.entries.filter(entry => entry.kind === 'skill').map(({ id, enabled, source }) => ({ id, enabled, source })),
    );
    expect(listed.skills.every(entry => entry.available && entry.managed)).toBe(true);
    expect(listed.mcpServers[0]).toMatchObject({ id: 'legacy-mcp', enabled: true, available: true });
    expect(JSON.stringify(listed)).not.toContain('legacy-secret');
    expect(await readFile(legacy.backup, 'utf8')).toBe(legacy.raw);
    const manifest = JSON.parse(await readFile(legacy.file, 'utf8'));
    expect(manifest.version).toBe(2);
    expect(manifest.entries).toHaveLength(3);
    const db = openDatabase(directory, { dataDir: options.dataDir });
    for (const [index, reference] of manifest.entries.entries()) {
      const original = legacy.entries[index]!;
      expect(reference).toEqual({ kind: original.kind, pluginId: expect.any(String), version: original.version, enabled: original.enabled });
      const plugin = getInstalledPlugin(db, reference.pluginId)!;
      expect(plugin).toMatchObject({ source: original.source, version: original.version });
      if (original.kind === 'skill') {
        expect(plugin.sourceKind).toBe(index === 0 ? 'local' : 'github');
        expect(plugin.fsPath).toBe(path.join(legacy.root, 'skills', original.directory!));
      }
    }
    const runtime = await resolveProjectExtensions(options);
    expect(runtime.skills.map(entry => entry.id)).toEqual(['local-assets']);
    expect(runtime.mcpServers[0]).toMatchObject({ id: 'legacy-mcp', env: { TOKEN: 'legacy-secret' } });
  });

  it('restores v1 and continues serving its enabled extensions when plugin registration fails', async () => {
    const legacy = await legacyManifest();
    const db = openDatabase(directory, { dataDir: options.dataDir });
    db.exec(`CREATE TRIGGER fail_extension_migration BEFORE INSERT ON installed_plugins
      WHEN NEW.source_kind = 'github' BEGIN SELECT RAISE(FAIL, 'forced migration failure'); END`);
    const listed = await listProjectExtensions(options);
    expect(listed.skills.map(entry => entry.id)).toEqual(['local-assets', 'github-assets']);
    expect(await readFile(legacy.file, 'utf8')).toBe(legacy.raw);
    expect(await readFile(legacy.backup, 'utf8')).toBe(legacy.raw);
    const runtime = await resolveProjectExtensions(options);
    expect(runtime.skills.map(entry => entry.id)).toEqual(['local-assets']);
    expect(runtime.mcpServers[0]!.env?.TOKEN).toBe('legacy-secret');
    db.exec('DROP TRIGGER fail_extension_migration');
    await listProjectExtensions(options);
    expect(JSON.parse(await readFile(legacy.file, 'utf8')).version).toBe(2);
  });

  it('leaves an already-v2 manifest unchanged on read', async () => {
    await importProjectExtension(options, { kind: 'skill', source: await skill() });
    const root = path.join(options.dataDir, 'project-extensions', options.projectId);
    const file = path.join(root, 'manifest.json');
    const raw = `\n${await readFile(file, 'utf8')}\n`;
    expect(JSON.parse(raw).version).toBe(2);
    await writeFile(file, raw);
    const before = await stat(file);
    expect((await resolveProjectExtensions(options)).skills.map(entry => entry.id)).toEqual(['game-assets']);
    expect((await listProjectExtensions(options)).skills[0]).toMatchObject({ enabled: true, available: true });
    expect(await readFile(file, 'utf8')).toBe(raw);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
    await expect(stat(path.join(root, 'manifest.v1.bak.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shares an installed snapshot across concurrent project imports without copying project skill directories', async () => {
    const source = await skill();
    const other = { ...options, projectId: 'game-b' };
    await Promise.all([options, other].map(project => importProjectExtension(project, { kind: 'skill', source })));
    const [first, second] = await Promise.all([options, other].map(project => resolveProjectExtensions(project)));
    expect(first!.skills[0]!.dir).toBe(second!.skills[0]!.dir);
    for (const project of [options, other]) {
      await expect(stat(path.join(project.dataDir, 'project-extensions', project.projectId, 'skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await changeProjectExtension(options, 'skill', 'game-assets', 'remove');
    expect((await resolveProjectExtensions(other)).skills).toHaveLength(1);
    expect(await readFile(path.join(first!.skills[0]!.dir, 'SKILL.md'), 'utf8')).toContain('Preserve originals');
  });
});

describe('project extension ownership and execution inputs', () => {
  it('copies complete local skills and exposes them only to their project; removal preserves source and game output', async () => {
    const source = await skill();
    const output = path.join(directory, 'game-output.png');
    await writeFile(output, 'original');
    await importProjectExtension(options, { kind: 'skill', source });
    const runtime = await resolveProjectExtensions(options);
    expect(runtime.skills.map(entry => entry.id)).toEqual(['game-assets']);
    expect(runtime.skills[0]!.body).toContain('Preserve originals');
    expect(await readFile(path.join(runtime.skills[0]!.dir, 'scripts', 'check.ts'), 'utf8')).toContain('checked');
    expect((await resolveProjectExtensions({ ...options, projectId: 'game-b' })).skills).toEqual([]);
    const listed = await listProjectExtensions(options);
    expect(listed.skills[0]).toMatchObject({ enabled: true, available: true, managed: true, source });
    expect(listed.skills[0]!.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    await changeProjectExtension(options, 'skill', 'game-assets', 'remove');
    expect((await resolveProjectExtensions(options)).skills).toEqual([]);
    expect(await readFile(path.join(source, 'SKILL.md'), 'utf8')).toContain('Preserve originals');
    expect(await readFile(output, 'utf8')).toBe('original');
  });

  it('disables immediately, updates from explicit source, and preserves a working version on failed updates', async () => {
    const source = await skill();
    await importProjectExtension(options, { kind: 'skill', source });
    const oldVersion = (await listProjectExtensions(options)).skills[0]!.version;
    await changeProjectExtension(options, 'skill', 'game-assets', 'disable');
    expect((await resolveProjectExtensions(options)).skills).toEqual([]);
    await writeFile(path.join(source, 'SKILL.md'), '---\nname: game-assets\n---\nUpdated workflow\n');
    await changeProjectExtension(options, 'skill', 'game-assets', 'update');
    expect((await listProjectExtensions(options)).skills[0]).toMatchObject({ enabled: false });
    expect((await listProjectExtensions(options)).skills[0]!.version).not.toBe(oldVersion);
    await changeProjectExtension(options, 'skill', 'game-assets', 'enable');
    expect((await resolveProjectExtensions(options)).skills[0]!.body).toContain('Updated workflow');
    await writeFile(path.join(source, 'SKILL.md'), '---\nname: other-identity\n---\nChanged identity\n');
    await expect(changeProjectExtension(options, 'skill', 'game-assets', 'update')).rejects.toThrow('changed identity');
    expect((await resolveProjectExtensions(options)).skills[0]!.body).toContain('Updated workflow');
  });

  it('passes project MCP secrets only to execution, checks missing dependencies, and leaves global configuration unchanged', async () => {
    await mkdir(options.dataDir, { recursive: true });
    const globalFile = path.join(options.dataDir, 'mcp-config.json');
    const global = JSON.stringify({ servers: [{ id: 'global-only', transport: 'stdio', command: 'global-tool', enabled: true }] });
    await writeFile(globalFile, global);
    await importProjectExtension(options, {
      kind: 'mcp', server: { id: 'asset-tool', transport: 'stdio', command: 'openpixo-missing-runtime-7281', enabled: true, env: { API_KEY: 'do-not-display' } },
    });
    const listed = await listProjectExtensions(options);
    expect(listed.mcpServers[0]!.dependency).toMatchObject({ status: 'missing' });
    expect(JSON.stringify(listed)).not.toContain('do-not-display');
    const runtime = await resolveProjectExtensions(options);
    expect(runtime.mcpServers.map(server => server.id)).toEqual(['asset-tool']);
    expect(runtime.mcpServers[0]!.env?.API_KEY).toBe('do-not-display');
    expect(await readFile(globalFile, 'utf8')).toBe(global);
    await changeProjectExtension(options, 'mcp', 'asset-tool', 'disable');
    expect((await resolveProjectExtensions(options)).mcpServers).toEqual([]);
  });

  it('imports a standard local MCP JSON map and refreshes without enabling a disabled entry', async () => {
    const source = path.join(directory, 'mcp.json');
    await writeFile(source, JSON.stringify({ mcpServers: { assets: { command: process.execPath, args: ['old.ts'] } } }));
    await importProjectExtension(options, { kind: 'mcp', source });
    expect((await resolveProjectExtensions(options)).mcpServers[0]).toMatchObject({ id: 'assets', transport: 'stdio', args: ['old.ts'] });
    await changeProjectExtension(options, 'mcp', 'assets', 'disable');
    await writeFile(source, JSON.stringify({ mcpServers: { assets: { command: process.execPath, args: ['new.ts'] } } }));
    await changeProjectExtension(options, 'mcp', 'assets', 'update');
    expect((await resolveProjectExtensions(options)).mcpServers).toEqual([]);
    await changeProjectExtension(options, 'mcp', 'assets', 'enable');
    expect((await resolveProjectExtensions(options)).mcpServers[0]!.args).toEqual(['new.ts']);
    await changeProjectExtension(options, 'mcp', 'assets', 'remove');
    expect(await readFile(source, 'utf8')).toContain('new.ts');
  });

  it('serializes concurrent changes without losing either extension', async () => {
    await Promise.all(['one', 'two'].map(id => importProjectExtension(options, {
      kind: 'mcp', server: { id, transport: 'stdio', command: process.execPath, enabled: true },
    })));
    expect((await listProjectExtensions(options)).mcpServers.map(entry => entry.id).sort()).toEqual(['one', 'two']);
    await expect(importProjectExtension(options, { kind: 'mcp', server: { id: 'one', transport: 'stdio', command: process.execPath, enabled: true } })).rejects.toThrow('already installed');
    expect((await listProjectExtensions(options)).mcpServers).toHaveLength(2);
  });

  it('fails closed for malformed configuration and never resolves an escaped project path', async () => {
    await expect(importProjectExtension(options, { kind: 'mcp', server: { id: '../escape', transport: 'stdio', command: 'node', enabled: true } })).rejects.toThrow('valid id');
    await expect(importProjectExtension(options, { kind: 'mcp', server: { id: 'bad', transport: 'http', url: 'file:///etc/passwd', enabled: true } })).rejects.toMatchObject({ status: 400 });
    await expect(resolveProjectExtensions({ ...options, projectId: '../escape' })).rejects.toThrow('Invalid project id');
    const root = path.join(options.dataDir, 'project-extensions', options.projectId);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, entries: [{ kind: 'skill', id: 'escape', enabled: true, source: 'x', version: 'x', name: 'x', description: '', directory: '../outside' }] }));
    await expect(resolveProjectExtensions(options)).rejects.toThrow('Invalid project extension entry');
  });

  it('uses the supplied authorized catalog and only adds explicitly chosen skills', async () => {
    const first = await skill('allowed');
    const second = await skill('hidden');
    const { listSkills } = await import('../../src/skills.js');
    const root = path.join(directory, 'catalog');
    await mkdir(root);
    const { cp } = await import('node:fs/promises');
    await cp(first, path.join(root, 'allowed'), { recursive: true });
    await cp(second, path.join(root, 'hidden'), { recursive: true });
    const scoped = { ...options, skillsRoots: [root], catalogSkills: (await listSkills(root)).filter(entry => entry.id === 'allowed') };
    expect((await listProjectExtensions(scoped)).catalog.skills.map(entry => entry.id)).toEqual(['allowed']);
    await expect(importProjectExtension(scoped, { kind: 'skill', catalogId: 'hidden' })).rejects.toThrow('not found');
    await importProjectExtension(scoped, { kind: 'skill', catalogId: 'allowed' });
    expect((await resolveProjectExtensions(scoped)).skills.map(entry => entry.id)).toEqual(['allowed']);
  });
});

it('keeps catalog package versions pinned until explicit update and retains old task paths', async () => {
  const source = await skill('pinned');
  const { cp } = await import('node:fs/promises');
  const catalog = path.join(directory, 'catalog');
  await mkdir(catalog);
  await cp(source, path.join(catalog, 'pinned'), { recursive: true });
  const scoped = { ...options, skillsRoots: [catalog] };
  await mkdir(options.dataDir, { recursive: true });
  const globalFile = path.join(options.dataDir, 'mcp-config.json');
  const server = { id: 'pinned-mcp', transport: 'stdio', command: process.execPath, enabled: true, args: ['before.ts'] };
  await writeFile(globalFile, JSON.stringify({ servers: [server] }));
  await importProjectExtension(scoped, { kind: 'skill', catalogId: 'pinned' });
  await importProjectExtension(scoped, { kind: 'mcp', catalogId: 'pinned-mcp' });
  const captured = await resolveProjectExtensions(scoped);
  const capturedVersion = (await listProjectExtensions(scoped)).skills[0]!.version;
  await writeFile(path.join(catalog, 'pinned', 'SKILL.md'), '---\nname: pinned\n---\nChanged catalog\n');
  await writeFile(globalFile, JSON.stringify({ servers: [{ ...server, args: ['after.ts'] }] }));
  const beforeUpdate = await resolveProjectExtensions(scoped);
  expect(beforeUpdate.skills[0]!.body).not.toContain('Changed catalog');
  expect(beforeUpdate.mcpServers[0]!.args).toEqual(['before.ts']);
  expect((await listProjectExtensions(scoped)).skills[0]!.version).toBe(capturedVersion);
  await changeProjectExtension(scoped, 'skill', 'pinned', 'update');
  await changeProjectExtension(scoped, 'mcp', 'pinned-mcp', 'update');
  expect((await resolveProjectExtensions(scoped)).skills[0]!.body).toContain('Changed catalog');
  expect((await resolveProjectExtensions(scoped)).mcpServers[0]!.args).toEqual(['after.ts']);
  expect((await listProjectExtensions(scoped)).skills[0]!.version).not.toBe(capturedVersion);
  await changeProjectExtension(scoped, 'skill', 'pinned', 'remove');
  expect(await readFile(path.join(captured.skills[0]!.dir, 'SKILL.md'), 'utf8')).toContain('Preserve originals');
});

it('reports missing template fields without executing commands and rejects malformed arguments', async () => {
  await importProjectExtension(options, { kind: 'mcp', server: { id: 'needs-key', templateId: 'allyson', transport: 'stdio', command: process.execPath, enabled: true } });
  const status = (await listProjectExtensions(options)).mcpServers[0]!.dependency;
  expect(status).toMatchObject({ status: 'missing' });
  expect(status!.message).toContain('API_KEY');
  await expect(importProjectExtension(options, { kind: 'mcp', server: { id: 'bad-args', transport: 'stdio', command: 'node', args: ['safe', 123] as unknown as string[], enabled: true } })).rejects.toMatchObject({ status: 400 });
});

it('reports index and full-workflow context costs without returning the private workflow body', async () => {
  const source = await skill('costed', 'PRIVATE_COSTED_WORKFLOW '.repeat(150));
  await importProjectExtension(options, { kind: 'skill', source });
  const runtime = await resolveProjectExtensions(options);
  const listed = await listProjectExtensions(options);
  const cost = listed.skills[0]!.contextCost!;
  expect(cost.onDemandBytes).toBe(Buffer.byteLength(runtime.skills[0]!.body, 'utf8'));
  expect(cost.onDemandTokens).toBe(Math.ceil(cost.onDemandBytes / 4));
  expect(cost.indexTokens).toBe(Math.ceil(cost.indexBytes / 4));
  expect(cost.indexTokens).toBeGreaterThan(0);
  expect(cost.indexTokens).toBeLessThan(cost.onDemandTokens);
  expect(JSON.stringify(listed)).not.toContain('PRIVATE_COSTED_WORKFLOW');
});
