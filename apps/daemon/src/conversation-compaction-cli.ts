import {
  CONVERSATION_COMPACT_COMMAND,
  PRODUCT_CLI_NAME,
  renderCompactedConversationSummary,
  splitAtCompaction,
  type CompactableMessage,
} from '@openpixo/contracts';

/**
 * `pixo conversation compact`: the CLI half of `/compact`. It sends the same
 * `POST /api/runs` turn the chat sends (`purpose: 'compact'`, the transcript
 * from the latest summary on, ending with `/compact`), waits for it, and prints
 * the summary the daemon recorded.
 */

export const CONVERSATION_COMPACT_USAGE = `${PRODUCT_CLI_NAME} conversation compact <conversationId> --project <id> [--model <id>] [--json]`;

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);
const POLL_MS = 1000;
const WAIT_MS = 30 * 60 * 1000;

interface ListedMessage extends CompactableMessage { id: string; runStatus?: string }

export interface ConversationCompactResult {
  runId: string;
  status: string;
  assistantMessageId: string | null;
  compacted: boolean;
  summary: string | null;
}

/** The transcript a compaction turn is sent: what the chat would render, plainly. */
export function compactionTranscript(messages: readonly ListedMessage[]): string {
  const { summary, after } = splitAtCompaction(messages);
  const sections: string[] = [];
  if (summary !== null) sections.push(renderCompactedConversationSummary(summary));
  for (const message of after) {
    if ((message.role === 'user' || message.role === 'assistant') && message.content.trim()) {
      sections.push(`## ${message.role}\n${message.content.trim()}`);
    }
  }
  sections.push(`## user\n${CONVERSATION_COMPACT_COMMAND}`);
  return sections.join('\n\n');
}

async function json<T>(response: Response, what: string): Promise<T> {
  const body = await response.json().catch(() => null) as T & { error?: { message?: string } | string } | null;
  if (!response.ok) {
    const error = body?.error;
    const message = typeof error === 'string' ? error : error?.message;
    throw new Error(`${what} failed (${response.status})${message ? `: ${message}` : ''}`);
  }
  return body as T;
}

export async function compactConversation(input: {
  base: string;
  projectId: string;
  conversationId: string;
  model?: string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ConversationCompactResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const messagesUrl = `${input.base}/api/projects/${encodeURIComponent(input.projectId)}/conversations/${encodeURIComponent(input.conversationId)}/messages`;
  const listed = await json<{ messages: ListedMessage[] }>(await fetchImpl(messagesUrl), 'Reading the conversation');
  const created = await json<{ runId: string; assistantMessageId?: string | null }>(await fetchImpl(`${input.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      conversationId: input.conversationId,
      message: compactionTranscript(listed.messages),
      currentPrompt: CONVERSATION_COMPACT_COMMAND,
      purpose: 'compact',
      ...(input.model ? { model: input.model } : {}),
    }),
  }), 'Starting the compaction');
  const started = Date.now();
  let status = '';
  while (!TERMINAL.has(status)) {
    if (Date.now() - started > WAIT_MS) throw new Error(`Run ${created.runId} is still running; check it with ${PRODUCT_CLI_NAME} run status`);
    await sleep(POLL_MS);
    status = (await json<{ status: string }>(await fetchImpl(`${input.base}/api/runs/${encodeURIComponent(created.runId)}`), 'Reading the run')).status;
  }
  const assistantMessageId = created.assistantMessageId ?? null;
  const after = await json<{ messages: ListedMessage[] }>(await fetchImpl(messagesUrl), 'Reading the summary');
  const reply = assistantMessageId ? after.messages.find((message) => message.id === assistantMessageId) : undefined;
  const compacted = reply?.compaction === true;
  return { runId: created.runId, status, assistantMessageId, compacted, summary: compacted ? reply!.content : null };
}
