// Plugin doctor. Surfaces pre-apply lint diagnostics:
//
//   - Validates the manifest using @openpixo/plugin-runtime's validateSafe.
//   - Cross-checks atom ids against the FIRST_PARTY_ATOMS catalog (warns on
//     planned atoms, errors on unknown atoms).
//   - Re-resolves context against the live registry and reports any refs that
//     the registry could not bind (skills/atoms).
//   - Compares the registry-cached manifestSourceDigest against a freshly
//     computed digest and flips snapshots to `stale` when the upstream plugin
//     changed under their feet.
//
// Phase 1 returns a flat list of issues rather than a JSON-structured report;
// the CLI renders them as `pixo plugin doctor <id>` output. Spec §11.5 promises
// a richer report (severity / kind enum) which we'll layer in once Phase 4
// adds the diagnostics endpoint.

import { manifestSourceDigest, resolveContext, validateSafe, type RegistryView } from '@openpixo/plugin-runtime';
import type { InstalledPluginRecord, PluginManifest } from '@openpixo/contracts';
import type Database from 'better-sqlite3';
import { findAtom, isImplementedAtom, isKnownAtom } from './atoms.js';
import { isParseableUntil } from './until.js';
import { listSnapshotsForProject, markSnapshotStale } from './snapshots.js';

type SqliteDb = Database.Database;

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  field?: string;
}

export interface DoctorReport {
  pluginId: string;
  ok: boolean;
  issues: Diagnostic[];
  freshDigest: string;
}

export function doctorPlugin(
  plugin: InstalledPluginRecord,
  registry: RegistryView,
  options?: {
    warnOnMissingRefs?: boolean;
  },
): DoctorReport {
  const issues: Diagnostic[] = [];
  const manifest = plugin.manifest;

  const validation = validateSafe(manifest);
  for (const err of validation.errors) {
    issues.push({ severity: 'error', code: 'manifest.invalid', message: err });
  }
  for (const warn of validation.warnings) {
    issues.push({ severity: 'warning', code: 'manifest.warning', message: warn });
  }

  for (const atomId of manifest.pixo?.context?.atoms ?? []) {
    if (!isKnownAtom(atomId)) {
      issues.push({
        severity: 'error',
        code: 'atom.unknown',
        message: `Unknown atom id: '${atomId}'.`,
        field: 'pixo.context.atoms',
      });
    } else if (!isImplementedAtom(atomId)) {
      const atom = findAtom(atomId);
      issues.push({
        severity: 'warning',
        code: 'atom.planned',
        message: `Atom '${atomId}'${atom ? ` (${atom.label})` : ''} is planned but not yet implemented; runs will skip this atom.`,
        field: 'pixo.context.atoms',
      });
    }
  }

  for (const stage of manifest.pixo?.pipeline?.stages ?? []) {
    for (const atomId of stage.atoms ?? []) {
      if (!isKnownAtom(atomId)) {
        issues.push({
          severity: 'error',
          code: 'atom.unknown',
          message: `Pipeline stage '${stage.id}' references unknown atom '${atomId}'.`,
          field: `pixo.pipeline.stages.${stage.id}`,
        });
      }
    }
    if (stage.repeat === true && !stage.until) {
      issues.push({
        severity: 'error',
        code: 'pipeline.until-missing',
        message: `Pipeline stage '${stage.id}' sets repeat:true but no until expression.`,
        field: `pixo.pipeline.stages.${stage.id}`,
      });
    }
    if (stage.until && !isParseableUntil(stage.until)) {
      issues.push({
        severity: 'error',
        code: 'pipeline.until-invalid',
        message: `Pipeline stage '${stage.id}' has an unparseable until expression: '${stage.until}'.`,
        field: `pixo.pipeline.stages.${stage.id}`,
      });
    }
  }

  const resolved = resolveContext(manifest, {
    registry,
    warnOnMissing: options?.warnOnMissingRefs ?? true,
  });
  for (const warn of resolved.warnings) {
    issues.push({ severity: 'warning', code: 'context.unresolved', message: warn });
  }

  const freshDigest = manifestSourceDigest({
    manifest,
    inputs: {},
    resolvedContextRefs: resolved.digestRefs,
  });
  if (plugin.sourceDigest && plugin.sourceDigest !== freshDigest) {
    issues.push({
      severity: 'warning',
      code: 'digest.drift',
      message: `Cached source digest '${plugin.sourceDigest.slice(0, 12)}…' differs from fresh '${freshDigest.slice(0, 12)}…'. Existing snapshots may be marked stale.`,
    });
  }

  const ok = issues.every((d) => d.severity !== 'error');
  return { pluginId: plugin.id, ok, issues, freshDigest };
}

// Walk every snapshot for a project and flip those whose digest no longer
// matches the live plugin's freshly computed digest. Called by `pixo plugin
// doctor --project <id>` and the apply path when a plugin upgrade is
// detected. Returns the list of snapshot ids that were re-tagged.
export function markStaleSnapshotsForProject(
  db: SqliteDb,
  projectId: string,
  resolveDigest: (snapshot: { pluginId: string; manifestSourceDigest: string }) => string | null,
): string[] {
  const updated: string[] = [];
  const snapshots = listSnapshotsForProject(db, projectId);
  for (const snap of snapshots) {
    if (snap.status !== 'fresh') continue;
    const fresh = resolveDigest({ pluginId: snap.pluginId, manifestSourceDigest: snap.manifestSourceDigest });
    if (fresh && fresh !== snap.manifestSourceDigest) {
      markSnapshotStale(db, snap.snapshotId);
      updated.push(snap.snapshotId);
    }
  }
  return updated;
}

export function summarizeDoctor(report: DoctorReport): string {
  const errs = report.issues.filter((d) => d.severity === 'error');
  const warns = report.issues.filter((d) => d.severity === 'warning');
  if (errs.length === 0 && warns.length === 0) {
    return `Plugin '${report.pluginId}' is OK (digest ${report.freshDigest.slice(0, 12)}…).`;
  }
  const parts: string[] = [];
  parts.push(`Plugin '${report.pluginId}': ${errs.length} error(s), ${warns.length} warning(s).`);
  for (const issue of report.issues) {
    parts.push(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
  }
  return parts.join('\n');
}

export function buildRegistryViewFromManifest(_manifest: PluginManifest, fallback: RegistryView): RegistryView {
  // Phase 1 stub — returns the fallback unchanged. Phase 2A will overlay
  // bundled-plugin-specific catalogs when the plugin ships its own skills /
  // design systems within `<plugin>/skills/` etc.
  return fallback;
}
