// Regression cover for #8173 — a bundled skill's own files were reported to the
// user as "The user rejected permission to use this specific tool call".
//
// The staged copy under `<cwd>/.pixo-skills/` is only the preferred path.
// `withSkillRootPreamble()` also hands the agent the skill's absolute root as a
// fallback, and `resolveChatExtraAllowedDirs` built the run-scoped allowlist
// from `SKILLS_DIR` — the repository's own `skills/` tree — only. A plugin-local
// `SKILL.md` is loaded from the bundled plugin folder instead, so every side
// file it advertises sat outside the allowlist. OpenCode saw an external
// directory, asked for approval, and a headless run turned that ask into a
// rejection.
//
// The local plugin fixture declares its own side files. The allowlist must
// follow that manifest for imported plugins as well as bundled ones.

import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstalledPluginRecord, PluginManifest } from '@openpixo/contracts';
import { loadPluginLocalSkill } from '../src/plugins/local-skill.js';
import { resolveChatExtraAllowedDirs } from '../src/runtimes/chat-prompt-inputs.js';
import { buildOpenCodeMcpConfigContent } from '../src/mcp-config.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PLUGIN_DIR = mkdtempSync(path.join(tmpdir(), 'pixo-local-skill-allowlist-'));
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const PROJECT_CWD = path.join(REPO_ROOT, '.tmp/pixo-external-directory-fixture');

const manifest: PluginManifest = {
  name: 'local-skill-fixture',
  title: 'Local skill fixture',
  version: '1.0.0',
  pixo: {
    kind: 'skill',
    capabilities: ['prompt:inject'],
    context: {
      skills: [{ path: './SKILL.md' }],
      assets: ['./assets/template.html', './assets/example.html', './references/layout.md', './scripts/helper.ts'],
    },
  },
};
writeFileSync(path.join(PLUGIN_DIR, 'pixo.json'), JSON.stringify(manifest));
writeFileSync(path.join(PLUGIN_DIR, 'SKILL.md'), '---\nname: local-skill-fixture\ndescription: A local plugin fixture.\n---\nRead the declared side files.\n');
for (const relative of manifest.pixo!.context!.assets!) {
  const file = path.join(PLUGIN_DIR, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'fixture');
}
afterAll(() => rmSync(PLUGIN_DIR, { recursive: true, force: true }));

function fixturePluginRecord(): InstalledPluginRecord {
  return {
    id: 'local-skill-fixture',
    title: manifest.title!,
    version: manifest.version ?? '0.0.0',
    sourceKind: 'local',
    source: PLUGIN_DIR,
    sourceMarketplaceId: undefined,
    pinnedRef: undefined,
    sourceDigest: undefined,
    trust: 'trusted',
    capabilitiesGranted: ['prompt:inject'],
    fsPath: PLUGIN_DIR,
    installedAt: 0,
    updatedAt: 0,
    manifest,
  };
}

// The manifest's `pixo.context.assets` is the skill package's own statement about
// which files the agent will be sent to open. Reconciling the allowlist against
// that list — rather than against paths this test picks — is what keeps the
// assertion honest if the plugin's layout changes.
function declaredAssetPaths(record: InstalledPluginRecord): string[] {
  const assets = record.manifest.pixo?.context?.assets ?? [];
  return assets.map((asset) => path.join(record.fsPath, asset));
}

/** Mirrors how OpenCode reads `permission.external_directory` for one file. */
function allowsRead(
  externalDirectory: Record<string, string>,
  filePath: string,
): boolean {
  let dir = path.dirname(filePath);
  for (;;) {
    if (
      externalDirectory[dir] === 'allow' ||
      externalDirectory[`${dir}/*`] === 'allow' ||
      externalDirectory[`${dir}/**`] === 'allow'
    ) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function externalDirectoryFor(allowedDirectories: string[]): Record<string, string> {
  const content = buildOpenCodeMcpConfigContent([], {}, { allowedDirectories });
  const parsed = JSON.parse(content ?? '{}') as {
    permission?: { external_directory?: Record<string, string> };
  };
  return parsed.permission?.external_directory ?? {};
}

describe('run-scoped external_directory allowlist — skill roots', () => {
  it('has the local skill assets its manifest declares', () => {
    const declared = declaredAssetPaths(fixturePluginRecord());

    expect(declared).toHaveLength(4);
    expect(declared.filter((asset) => existsSync(asset))).toHaveLength(
      declared.length,
    );
  });

  it('allows every side file a plugin-local skill advertises', async () => {
    const record = fixturePluginRecord();
    const localSkill = await loadPluginLocalSkill(record);
    expect(localSkill?.dir).toBe(PLUGIN_DIR);

    const extraAllowedDirs = resolveChatExtraAllowedDirs({
      agentId: 'opencode',
      skillsDir: SKILLS_DIR,
      linkedDirs: [],
      activeSkillDirs: [localSkill!.dir],
    });
    const externalDirectory = externalDirectoryFor([
      PROJECT_CWD,
      ...extraAllowedDirs,
    ]);

    const declared = declaredAssetPaths(record);
    const allowed = declared.filter((asset) => allowsRead(externalDirectory, asset));
    expect(allowed).toEqual(declared);

    // The absolute fallback the preamble prints is the skill root itself.
    expect(
      allowsRead(externalDirectory, path.join(localSkill!.dir, 'SKILL.md')),
    ).toBe(true);
  });

  it('still hands Codex no read-only resource directory', () => {
    expect(
      resolveChatExtraAllowedDirs({
        agentId: 'codex',
        skillsDir: SKILLS_DIR,
        linkedDirs: [],
        activeSkillDirs: [PLUGIN_DIR],
        existsSync: () => true,
      }),
    ).toEqual([]);
  });
});
