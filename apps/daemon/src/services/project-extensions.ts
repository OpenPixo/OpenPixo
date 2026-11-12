import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ImportProjectExtensionRequest,
  InstalledPluginRecord,
  PluginSourceKind,
  ProjectExtensionKind,
  ProjectExtensionSummary,
  ProjectExtensionsResponse,
  StoreItemKind,
} from '@openpixo/contracts';
import { estimateSkillContextCost, StoreItemKindSchema } from '@openpixo/contracts';
import { openDatabase } from '../db.js';
import { MCP_TEMPLATES, readMcpConfig, sanitizeMcpServer, type McpServerConfig } from '../mcp-config.js';
import { safeExternalFetch } from '../plugins/plugin-asset-cache.js';
import { getInstalledPlugin, registryRootsForDataDir, upsertInstalledPlugin } from '../plugins/registry.js';
import { defaultTrustForRecord, resolveCapabilitiesGranted } from '../plugins/trust.js';
import { resolveOnPathAsync } from '../runtimes/executables.js';
import { findSkillById, listSkills, projectSkillIndexEntry, type SkillInfo } from '../skills.js';
import { installSkillFromLocalSource, installSkillFromRemoteSource } from './skill-installation.js';

interface StoredExtension {
  kind: StoreItemKind;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  version: string;
  directory?: string;
  server?: McpServerConfig;
  pluginId?: string;
}

interface Manifest { version: 1 | 2; entries: StoredExtension[] }
interface PluginReference {
  kind: StoreItemKind;
  pluginId: string;
  version: string;
  enabled: boolean;
}

export interface ProjectExtensionOptions {
  dataDir: string;
  projectId: string;
  skillsRoots: readonly string[];
  /** Supply the project's authorized workspace catalog when it has a binding. */
  catalogSkills?: readonly SkillInfo[];
}

export class ProjectExtensionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function extensionRoot(options: ProjectExtensionOptions): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.projectId)) {
    throw new ProjectExtensionError(400, 'Invalid project id');
  }
  return path.join(options.dataDir, 'project-extensions', options.projectId);
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\x00-\x1f]/.test(value);
}

function extensionDatabase(options: ProjectExtensionOptions) {
  return openDatabase(options.dataDir, { dataDir: options.dataDir });
}

function installedExtension(options: ProjectExtensionOptions, reference: PluginReference): StoredExtension {
  const plugin = getInstalledPlugin(extensionDatabase(options), reference.pluginId);
  const extensionId = plugin?.manifest.pixo?.projectExtensionId;
  const spec = plugin?.version === reference.version ? plugin.manifest.pixo?.context?.mcp?.[0] : undefined;
  return {
    kind: reference.kind, pluginId: reference.pluginId, version: reference.version, enabled: reference.enabled,
    id: typeof extensionId === 'string' ? extensionId : reference.pluginId,
    name: plugin?.title ?? reference.pluginId, description: plugin?.manifest.description ?? '', source: plugin?.source ?? '',
    ...(reference.kind === 'mcp' && spec ? { server: validateMcpServer({ ...spec, id: spec.name, transport: spec.transport ?? (spec.url ? 'http' : 'stdio') }) } : {}),
  };
}

function sourceKind(source: string): PluginSourceKind {
  if (path.isAbsolute(source)) return 'local';
  if (/^(?:github:|https:\/\/(?:www\.)?github\.com\/|https:\/\/raw\.githubusercontent\.com\/)/i.test(source)) return 'github';
  return 'project';
}

