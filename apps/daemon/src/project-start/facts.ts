import type Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameVerifyResult, ProjectMetadata } from '@openpixo/contracts';
import { readAppConfigSync } from '../app-config.js';
import { checkEnvironment } from '../doctor/checks.js';
import { createDoctorProbes } from '../doctor/probes.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { gameVerifyArtifactDir } from '../game/verify-store.js';
import { resolveProjectDir } from '../projects.js';
import type { PathDeps } from '../server-context.js';
import type { ProjectStarterFacts } from './next-steps.js';

export interface ProjectStarterFactDependencies {
  db: Database.Database;
  paths: Pick<PathDeps, 'RUNTIME_DATA_DIR' | 'ARTIFACTS_DIR' | 'PROJECTS_DIR' | 'PROJECT_ROOT'>;
  /** Production shares the existing asset service so the first read also indexes the project. */
  mediaAssetCount?: (projectId: string, metadata?: ProjectMetadata) => Promise<number>;
}

/** Reads the same verification pointer as the game toolbar, under the resolved artifact root. */
async function latestVerification(artifactsRoot: string, projectId: string): Promise<GameVerifyResult | null> {
  try {
    return JSON.parse(await readFile(path.join(gameVerifyArtifactDir(artifactsRoot, projectId), 'latest.json'), 'utf8')) as GameVerifyResult;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Existing durable assistant-message run statuses are the daemon's completed-agent history. */
export async function readProjectStarterFacts(deps: ProjectStarterFactDependencies, projectId: string, metadata?: ProjectMetadata): Promise<ProjectStarterFacts> {
  const config = readAppConfigSync(deps.paths.RUNTIME_DATA_DIR);
  const profile = detectEngineProfile(resolveProjectDir(deps.paths.PROJECTS_DIR, projectId, metadata), { enginePaths: config.gameEnginePaths ?? {} });
  const succeeded = deps.db.prepare(`SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.project_id = ? AND m.role = 'assistant' AND m.run_status = 'succeeded' LIMIT 1`).get(projectId);
  // Match the Assets panel's default media inventory; source/config files do not finish this step.
  const assets = deps.db.prepare(`SELECT count(*) AS count FROM project_assets WHERE project_id = ? AND
    (kind IN ('image', 'audio', 'video', 'model3d', 'font') OR
      (kind = 'data' AND (lower(rel_path) GLOB '*.atlas' OR lower(rel_path) GLOB '*.tmx' OR lower(rel_path) GLOB '*.ldtk')))`).get(projectId) as { count: number };
  const [doctor, latestVerify, mediaAssetCount] = await Promise.all([
    checkEnvironment(createDoctorProbes(deps.paths.RUNTIME_DATA_DIR, deps.paths.PROJECT_ROOT)),
    latestVerification(deps.paths.ARTIFACTS_DIR, projectId),
    deps.mediaAssetCount?.(projectId, metadata) ?? Promise.resolve(assets.count),
  ]);
  return { profile, doctor, hasSucceededAgentRun: Boolean(succeeded), mediaAssetCount, latestVerify };
}
