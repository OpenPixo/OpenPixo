// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConversationTranscript } from '../../src/state/load-conversation-transcript';
import { saveMessage } from '../../src/state/projects';
import type { ChatMessage } from '../../src/types';

const KEEPALIVE_BODY_LIMIT_BYTES = 64 * 1024;

function userMessage(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'user-1', role: 'user', content, createdAt: 1_000, ...overrides };
}

type PutHandler = (init: RequestInit) => Promise<Response>;

const saved = () => Promise.resolve(Response.json({ message: { id: 'stored' } }));
const neverAnswers = () => new Promise<Response>(() => {});

/** Answers each transcript GET with `stored` and each message PUT through `onPut`. */
function stubDaemon(onPut: PutHandler = saved, stored: ChatMessage[] = []) {
  const fetchMock = vi.fn<typeof fetch>((_url, init) =>
    init?.method === 'PUT' ? onPut(init) : Promise.resolve(Response.json({ messages: stored })));
  vi.stubGlobal('fetch', fetchMock);
  const puts = () => fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([url, init]) => ({
      url: String(url),
      keepalive: init?.keepalive,
      body: JSON.parse(String(init?.body)) as ChatMessage & { createOnly?: boolean },
    }));
  return { fetchMock, puts };
}

/** The transcript a page coming back from a reload would read. */
function reloadTranscript(conversationId = 'conversation-1') {
  return loadConversationTranscript('project-1', conversationId, new AbortController().signal);
}

/** Starts a durable save, as a send does, that the page dies before seeing answered. */
function diedDuringSave(message: ChatMessage, conversationId = 'conversation-1') {
  stubDaemon(neverAnswers);
  void saveMessage('project-1', conversationId, message, { durable: true });
}

