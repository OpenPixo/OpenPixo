import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchProjectEngine, fetchPublishStatus, fetchRoomsStatus, PublishRequestError, removePublishedGame,
  startPublish, startRoomsTest, updateRoomsLimit,
} from '../../src/providers/publish';

afterEach(() => vi.unstubAllGlobals());

function respond(response: Response | Error) {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
const failure = async (work: Promise<unknown>) => {
  const caught = await work.then(() => { throw new Error('expected a failure'); }, (error: unknown) => error);
  expect(caught).toBeInstanceOf(PublishRequestError);
  return caught as PublishRequestError;
};

describe('requests', () => {
  it('reads status from the project route, encoding the id', async () => {
    const mock = respond(Response.json({ available: true, game: null, job: null, termsAccepted: false, termsUrl: '' }));
    await expect(fetchPublishStatus('my game')).resolves.toMatchObject({ available: true });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/projects/my%20game/publish');
  });

  it('starts a publish with the request as JSON', async () => {
    const mock = respond(Response.json({ job: { id: 'j1', phase: 'building' } }));
    await expect(startPublish('p', { title: 'Slime', acceptTerms: true })).resolves.toMatchObject({ job: { id: 'j1' } });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('/api/projects/p/publish');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Slime', acceptTerms: true });
  });

  it('removes a link, including when the answer has no body', async () => {
    const mock = respond(new Response(null, { status: 204 }));
    await expect(removePublishedGame('p')).resolves.toBeUndefined();
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('patches the monthly limit and ignores the answer shape', async () => {
    const mock = respond(Response.json({ usage: {} }));
    await updateRoomsLimit('p', 750);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('/api/projects/p/rooms');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ monthlyCreditLimit: 750 });
  });

  it('asks for the two test windows', async () => {
    const mock = respond(Response.json({ urls: ['http://127.0.0.1:1/a', 'http://127.0.0.1:1/b'], relayUrl: 'http://127.0.0.1:2' }));
    await expect(startRoomsTest('p')).resolves.toMatchObject({ urls: ['http://127.0.0.1:1/a', 'http://127.0.0.1:1/b'] });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/projects/p/rooms/test');
    expect(mock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('reads the detected engine from next steps', async () => {
    const mock = respond(Response.json({ projectId: 'p', engine: 'phaser', dismissed: false, steps: [] }));
    await expect(fetchProjectEngine('p')).resolves.toBe('phaser');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/projects/p/next-steps');
  });
});

describe('errors', () => {
  it('carries the API code, message and status', async () => {
    respond(Response.json({ error: { code: 'PUBLISH_QUOTA', message: 'Too many today' } }, { status: 429 }));
    const error = await failure(startPublish('p', {}));
    expect(error).toMatchObject({ code: 'PUBLISH_QUOTA', message: 'Too many today', status: 429 });
    expect(error.refusedFiles).toBeUndefined();
  });

  it.each([
    ['on the error', { code: 'PUBLISH_REFUSED', message: 'Refused', refusedFiles: ['a.exe', 'b.php'] }],
    ['in its details', { code: 'PUBLISH_REFUSED', message: 'Refused', details: { refusedFiles: ['a.exe', 'b.php'] } }],
  ])('reads the refused files %s', async (_where, body) => {
    respond(Response.json({ error: body }, { status: 422 }));
    expect((await failure(startPublish('p', {}))).refusedFiles).toEqual(['a.exe', 'b.php']);
  });

  it('ignores refused files that are not a list of paths', async () => {
    respond(Response.json({ error: { code: 'PUBLISH_REFUSED', message: 'x', refusedFiles: [1, 2] } }, { status: 422 }));
    expect((await failure(startPublish('p', {}))).refusedFiles).toBeUndefined();
  });

  it('has no code when the failure is not the API speaking', async () => {
    respond(new Response('<html>not found</html>', { status: 404 }));
    expect(await failure(fetchPublishStatus('p'))).toMatchObject({ code: null, status: 404, message: 'HTTP 404' });
    respond(new TypeError('Failed to fetch'));
    expect(await failure(fetchRoomsStatus('p'))).toMatchObject({ code: null, status: 0 });
  });

  it('refuses a successful answer of the wrong shape', async () => {
    respond(Response.json({ nope: true }));
    expect(await failure(fetchPublishStatus('p'))).toMatchObject({ code: null, message: 'Invalid response' });
    respond(Response.json({ urls: ['only one'] }));
    expect(await failure(startRoomsTest('p'))).toMatchObject({ code: null });
    respond(new Response('not json'));
    expect(await failure(fetchRoomsStatus('p'))).toMatchObject({ code: null });
  });

  it('lets an abort through unchanged', async () => {
    respond(new DOMException('Aborted', 'AbortError'));
    await expect(fetchPublishStatus('p')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
