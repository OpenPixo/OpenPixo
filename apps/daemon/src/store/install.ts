import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { MarketplacePluginEntry, PluginManifest } from '@openpixo/contracts';
import { resolvePluginFolder } from '../plugins/registry.js';
import { MCP_TEMPLATES } from '../mcp-config.js';
import { installFromLocalFolder, installPlugin, safeCopyTree, type InstallEvent, type InstallOptions } from '../plugins/installer.js';

/** Only the bundled snapshot needs adapters; published packages use the installer directly. */
export async function* installStoreItem(
  db: Database.Database, entry: MarketplacePluginEntry, options: InstallOptions, dataDir: string, bundled: boolean,
): AsyncGenerator<InstallEvent> {
  const preset = bundled && entry.kind === 'mcp'
    ? MCP_TEMPLATES.find(template => template.id === entry.mcpTemplateId) : undefined;
  const template = bundled && entry.kind === 'project-template' && path.isAbsolute(options.source);
  const skill = bundled && entry.kind === 'skill' && path.isAbsolute(options.source);
  if (!preset && !template && !skill) { yield* installPlugin(db, options); return; }
  const root = path.join(dataDir, '.tmp', 'store');
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(path.join(root, 'package-'));
  try {
    if (template || skill) await safeCopyTree(options.source, stage, 50 * 1024 * 1024);
    const resolved = skill ? await resolvePluginFolder({ folder: stage, folderId: entry.name.split('/').at(-1)! }) : undefined;
    if (resolved && !resolved.ok) throw new Error(resolved.errors.join('; '));
    const manifest: PluginManifest = resolved?.ok ? { ...resolved.record.manifest, version: entry.version,
      license: resolved.record.manifest.license ?? entry.license } : {
      name: skill ? entry.name.split('/').at(-1)! : entry.name.replaceAll('/', '-'), version: entry.version, title: entry.title,
      description: entry.description, license: entry.license, title_i18n: entry.title_i18n, description_i18n: entry.description_i18n, examples: entry.examples,
      pixo: { kind: skill ? 'skill' : 'bundle', ...(preset ? { context: { mcp: [{
        name: preset.id, templateId: preset.id, transport: preset.transport,
        command: preset.command, args: preset.args, url: preset.url,
      }] } } : {}) },
    };
    await writeFile(path.join(stage, 'pixo.json'), JSON.stringify(manifest), { mode: 0o600 });
    yield* installFromLocalFolder(db, { ...options, _stagedFolder: stage, _stagedSourceKind: 'marketplace' });
  } finally { await rm(stage, { recursive: true, force: true }); }
}