/** localStorage alone refuses writes, as when a draft of the same text fills its quota. */
function fillLocalStorage() {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new DOMException('full', 'QuotaExceededError');
    setItem.call(this, key, value);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('a reload that beats a message save', () => {
  it('shows the message at once even while the daemon sits on every save', async () => {
    diedDuringSave(userMessage('Keep me'));

    stubDaemon(neverAnswers);
    await expect(reloadTranscript()).resolves.toEqual([userMessage('Keep me')]);
  });

  it('replays it as a claim that cannot overwrite a row that already landed', async () => {
    diedDuringSave(userMessage('Keep me'));

    const { puts } = stubDaemon();
    await reloadTranscript();

    expect(puts()).toHaveLength(1);
    expect(puts()[0]?.url).toBe('/api/projects/project-1/conversations/conversation-1/messages/user-1');
    expect(puts()[0]?.body).toMatchObject({ id: 'user-1', content: 'Keep me', createOnly: true });
  });

  it('still shows it when the replay lands and clears its record after the read has missed it', async () => {
    diedDuringSave(userMessage('Keep me'));

    let answerRead!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      init?.method === 'PUT'
        ? saved()
        : new Promise<Response>((resolve) => { answerRead = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const transcript = reloadTranscript();
    await vi.waitFor(() => expect(localStorage).toHaveLength(0));
    answerRead(Response.json({ messages: [] }));

    await expect(transcript).resolves.toEqual([userMessage('Keep me')]);
  });

  it('prefers the row the daemon already stored and does not show it twice', async () => {
    diedDuringSave(userMessage('Lost the claim'));

    const stored = [userMessage('Won the claim')];
    stubDaemon(saved, stored);

    await expect(reloadTranscript()).resolves.toEqual(stored);
  });

  it('stops replaying once the daemon has confirmed the row', async () => {
    diedDuringSave(userMessage('Keep me'));
    stubDaemon();
    await reloadTranscript();
    await vi.waitFor(() => expect(localStorage).toHaveLength(0));

    const { puts } = stubDaemon();
    await expect(reloadTranscript()).resolves.toEqual([]);
    expect(puts()).toEqual([]);
  });

  it('adds unsaved messages after the stored rows, oldest first', async () => {
    diedDuringSave(userMessage('Second', { id: 'user-b', createdAt: 2_000 }));
    diedDuringSave(userMessage('First', { id: 'user-a', createdAt: 1_000 }));

    const stored = [{ id: 'old', role: 'assistant', content: 'Earlier', createdAt: 500 } as ChatMessage];
    stubDaemon(saved, stored);

    const transcript = await reloadTranscript();
    expect(transcript.map((message) => message.id)).toEqual(['old', 'user-a', 'user-b']);
  });

  it('replays another conversation too, but keeps it out of this transcript', async () => {
    diedDuringSave(userMessage('Elsewhere'), 'conversation-2');

    const { puts } = stubDaemon();
    await expect(reloadTranscript('conversation-1')).resolves.toEqual([]);

    expect(puts().map((put) => put.url)).toEqual([
      '/api/projects/project-1/conversations/conversation-2/messages/user-1',
    ]);
  });

  it.each([
    ['a server error', () => Promise.resolve(new Response('', { status: 500 }))],
    ['a timeout', () => Promise.resolve(new Response('', { status: 408 }))],
    ['rate limiting', () => Promise.resolve(new Response('', { status: 429 }))],
    ['an unreachable daemon', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('keeps the message through %s, which a later attempt can pass', async (_name, onPut) => {
    stubDaemon(onPut);
    await saveMessage('project-1', 'conversation-1', userMessage('Keep me'), { durable: true });

    stubDaemon(neverAnswers);
    await expect(reloadTranscript()).resolves.toEqual([userMessage('Keep me')]);
  });

  it.each([
    ['a deleted conversation', 404],
    ['a body the daemon can never accept', 413],
  ] as const)('lets go of the message on %s', async (_name, status) => {
    stubDaemon(() => Promise.resolve(new Response('', { status })));
    await saveMessage('project-1', 'conversation-1', userMessage('Unsavable'), { durable: true });

    const { puts } = stubDaemon();
    await expect(reloadTranscript()).resolves.toEqual([]);
    expect(puts()).toEqual([]);
  });

  it('keeps the record in sessionStorage when localStorage is full, and clears it there too', async () => {
    fillLocalStorage();
    diedDuringSave(userMessage('Keep me'));
    expect(sessionStorage).toHaveLength(1);

    stubDaemon();
    await expect(reloadTranscript()).resolves.toEqual([userMessage('Keep me')]);
    await vi.waitFor(() => expect(sessionStorage).toHaveLength(0));
  });

  it('shows and replays a record once when both stores hold a copy', async () => {
    fillLocalStorage();
    diedDuringSave(userMessage('Keep me'));
    vi.restoreAllMocks();
    diedDuringSave(userMessage('Keep me'));
    expect([localStorage.length, sessionStorage.length]).toEqual([1, 1]);

    const { puts } = stubDaemon(neverAnswers);
    await expect(reloadTranscript()).resolves.toEqual([userMessage('Keep me')]);
    expect(puts()).toHaveLength(1);
  });

  it('still saves when the browser refuses to keep a local record', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { puts } = stubDaemon();

    await saveMessage('project-1', 'conversation-1', userMessage('Keep me'), { durable: true });

    expect(puts()).toMatchObject([{ keepalive: true, body: { content: 'Keep me' } }]);
  });

  it('skips a record it cannot read instead of failing the transcript', async () => {
    localStorage.setItem('openpixo:pending-message-save:broken', '{not json');
    stubDaemon();

    await expect(reloadTranscript()).resolves.toEqual([]);
  });
});

describe('a prompt too long for keepalive', () => {
  // Fills the JSON envelope up to `bytes` once UTF-8 encoded.
  function messageOfBodySize(bytes: number): ChatMessage {
    const envelope = JSON.stringify(userMessage('')).length;
    return userMessage('x'.repeat(bytes - envelope));
  }

  it('uses keepalive up to the limit and a plain request one byte past it', async () => {
    const { puts } = stubDaemon();

    await saveMessage('project-1', 'conversation-1', messageOfBodySize(KEEPALIVE_BODY_LIMIT_BYTES), { durable: true });
    await saveMessage('project-1', 'conversation-1', messageOfBodySize(KEEPALIVE_BODY_LIMIT_BYTES + 1), { durable: true });

    expect(puts().map((put) => put.keepalive)).toEqual([true, undefined]);
  });

  it('counts encoded bytes, since the browser does', async () => {
    const { puts } = stubDaemon();

    // 30,000 characters, but 90,000 bytes.
    await saveMessage('project-1', 'conversation-1', userMessage('长'.repeat(30_000)), { durable: true });

    expect(puts()).toMatchObject([{ keepalive: undefined }]);
  });

  it('sends the whole prompt and restores it whole after a reload', async () => {
    const prompt = `Start ${'长'.repeat(30_000)} end`;
    const { puts } = stubDaemon(neverAnswers);
    void saveMessage('project-1', 'conversation-1', userMessage(prompt), { durable: true });
    expect(puts()[0]?.body.content).toBe(prompt);

    stubDaemon(neverAnswers);
    const [restored] = await reloadTranscript();
    expect(restored?.content).toBe(prompt);
  });

  it('keeps an attachment-bearing message whole too', async () => {
    const attachments = [{ path: 'art/hero.png', name: 'hero.png', kind: 'image' as const, size: 2_048 }];
    diedDuringSave(userMessage('长'.repeat(30_000), { attachments }));

    stubDaemon(neverAnswers);
    const [restored] = await reloadTranscript();
    expect(restored?.attachments).toEqual(attachments);
  });
});

describe('the keepalive budget', () => {
  it('falls back to a plain request when in-flight requests have used it up', async () => {
    const { puts } = stubDaemon((init) =>
      init.keepalive ? Promise.reject(new TypeError('Failed to fetch')) : saved());

    await expect(
      saveMessage('project-1', 'conversation-1', userMessage('Keep me'), { durable: true }),
    ).resolves.toEqual({ id: 'stored' });

    expect(puts().map((put) => put.keepalive)).toEqual([true, undefined]);
  });

  it('applies the limit to an explicit keepalive save, such as the page-hide flush', async () => {
    const { puts } = stubDaemon();

    await saveMessage('project-1', 'conversation-1', userMessage('长'.repeat(30_000)), { keepalive: true });

    expect(puts()).toMatchObject([{ keepalive: undefined }]);
  });

  it('leaves an ordinary save alone: no keepalive and no local record', async () => {
    const { puts } = stubDaemon(neverAnswers);

    void saveMessage('project-1', 'conversation-1', userMessage('Ordinary'));

    expect(puts()).toMatchObject([{ keepalive: undefined }]);
    expect(localStorage).toHaveLength(0);
  });
});
