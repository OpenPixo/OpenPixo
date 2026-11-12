import type { ChatMessage } from '../types';

/**
 * Messages whose save the daemon has not answered yet, kept where a reload
 * cannot reach them.
 *
 * A save in flight can die with its page, and keepalive only narrows that: it
 * refuses bodies over 64 KiB, and a request it does carry can still land after
 * the next page has read its transcript. So a durable save writes the message
 * here before its PUT and removes it once the daemon has answered for good. The
 * next transcript load replays whatever is left and shows it in the meantime
 * (`loadConversationTranscript`).
 */
export interface PendingMessageSave {
  projectId: string;
  conversationId: string;
  message: ChatMessage;
}

const KEY_PREFIX = 'openpixo:pending-message-save:';

/**
 * localStorage first, so a record normally outlives the tab. A long prompt can
 * overflow it while the composer's draft of the same text is still stored there;
 * sessionStorage has its own quota and still survives a reload.
 */
function recordStores(): Storage[] {
  const stores: Storage[] = [];
  for (const open of [() => localStorage, () => sessionStorage]) {
    try {
      stores.push(open());
    } catch {
      // Blocked or absent.
    }
  }
  return stores;
}

export function rememberPendingMessageSave(save: PendingMessageSave): void {
  const record = JSON.stringify(save);
  for (const store of recordStores()) {
    try {
      store.setItem(KEY_PREFIX + save.message.id, record);
      return;
    } catch {
      // Full. With no store left, the PUT is the message's only chance.
    }
  }
}

export function forgetPendingMessageSave(messageId: string): void {
  for (const store of recordStores()) {
    try {
      store.removeItem(KEY_PREFIX + messageId);
    } catch {
      // Storage may be unavailable.
    }
  }
}

function parsePendingMessageSave(raw: string | null): PendingMessageSave | null {
  try {
    const save = JSON.parse(raw ?? 'null') as Partial<PendingMessageSave> | null;
    return typeof save?.projectId === 'string'
      && typeof save.conversationId === 'string'
      && typeof save.message?.id === 'string'
      ? (save as PendingMessageSave)
      : null;
  } catch {
    return null;
  }
}

export function readPendingMessageSaves(): PendingMessageSave[] {
  // By id: a replay can write to a store that has room again while an older
  // copy of the same record still sits in the other one.
  const saves = new Map<string, PendingMessageSave>();
  for (const store of recordStores()) {
    try {
      for (const key of Object.keys(store)) {
        if (!key.startsWith(KEY_PREFIX)) continue;
        const save = parsePendingMessageSave(store.getItem(key));
        if (save) saves.set(save.message.id, save);
      }
    } catch {
      // Storage may be unavailable.
    }
  }
  return [...saves.values()];
}

/**
 * The stored rows plus the pending messages they lack, oldest first. A stored
 * row always wins: a create-only claim may have kept an earlier writer's text.
 */
export function withPendingMessages(stored: ChatMessage[], pending: ChatMessage[]): ChatMessage[] {
  const storedIds = new Set(stored.map((message) => message.id));
  const missing = pending.filter((message) => !storedIds.has(message.id));
  if (missing.length === 0) return stored;
  return [...stored, ...missing.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))];
}
