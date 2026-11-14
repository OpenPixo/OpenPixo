import { navigate } from '../../router';

/**
 * What an entry point inside a game hands to the 生成 page when it opens it: the game,
 * pictures to use as references ("以此生成"), or a preset to open. Read once, then cleared.
 */
export interface GenerateHandoff { projectId: string; references?: string[] | undefined; recipeId?: string | undefined }

const KEY = 'openpixo:generate-handoff';

export function queueGenerateHandoff(handoff: GenerateHandoff) {
  try { sessionStorage.setItem(KEY, JSON.stringify(handoff)); } catch { /* Storage may be unavailable. */ }
}
/** The handoff for this game, if one is waiting; any other is left alone. */
export function takeGenerateHandoff(projectId: string): GenerateHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as GenerateHandoff;
    if (value?.projectId !== projectId) return null;
    sessionStorage.removeItem(KEY);
    return { projectId, ...(Array.isArray(value.references) ? { references: value.references.filter(entry => typeof entry === 'string') } : {}),
      ...(typeof value.recipeId === 'string' ? { recipeId: value.recipeId } : {}) };
  } catch { return null; }
}

/** 生成素材… and "以此生成" inside a game: the 生成 page, with this game picked and the pictures handed over. */
export function openGenerateForGame(projectId: string, referencePaths?: readonly string[]) {
  queueGenerateHandoff({ projectId, ...(referencePaths?.length ? { references: [...referencePaths] } : {}) });
  navigate({ kind: 'home', view: 'generate', generateProjectId: projectId });
}
