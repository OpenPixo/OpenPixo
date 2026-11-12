/** A project fact changed through an existing game action; no checklist polling is needed. */
export const STARTER_FACTS_CHANGED_EVENT = 'project-starter-facts-changed';

export function notifyStarterFactsChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(STARTER_FACTS_CHANGED_EVENT, { detail: { projectId } }));
}
