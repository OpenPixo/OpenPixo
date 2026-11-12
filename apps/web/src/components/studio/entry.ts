const key = (projectId: string) => `openpixo:studio-entry:${projectId}`;

export function queueStudioRecipe(projectId: string, recipeId: string) {
  try { sessionStorage.setItem(key(projectId), recipeId); } catch { /* Storage may be unavailable. */ }
}
export function pendingStudioRecipe(projectId: string): string | null {
  try { return sessionStorage.getItem(key(projectId)); } catch { return null; }
}
export function clearStudioEntry(projectId: string) {
  try { sessionStorage.removeItem(key(projectId)); } catch { /* Storage may be unavailable. */ }
}