/** Register an immutable snapshot; project manifests only hold its reference. */
async function registerExtension(options: ProjectExtensionOptions, entry: StoredExtension, folder?: string, staged = false): Promise<StoredExtension> {
  const pluginId = `project-extension-${createHash('sha256').update(JSON.stringify([entry.kind, entry.id, entry.source, entry.version])).digest('hex')}`;
  const pluginRoot = path.join(registryRootsForDataDir(options.dataDir).userPluginsRoot, pluginId);
  return serialize(pluginRoot, async () => {
    const db = extensionDatabase(options);
    if (getInstalledPlugin(db, pluginId)) {
      if (staged && folder) await rm(folder, { recursive: true, force: true });
      return { ...entry, pluginId };
    }
    const skill = entry.kind === 'skill' && folder ? findSkillById(await listSkills(folder), entry.id) : undefined;
    if (entry.kind === 'skill' && !skill) throw new Error(`Project extension ${entry.id} is unavailable`);
    if (entry.kind === 'mcp' && !entry.server) throw new Error(`Project extension ${entry.id} is unavailable`);
    const manifest: InstalledPluginRecord['manifest'] = {
      name: pluginId, title: entry.name, description: entry.description, version: entry.version,
      ...(skill && folder ? { compat: { agentSkills: [{ path: path.relative(folder, skill.dir).replaceAll('\\', '/') }] } } : {}),
      pixo: {
        kind: entry.kind === 'skill' ? 'skill' : 'bundle', projectExtensionId: entry.id,
        ...(entry.server ? { context: { mcp: [{ ...entry.server, name: entry.id }] } } : {}),
      },
    };
    if (staged && folder) await rename(folder, pluginRoot);
    else if (!folder) await mkdir(pluginRoot, { recursive: true });
    const fsPath = staged || !folder ? pluginRoot : folder;
    try {
      // Legacy skill snapshots stay at their existing paths for running tasks.
      if (staged || !folder) await writeFile(path.join(fsPath, 'pixo.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      const kind = sourceKind(entry.source);
      const trust = defaultTrustForRecord({ sourceKind: kind });
      const now = Date.now();
      upsertInstalledPlugin(db, {
        id: pluginId, title: entry.name, version: entry.version, sourceKind: kind, source: entry.source,
        sourceDigest: entry.version, trust, capabilitiesGranted: resolveCapabilitiesGranted({ manifest, trust }),
        manifest, fsPath, installedAt: now, updatedAt: now,
      });
      return { ...entry, pluginId };
    } catch (error) {
      if (staged || !folder) await rm(pluginRoot, { recursive: true, force: true });
      throw error;
    }
  });
}

async function readManifest(options: ProjectExtensionOptions): Promise<Manifest> {
  let raw: string;
  try { raw = await readFile(path.join(extensionRoot(options), 'manifest.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, entries: [] };
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid project extension manifest');
  const manifest = parsed as Manifest;
  if ((manifest.version !== 1 && manifest.version !== 2) || !Array.isArray(manifest.entries) || manifest.entries.length > 200) {
    throw new Error('Unsupported project extension manifest');
  }
  if (manifest.version === 2) {
    const references = (parsed as { entries: PluginReference[] }).entries;
    const identities = new Set<string>();
    for (const entry of references) {
      if (!entry || !StoreItemKindSchema.safeParse(entry.kind).success || !validIdentity(entry.pluginId)
        || !validIdentity(entry.version) || typeof entry.enabled !== 'boolean') throw new Error('Invalid project extension entry');
      const key = `${entry.kind}:${entry.pluginId}`;
      if (identities.has(key)) throw new Error('Duplicate project extension entry');
      identities.add(key);
    }
    return { version: 2, entries: references.map(entry => installedExtension(options, entry)) };
  }
  const identities = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry || (entry.kind !== 'skill' && entry.kind !== 'mcp') || !validIdentity(entry.id)
      || typeof entry.enabled !== 'boolean' || typeof entry.source !== 'string'
      || typeof entry.version !== 'string' || typeof entry.name !== 'string'
      || typeof entry.description !== 'string'
      || (entry.directory !== undefined && !/^[a-zA-Z0-9_-]+$/.test(entry.directory))) {
      throw new Error('Invalid project extension entry');
    }
    const key = `${entry.kind}:${entry.id}`;
    if (identities.has(key)) throw new Error('Duplicate project extension entry');
    identities.add(key);
    if (entry.server) entry.server = validateMcpServer(entry.server);
  }
  const backup = path.join(extensionRoot(options), 'manifest.v1.bak.json');
  let backedUp = false;
  try {
    await writeFile(backup, raw, { mode: 0o600 });
    backedUp = true;
    const entries: StoredExtension[] = [];
    for (const entry of manifest.entries) {
      entries.push(await registerExtension(options, entry, entry.directory ? path.join(extensionRoot(options), 'skills', entry.directory) : undefined));
    }
    const migrated: Manifest = { version: 2, entries };
    await writeManifest(options, migrated);
    return migrated;
  } catch {
    if (backedUp) await writeManifest(options, await readFile(backup, 'utf8').catch(() => raw)).catch(() => undefined);
    return manifest;
  }
}

async function writeManifest(options: ProjectExtensionOptions, manifest: Manifest | string): Promise<void> {
  const root = extensionRoot(options);
  await mkdir(root, { recursive: true });
  const temporary = path.join(root, `.manifest-${randomUUID()}.tmp`);
  try {
    const stored = typeof manifest === 'string' ? manifest : JSON.stringify({
      version: manifest.version,
      entries: manifest.version === 2 ? manifest.entries.map(({ kind, pluginId, version, enabled }) => {
        if (!pluginId) throw new Error('Project extension has no installed plugin');
        return { kind, pluginId, version, enabled };
      }) : manifest.entries,
    }, null, 2);
    await writeFile(temporary, stored, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(root, 'manifest.json'));
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

const writes = new Map<string, Promise<unknown>>();
function serialize<T>(root: string, change: () => Promise<T>): Promise<T> {
  const pending = (writes.get(root) ?? Promise.resolve()).catch(() => undefined).then(change);
  writes.set(root, pending);
  void pending.finally(() => { if (writes.get(root) === pending) writes.delete(root); }).catch(() => undefined);
  return pending;
}

function digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function skillVersion(directory: string): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  let count = 0;
  async function walk(current: string, depth = 0): Promise<void> {
    if (depth > 64) throw new ProjectExtensionError(400, 'Skill tree is too deep');
    for (const name of (await readdir(current)).sort()) {
      if (++count > 10000) throw new ProjectExtensionError(400, 'Skill tree has too many files');
      const file = path.join(current, name);
      const stats = await lstat(file);
      if (stats.isSymbolicLink()) throw new ProjectExtensionError(400, 'Skill symbolic links are not supported');
      hash.update(path.relative(directory, file).replaceAll('\\', '/')).update('\0');
      if (stats.isDirectory()) await walk(file, depth + 1);
      else if (stats.isFile()) {
        bytes += stats.size;
        if (bytes > 50 * 1024 * 1024) throw new ProjectExtensionError(400, 'Skill exceeds 50 MiB');
        hash.update(await readFile(file));
      } else throw new ProjectExtensionError(400, 'Unsupported skill file type');
      hash.update('\0');
    }
  }
  await walk(directory);
  return `sha256:${hash.digest('hex')}`;
}

function validateMcpServer(raw: unknown): McpServerConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProjectExtensionError(400, 'MCP configuration must be an object');
  const value = raw as Record<string, unknown>;
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string' || arg.includes('\0')))) {
    throw new ProjectExtensionError(400, 'MCP arguments must be strings without null bytes');
  }
  for (const field of ['env', 'headers']) {
    const fields = value[field];
    if (fields !== undefined && (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.entries(fields).some(([key, entry]) => !key || typeof entry !== 'string' || /[\x00-\x1f]/.test(key) || entry.includes('\0')))) {
      throw new ProjectExtensionError(400, `MCP ${field} must map names to strings`);
    }
  }
  const server = sanitizeMcpServer(raw);
  if (!server) throw new ProjectExtensionError(400, 'MCP configuration requires a valid id and transport');
  if (server.transport === 'stdio') {
    if (!server.command?.trim() || server.command.includes('\0')) {
      throw new ProjectExtensionError(400, 'stdio MCP requires a command');
    }
  } else {
    let url: URL;
    try { url = new URL(server.url ?? ''); } catch { throw new ProjectExtensionError(400, 'HTTP MCP requires a URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ProjectExtensionError(400, 'MCP URL must use HTTP(S) without embedded credentials');
    }
  }
  return { ...server, enabled: true };
}

async function dependency(server: McpServerConfig): Promise<NonNullable<ProjectExtensionSummary['dependency']>> {
  const template = MCP_TEMPLATES.find(entry => entry.id === server.templateId);
  const missing = [
    ...(template?.envFields ?? []).filter(field => field.required && !server.env?.[field.key]?.trim()).map(field => field.key),
    ...(template?.headerFields ?? []).filter(field => field.required && !Object.entries(server.headers ?? {}).some(([key, value]) => key.toLowerCase() === field.key.toLowerCase() && value.trim())).map(field => field.key),
  ];
  if (missing.length) return { status: 'missing', message: `Configure required fields: ${missing.join(', ')}. Remove and import the edited configuration to replace it.` };
  if (server.transport === 'sse') return { status: 'missing', message: 'Codex requires streamable HTTP or stdio. Configure a supported transport before enabling this server.' };
  if (server.transport !== 'stdio') return { status: 'unknown', message: 'Configured; connection is checked by Codex when the task starts' };
  const command = server.command ?? '';
  const found = path.isAbsolute(command)
    ? await lstat(command).then(stats => stats.isFile()).catch(() => false)
    : Boolean(await resolveOnPathAsync(command));
  return found
    ? { status: 'ready', message: 'Command found; server connection is checked when the task starts' }
    : { status: 'missing', message: `Install ${command} and make it available on PATH, then refresh` };
}

async function resolveEntries(options: ProjectExtensionOptions, manifest: Manifest) {
  const catalogSkills = options.catalogSkills ?? await listSkills(options.skillsRoots);
  const globalMcp = (await readMcpConfig(options.dataDir)).servers;
  const resolved = await Promise.all(manifest.entries.map(async entry => {
    const plugin = entry.pluginId ? getInstalledPlugin(extensionDatabase(options), entry.pluginId) : undefined;
    const skillRoot = entry.pluginId
      ? plugin?.version === entry.version ? plugin.fsPath : undefined
      : entry.directory ? path.join(extensionRoot(options), 'skills', entry.directory) : undefined;
    const managedSkills = skillRoot
      ? [...await listSkills(skillRoot), ...await listSkills(path.dirname(skillRoot), { directoryName: path.basename(skillRoot) })]
      : [];
    const skill = entry.kind === 'skill'
      ? findSkillById(managedSkills, entry.id) ?? (!plugin?.manifest.pixo?.projectExtensionId && managedSkills.length === 1 ? managedSkills[0] : undefined)
      : undefined;
    const server = entry.kind === 'mcp'
      ? entry.server
      : undefined;
    const available = entry.kind === 'skill' ? Boolean(skill) : entry.kind === 'mcp' ? Boolean(server) : plugin?.version === entry.version;
    return { entry, skill, server, available };
  }));
  return { resolved, catalogSkills, globalMcp };
}

export async function listProjectExtensions(options: ProjectExtensionOptions): Promise<ProjectExtensionsResponse> {
  const { resolved, catalogSkills, globalMcp } = await resolveEntries(options, await serialize(extensionRoot(options), () => readManifest(options)));
  const summaries = await Promise.all(resolved.map(async ({ entry, skill, server, available }) => {
    const { directory: _directory, server: _server, pluginId: _pluginId, ...summary } = entry;
    return {
      ...summary,
      managed: Boolean(entry.directory || entry.server || entry.pluginId),
      available,
      ...(skill ? { contextCost: estimateSkillContextCost(projectSkillIndexEntry(skill), skill.body) } : {}),
      ...(server ? { dependency: await dependency(server) } : {}),
    };
  }));
  return {
    skills: summaries.filter(entry => entry.kind === 'skill'),
    mcpServers: summaries.filter(entry => entry.kind === 'mcp'),
    catalog: {
      skills: catalogSkills.filter(skill => !skill.id.includes(':')).map(skill => ({ id: skill.id, name: skill.displayName?.en ?? skill.name, description: skill.description })),
      mcpServers: globalMcp.map(server => ({ id: server.id, name: server.label ?? server.id, description: server.command ?? server.url ?? '' })),
      mcpTemplates: MCP_TEMPLATES,
    },
  };
}

/** Resolve only this project's enabled packages. Global settings remain inputs;
 * importing or removing a project extension never edits the user's CLI home. */
export async function resolveProjectExtensions(options: ProjectExtensionOptions): Promise<{
  skills: SkillInfo[];
  mcpServers: McpServerConfig[];
  /** Added to this project and then switched off, so a default must not bring them back. */
  disabledSkillIds: string[];
}> {
  const manifest = await serialize(extensionRoot(options), () => readManifest(options));
  const disabledSkillIds = manifest.entries.filter(entry => entry.kind === 'skill' && !entry.enabled).map(entry => entry.id);
  if (!manifest.entries.some(entry => entry.enabled)) return { skills: [], mcpServers: [], disabledSkillIds };
  const { resolved } = await resolveEntries(options, manifest);
  const enabled = resolved.filter(({ entry }) => entry.enabled);
  const missing = enabled.find(({ available }) => !available);
  if (missing) throw new Error(`Project extension ${missing.entry.id} is unavailable; disable it or import it again`);
  return {
    skills: enabled.flatMap(({ skill }) => skill ? [skill] : []),
    mcpServers: enabled.flatMap(({ server }) => server ? [{ ...server, enabled: true }] : []),
    disabledSkillIds,
  };
}

async function installSkill(options: ProjectExtensionOptions, source: string, provenance = source): Promise<StoredExtension> {
  const root = registryRootsForDataDir(options.dataDir).userPluginsRoot;
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(path.join(root, 'package-'));
  try {
    const result = path.isAbsolute(source)
      ? await installSkillFromLocalSource(stage, source)
      : await installSkillFromRemoteSource(stage, source);
    if (!result.ok) throw new ProjectExtensionError(result.code === 'CONFLICT' ? 409 : 400, result.error);
    const skill = findSkillById(await listSkills(stage), result.id);
    if (!skill) throw new Error('Imported skill could not be read');
    return await registerExtension(options, {
      kind: 'skill', id: skill.id, name: skill.name, description: skill.description,
      enabled: true, source: provenance, version: await skillVersion(result.dir),
    }, stage, true);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function readMcpSource(source: string): Promise<McpServerConfig[]> {
  if (typeof source !== 'string' || !source.trim()) throw new ProjectExtensionError(400, 'MCP source is required');
  let text: string;
  if (path.isAbsolute(source)) {
    const stats = await lstat(source);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024 * 1024) throw new ProjectExtensionError(400, 'Select a JSON file smaller than 1 MiB');
    text = await readFile(source, 'utf8');
  } else {
    let url: URL;
    try { url = new URL(source); } catch { throw new ProjectExtensionError(400, 'Select a local JSON file or a public GitHub JSON URL'); }
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) throw new ProjectExtensionError(400, 'Use a public HTTPS GitHub JSON URL without credentials or query parameters');
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[2] !== 'blob' || parts.length < 5) throw new ProjectExtensionError(400, 'Use a GitHub JSON file URL');
      url = new URL(`https://raw.githubusercontent.com/${parts.slice(0, 2).concat(parts.slice(3)).join('/')}`);
    }
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.username || url.password || url.search || url.hash) {
      throw new ProjectExtensionError(400, 'Only public GitHub JSON URLs are supported');
    }
    const response = await safeExternalFetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body) throw new ProjectExtensionError(400, `MCP import failed (${response.status})`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) throw new ProjectExtensionError(400, 'MCP JSON exceeds 1 MiB');
      chunks.push(buffer);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProjectExtensionError(400, 'MCP source must contain valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProjectExtensionError(400, 'MCP JSON must be an object');
  const wrapper = parsed as Record<string, unknown>;
  if (wrapper.mcpServers && typeof wrapper.mcpServers === 'object' && !Array.isArray(wrapper.mcpServers)) {
    return Object.entries(wrapper.mcpServers).map(([id, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectExtensionError(400, 'Invalid MCP entry');
      const server = value as Record<string, unknown>;
      return validateMcpServer({ ...server, id, transport: server.transport ?? (server.url ? 'http' : 'stdio') });
    });
  }
  return [validateMcpServer(parsed)];
}

/** Enable an installed store package by reference; never copy its files into the project. */
export async function enableInstalledProjectExtension(options: ProjectExtensionOptions, kind: StoreItemKind, pluginId: string): Promise<void> {
  await serialize(extensionRoot(options), async () => {
    const plugin = getInstalledPlugin(extensionDatabase(options), pluginId);
    if (!plugin) throw new ProjectExtensionError(404, 'Installed plugin not found');
    const manifest = await readManifest(options);
    const entry = installedExtension(options, { kind, pluginId, version: plugin.version, enabled: true });
    const previous = manifest.entries.findIndex(item => item.kind === kind && item.pluginId === pluginId);
    if (previous >= 0) manifest.entries[previous] = entry;
    else {
      if (manifest.entries.length >= 200) throw new ProjectExtensionError(400, 'Project extension limit reached');
      manifest.entries.push(entry);
    }
    await writeManifest(options, manifest);
  });
}

export async function importProjectExtension(options: ProjectExtensionOptions, input: ImportProjectExtensionRequest): Promise<void> {
  await serialize(extensionRoot(options), async () => {
    if (!input || (input.kind !== 'skill' && input.kind !== 'mcp')) throw new ProjectExtensionError(400, 'Extension kind must be skill or mcp');
    const manifest = await readManifest(options);
    if (manifest.entries.length >= 200) throw new ProjectExtensionError(400, 'Project extension limit reached');
    let additions: StoredExtension[];
    if (input.catalogId) {
      if (input.kind === 'skill') {
        const skill = findSkillById(options.catalogSkills ?? await listSkills(options.skillsRoots), input.catalogId);
        if (!skill) throw new ProjectExtensionError(404, 'Catalog skill not found');
        additions = [await installSkill(options, skill.dir, `catalog:${skill.id}`)];
      } else {
        const server = (await readMcpConfig(options.dataDir)).servers.find(item => item.id === input.catalogId);
        if (!server) throw new ProjectExtensionError(404, 'Configured MCP server not found');
        const snapshot = validateMcpServer(server);
        additions = [{ kind: 'mcp', id: snapshot.id, name: snapshot.label ?? snapshot.id, description: snapshot.command ?? snapshot.url ?? '', enabled: true, source: `catalog:${snapshot.id}`, version: digest(JSON.stringify(snapshot)), server: snapshot }];
      }
    } else if (input.kind === 'skill') {
      if (typeof input.source !== 'string' || !input.source.trim()) throw new ProjectExtensionError(400, 'Skill source is required');
      additions = [await installSkill(options, input.source.trim())];
    } else {
      const servers = input.server ? [validateMcpServer(input.server)] : await readMcpSource(input.source ?? '');
      if (!servers.length || servers.length > 50) throw new ProjectExtensionError(400, 'Import between one and 50 MCP servers');
      additions = servers.map(server => ({ kind: 'mcp', id: server.id, name: server.label ?? server.id, description: server.command ?? server.url ?? '', enabled: true, source: input.source?.trim() || 'inline', version: digest(JSON.stringify(server)), server }));
    }
    const keys = new Set(manifest.entries.map(entry => `${entry.kind}:${entry.id}`));
    for (const entry of additions) {
      const key = `${entry.kind}:${entry.id}`;
      if (keys.has(key)) throw new ProjectExtensionError(409, `${entry.id} is already installed in this project`);
      keys.add(key);
    }
    if (keys.size > 200) throw new ProjectExtensionError(400, 'Project extension limit reached');
    for (const entry of additions) manifest.entries.push(entry.pluginId ? entry : await registerExtension(options, entry));
    await writeManifest(options, manifest);
  });
}

export async function changeProjectExtension(options: ProjectExtensionOptions, kind: ProjectExtensionKind, id: string, action: 'enable' | 'disable' | 'update' | 'remove'): Promise<void> {
  await serialize(extensionRoot(options), async () => {
    const manifest = await readManifest(options);
    const index = manifest.entries.findIndex(entry => entry.kind === kind && entry.id === id);
    const previous = manifest.entries[index];
    if (!previous) throw new ProjectExtensionError(404, 'Project extension not found');
    if (action === 'remove') manifest.entries.splice(index, 1);
    else if (action === 'enable' || action === 'disable') previous.enabled = action === 'enable';
    else if (action === 'update') {
      if (previous.source.startsWith('catalog:')) {
        if (kind === 'skill') {
          const current = findSkillById(options.catalogSkills ?? await listSkills(options.skillsRoots), id);
          if (!current) throw new ProjectExtensionError(404, 'Catalog skill is unavailable');
          const replacement = await installSkill(options, current.dir, previous.source);
          manifest.entries[index] = { ...replacement, enabled: previous.enabled };
        } else {
          const current = (await readMcpConfig(options.dataDir)).servers.find(server => server.id === id);
          if (!current) throw new ProjectExtensionError(404, 'Catalog MCP server is unavailable');
          const server = validateMcpServer(current);
          manifest.entries[index] = await registerExtension(options, { ...previous, server, version: digest(JSON.stringify(server)) });
        }
      } else if (kind === 'skill') {
        const replacement = await installSkill(options, previous.source);
        if (replacement.id !== previous.id) {
          throw new ProjectExtensionError(409, 'Updated skill changed identity; import it separately');
        }
        manifest.entries[index] = { ...replacement, enabled: previous.enabled };
      } else {
        if (previous.source === 'inline') throw new ProjectExtensionError(400, 'Import the edited MCP configuration as a new entry');
        const server = (await readMcpSource(previous.source)).find(item => item.id === previous.id);
        if (!server) throw new ProjectExtensionError(409, 'Updated MCP source no longer contains this server');
        manifest.entries[index] = await registerExtension(options, { ...previous, server, version: digest(JSON.stringify(server)) });
      }
    } else throw new ProjectExtensionError(400, 'Unsupported extension action');
    await writeManifest(options, manifest);
    // Keep immutable prior packages available to already-running tasks; removing
    // an entry unregisters it and never invalidates a task's captured skill path.
  });
}
