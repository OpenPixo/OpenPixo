/**
 * `/compact`: the user shortens a long conversation.
 *
 * One turn asks the agent for a handoff summary. When that turn succeeds the
 * daemon records its reply as the conversation's summary and stops resuming the
 * runtime session that wrote it, so the next turn opens a fresh session that is
 * sent the summary and the messages after it instead of everything.
 *
 * The summary turn itself resumes the session it summarizes when it can: the
 * request rides the per-turn user body, so the cached prompt and tool list stay
 * the same and the long history is read from the provider's cache.
 */

/** What a run is for, when it is not an ordinary turn. */
export const CHAT_RUN_PURPOSES = ['compact'] as const;
export type ChatRunPurpose = (typeof CHAT_RUN_PURPOSES)[number];

export function isChatRunPurpose(value: unknown): value is ChatRunPurpose {
  return typeof value === 'string' && (CHAT_RUN_PURPOSES as readonly string[]).includes(value);
}

/** What the user's turn says in the conversation; the agent is sent the request below. */
export const CONVERSATION_COMPACT_COMMAND = '/compact';

/** The per-turn request the daemon sends in place of `/compact`. */
export function renderConversationCompactionRequest(): string {
  return [
    '## compaction request',
    'The user asked to compact this conversation. Write a handoff summary that replaces everything before it: later turns are sent only this summary and the messages after it, so put in everything needed to carry on.',
    'Do not use tools, read or change files, generate media or ask questions in this turn. Reply with the summary only, in the user\'s language, as plain Markdown with no <question-form>, in these sections:',
    '- Goal: what is being made, and the user\'s own words for it.',
    '- Where it stands: the current plan step or build stage with its label, and what works now.',
    '- Decisions: gameplay, art style and reference image paths, engine, and anything the user confirmed or turned down.',
    '- Files: the files and folders that matter, one line each.',
    '- Open: bugs, unfinished work, the user\'s latest request and what was about to happen next.',
    'Keep exact names, paths, numbers and labels. Stay under about 400 words.',
  ].join('\n');
}

/** How a summary opens the transcript of the turns after it. */
export function renderCompactedConversationSummary(summary: string): string {
  return [
    '## conversation summary',
    'The user compacted the conversation here. This summary, written at that point, replaces the messages before it; check the project files before relying on anything it says was done.',
    '',
    summary.trim(),
  ].join('\n');
}

export interface CompactableMessage {
  role: string;
  content: string;
  compaction?: true | undefined;
}

/**
 * The conversation as a transcript sees it: the latest summary, if any, and the
 * messages after it. Every client that renders a transcript for the agent cuts
 * here, so they agree on what a compacted conversation sends.
 */
export function splitAtCompaction<T extends CompactableMessage>(messages: readonly T[]): { summary: string | null; after: T[] } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && message.compaction === true && message.content.trim()) {
      return { summary: message.content, after: messages.slice(index + 1) };
    }
  }
  return { summary: null, after: [...messages] };
}
