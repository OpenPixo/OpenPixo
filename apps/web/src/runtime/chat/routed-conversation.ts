import type { Conversation } from '../../types';

export interface RoutedConversationInput {
  /** The conversation the URL names now. The sidebar highlights this one. */
  routeId: string | null;
  /** The value `routeId` had the last time this was asked. */
  previousRouteId: string | null;
  /** The conversation the chat pane shows now. */
  activeId: string | null;
  /** The conversation this view itself last wrote into the URL. */
  lastPushedId: string | null;
}

/**
 * Whether the chat pane must move to the conversation the URL names.
 *
 * Invariant: the pane and the URL name the same conversation. They can only
 * differ for one of two reasons, and each has one owner:
 *
 * - The URL is behind a switch this view made (new conversation, history pick,
 *   delete). The view's own URL sync closes that gap, so following the old
 *   value here would fight it and remount ChatPane in a loop.
 * - Somebody else moved the URL: the sidebar, back/forward, a routine link. The
 *   pane always follows, whether or not its loaded list has heard of the
 *   conversation yet. The list is a cache, and the sidebar creates conversations
 *   without telling it.
 *
 * Only a change of the route is an event. A route that has not moved carries no
 * new intent, however often the rest of the view re-renders.
 */
export function routedConversationVerdict({
  routeId,
  previousRouteId,
  activeId,
  lastPushedId,
}: RoutedConversationInput): 'follow' | 'stay' {
  if (!routeId || routeId === previousRouteId) return 'stay';
  // Nothing is showing yet: the first pick is still owed, and it reads the route.
  if (!activeId) return 'stay';
  if (routeId === activeId || routeId === lastPushedId) return 'stay';
  return 'follow';
}

/** True when the URL names nothing, or names a conversation in this list. */
export function listNamesConversation(
  list: readonly Pick<Conversation, 'id'>[],
  routeId: string | null,
): boolean {
  return !routeId || list.some((conversation) => conversation.id === routeId);
}
