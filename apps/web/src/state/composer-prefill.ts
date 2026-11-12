const drafts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const storageKey = (projectId: string) => `openpixo:composer-prefill:${projectId}`;
let nonce = Date.now();

export function queueProjectComposerPrefill(projectId: string, prompt: string): void {
  drafts.set(projectId, prompt);
  try { sessionStorage.setItem(storageKey(projectId), prompt); } catch { /* Keep the in-memory handoff when storage is unavailable. */ }
  for (const listener of listeners.get(projectId) ?? []) listener();
}

/** Lets an open project take a draft queued from inside it, not only one waiting when it opened. */
export function subscribeProjectComposerPrefill(projectId: string, listener: () => void): () => void {
  const set = listeners.get(projectId) ?? new Set<() => void>();
  listeners.set(projectId, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(projectId);
  };
}

export function clearProjectComposerPrefill(projectId: string): void {
  drafts.delete(projectId);
  try { sessionStorage.removeItem(storageKey(projectId)); } catch { /* Storage may be unavailable. */ }
}

export function takeProjectComposerPrefill(projectId: string): { text: string; nonce: number } | undefined {
  let prompt = drafts.get(projectId);
  if (prompt === undefined) {
    try { prompt = sessionStorage.getItem(storageKey(projectId)) ?? undefined; } catch { /* Storage may be unavailable. */ }
  }
  clearProjectComposerPrefill(projectId);
  return prompt === undefined ? undefined : { text: prompt, nonce: ++nonce };
}
