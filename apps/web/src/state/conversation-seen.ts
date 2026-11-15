import type { Conversation } from '../types';

/**
 * When the user last had each conversation open, so the sidebar can mark a
 * reply that finished while they were elsewhere. Kept per viewer in browser
 * storage: a lost record only hides a dot, it never invents one.
 */
const KEY = 'openpixo:conversation-seen';
const LIMIT = 500;
export const CONVERSATION_SEEN_EVENT = 'openpixo:conversation-seen';

function read(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

export function conversationSeenTimes(): Readonly<Record<string, number>> {
  return read();
}

export function markConversationSeen(conversationId: string, at = Date.now()): void {
  const seen = read();
  if ((seen[conversationId] ?? 0) >= at) return;
  seen[conversationId] = at;
  const entries = Object.entries(seen);
  const kept = entries.length > LIMIT
    ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, LIMIT))
    : seen;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(CONVERSATION_SEEN_EVENT, { detail: { conversationId } }));
}

/**
 * Whether "Mark as unread" has anything to mark: the latest reply has
 * finished and it is not already showing as new.
 */
export function canMarkConversationUnread(conversation: Conversation, seen: Readonly<Record<string, number>>): boolean {
  const run = conversation.latestRun;
  if (!run || run.status === 'running' || run.status === 'queued' || typeof run.endedAt !== 'number') return false;
  return !conversationHasNewReply(conversation, seen);
}

/**
 * Puts the "new reply" dot back on a conversation, the way a mail client's
 * "Mark as unread" does: the record moves to just before the latest reply
 * ended, so opening the conversation again clears it as usual.
 */
export function markConversationUnread(conversation: Conversation): boolean {
  const ended = conversation.latestRun?.endedAt;
  if (typeof ended !== 'number') return false;
  const seen = read();
  seen[conversation.id] = ended - 1;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(CONVERSATION_SEEN_EVENT, { detail: { conversationId: conversation.id } }));
  return true;
}

/**
 * A reply finished after the user last had the conversation open. A
 * conversation never opened in this browser has no record and gets no dot:
 * otherwise every older conversation would light up at once.
 */
export function conversationHasNewReply(conversation: Conversation, seen: Readonly<Record<string, number>>): boolean {
  const run = conversation.latestRun;
  if (!run || run.status === 'running' || run.status === 'queued' || typeof run.endedAt !== 'number') return false;
  const last = seen[conversation.id];
  return typeof last === 'number' && run.endedAt > last;
}
