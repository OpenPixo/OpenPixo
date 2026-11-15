import type { Conversation } from '../../types';

/**
 * Folds a fresh server read of a project's conversations into the list a
 * project view already holds, after something else (the sidebar's right-click
 * menu, the CLI) renamed, forked or deleted one.
 *
 * The local order is kept, so nothing on screen jumps. A conversation the
 * server no longer has is dropped, a title the server changed is taken, and a
 * conversation the view has not seen yet is put first, where a new one goes.
 * Everything else stays as the view has it: run state and modes are kept up
 * to date by their own paths, and a read must not undo them.
 *
 * Returns the same array when nothing changed, so a caller can skip a render.
 */
export function mergeConversationList(local: readonly Conversation[], server: readonly Conversation[]): Conversation[] {
  const byId = new Map(server.map((conversation) => [conversation.id, conversation]));
  const known = new Set(local.map((conversation) => conversation.id));
  let changed = false;
  const kept: Conversation[] = [];
  for (const conversation of local) {
    const fresh = byId.get(conversation.id);
    if (!fresh) { changed = true; continue; }
    if (fresh.title !== conversation.title) {
      changed = true;
      kept.push({ ...conversation, title: fresh.title });
    } else {
      kept.push(conversation);
    }
  }
  const added = server.filter((conversation) => !known.has(conversation.id));
  if (added.length > 0) changed = true;
  return changed ? [...added, ...kept] : (local as Conversation[]);
}
