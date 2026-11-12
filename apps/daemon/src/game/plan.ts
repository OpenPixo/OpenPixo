import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  GAME_ENGINE_NAMES,
  GAME_PLAN_PROJECT_KINDS,
  GAME_PLAN_RECORD_MAX_CHARS,
  type GameEngineId,
  type GameEngineOption,
  type GamePlanPromptInput,
  type GamePlanState,
  type ProjectMetadata,
} from '@openpixo/contracts';
import { listGameTemplates } from './templates.js';

export function newGamePlan(now: number): GamePlanState {
  return { status: 'planning', startedAt: now };
}

/**
 * The plan as every build turn reads it: the agent's last message before the user
 * approved, without question forms or host markers. Recorded at approval because the
 * transcript a new session is seeded with can leave it out (another agent's turns cut
 * it, a long message is truncated). Undefined when nothing is left to record.
 */
export function approvedPlanText(content: string | null | undefined): string | undefined {
  if (typeof content !== 'string') return undefined;
  const text = content
    .replace(/<question-form\b[\s\S]*?<\/question-form>/giu, '')
    .replace(/<pixo-title>[\s\S]*?<\/pixo-title>/giu, '')
    .replace(/<pixo-[a-z-]+\b[^>]*\/>/giu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (!text) return undefined;
  return text.length > GAME_PLAN_RECORD_MAX_CHARS ? `${text.slice(0, GAME_PLAN_RECORD_MAX_CHARS).trimEnd()}\n[…]` : text;
}

/** Whether a project of this kind can be a game at all. */
export function gamePlanAppliesToKind(kind: unknown): boolean {
  return (GAME_PLAN_PROJECT_KINDS as readonly unknown[]).includes(kind);
}

// A folder with only these is still a new game: version control, editor state,
// the host's staged skills, and the notes people write before they start.
const NOT_WORK = /^(\.git|\.gitignore|\.gitattributes|\.pixo-skills|\.claude|\.codex|\.vscode|\.idea|\.DS_Store|Thumbs\.db|desktop\.ini|README(\..*)?|LICENSE(\..*)?)$/i;

// Art and sound alone are not a game yet: concept samples from planning, or the
// references someone gathered before starting, must not block a starter.
const MEDIA_FILE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|wav|mp3|ogg|m4a|flac|mp4|webm|mov)$/i;
const MAX_ENTRIES_CHECKED = 5000;

/**
 * True when the folder holds anything beyond what a new game folder may
 * contain: any file other than notes, tool state and media, at any depth. A
 * folder too large to walk cheaply is not a new one.
 */
export async function folderHoldsExistingWork(dir: string): Promise<boolean> {
  const pending = [dir];
  let checked = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (NOT_WORK.test(entry.name)) continue;
      if ((checked += 1) > MAX_ENTRIES_CHECKED) return true;
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      else if (!MEDIA_FILE.test(entry.name)) return true;
    }
  }
  return false;
}

/** Tools a starter engine needs, by logical id. A web engine needs one package manager. */
const STARTER_ENGINE_TOOLS: Partial<Record<GameEngineId, { anyOf: string[]; report: string }>> = {
  phaser: { anyOf: ['npm', 'pnpm'], report: 'npm' },
  threejs: { anyOf: ['npm', 'pnpm'], report: 'npm' },
  godot: { anyOf: ['godot'], report: 'godot' },
};

/** Engines OpenPixo can verify without shipping a starter; offered only when already installed. */
const INSTALLED_ONLY_ENGINES: ReadonlyArray<{ engine: GameEngineId; tool: string }> = [
  { engine: 'unity', tool: 'unity' },
  { engine: 'cocos-creator', tool: 'cocosCreator' },
  { engine: 'bevy', tool: 'cargo' },
];

/**
 * What the agent may honestly offer: every engine with a starter, marked by
 * whether this machine can run it, plus engines the host can verify when the
 * user already has them. The sample is a finished game, not a starting point.
 */
export async function gameEngineOptions(
  templatesRoot: string,
  resolveTool: (id: string) => string | null,
): Promise<GameEngineOption[]> {
  const templates = await listGameTemplates(templatesRoot);
  const options = new Map<GameEngineId, GameEngineOption>();
  for (const template of templates) {
    if (template.id === 'phaser3-sample-platformer') continue;
    const needs = STARTER_ENGINE_TOOLS[template.engine];
    const available = !needs || needs.anyOf.some(tool => resolveTool(tool));
    const option = options.get(template.engine) ?? {
      engine: template.engine,
      name: GAME_ENGINE_NAMES[template.engine] ?? template.engine,
      templates: [],
      available,
      missingTools: available || !needs ? [] : [needs.report],
    };
    option.templates.push({ id: template.id, name: template.name });
    options.set(template.engine, option);
  }
  for (const { engine, tool } of INSTALLED_ONLY_ENGINES) {
    if (!options.has(engine) && resolveTool(tool)) {
      options.set(engine, { engine, name: GAME_ENGINE_NAMES[engine] ?? engine, templates: [], available: true, missingTools: [] });
    }
  }
  return [...options.values()];
}

/** The plan facts one run's prompt needs; null when the project has no plan state. */
export async function gamePlanPromptInput(
  metadata: Pick<ProjectMetadata, 'gamePlan'> | null | undefined,
  deps: {
    engineOptions: () => Promise<GameEngineOption[]>;
    artStyles: () => ReadonlyArray<{ id: string; title: string }>;
    engineKnown: boolean;
  },
): Promise<GamePlanPromptInput | null> {
  const plan = metadata?.gamePlan;
  if (!plan) return null;
  const needsEngines = !deps.engineKnown;
  const engineOptions = needsEngines ? await deps.engineOptions().catch(() => []) : [];
  return {
    status: plan.status,
    ...(engineOptions.length ? { engineOptions } : {}),
    ...(plan.status === 'planning' ? { artStyles: deps.artStyles() } : {}),
    ...(plan.status === 'approved' && plan.approvedPlan ? { approvedPlan: plan.approvedPlan } : {}),
  };
}
