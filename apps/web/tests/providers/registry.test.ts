
import { afterEach, describe, expect, it, vi } from 'vitest';



import { fetchAgents, fetchAgentsStream, fetchSkills, fetchDesignTemplates, fetchPromptTemplates, fetchAppVersionInfo, fetchPluginExampleHtml, fetchPluginPreviewHtml, fetchProjectFiles, fetchProjectFileText, fetchSkillExample, invalidateProjectFilesCache, importSkill, installSkill, openFolderDialog, uploadProjectFiles, writeProjectTextFileDetailed } from '../../src/providers/registry';

describe('passive startup catalog observation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const readers = [
    (onReadResult: (success: boolean) => void) => fetchSkills({ onReadResult }),
    (onReadResult: (success: boolean) => void) => fetchDesignTemplates({ onReadResult }),
    (onReadResult: (success: boolean) => void) => fetchPromptTemplates({ onReadResult }),
  ];
  it.each(readers.map((read, index) => ({ read, index })))(
    'observes failures without changing the existing empty-list result $index', async ({ read }) => {
      for (const fetcher of [
        async () => new Response('', { status: 503 }),
        async () => { throw new Error('offline'); },
        async () => new Response('{'),
      ]) {
        const observer = vi.fn();
        vi.stubGlobal('fetch', vi.fn(fetcher));
        await expect(read(observer)).resolves.toEqual([]);
        expect(observer).toHaveBeenLastCalledWith(false);
      }
      const observer = vi.fn();
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({
        skills: [], designTemplates: [], promptTemplates: [],
      })));
      await expect(read(observer)).resolves.toEqual([]);
      expect(observer).toHaveBeenLastCalledWith(true);
      await expect(read(() => { throw new Error('observation failed'); })).resolves.toEqual([]);
    },
  );
});

describe('skill operation diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the top-level remote-install error code and status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Skill download failed',
      code: 'FETCH_FAILED',
    }), { status: 502 })));

    await expect(installSkill({ source: 'github:owner/repo' })).resolves.toEqual({
      error: {
        code: 'FETCH_FAILED',
        message: 'Skill download failed',
        status: 502,
      },
    });
  });

  it('preserves a nested import error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid SKILL.md' },
    }), { status: 400 })));

    await expect(importSkill({ name: 'broken', body: 'broken' })).resolves.toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid SKILL.md',
        status: 400,
      },
    });
  });

  it('drops a syntactically valid but unknown import error code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'UPSTREAM_abc123', message: 'Unknown upstream failure' },
    }), { status: 503 })));

    await expect(importSkill({ name: 'broken', body: 'broken' })).resolves.toEqual({
      error: {
        message: 'Unknown upstream failure',
        status: 503,
      },
    });
  });
});





function agentStreamResponse(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('fetchAgentsStream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])('requests a fresh stream only for explicit refresh=%s', async (refresh) => {
    const fetcher = vi.fn(async () => agentStreamResponse('event: done\ndata: {}\n\n'));
    vi.stubGlobal('fetch', fetcher);

    await fetchAgentsStream({ onAgent: vi.fn(), refresh });

    expect(fetcher).toHaveBeenCalledWith(
      refresh ? '/api/agents?stream=1&refresh=1' : '/api/agents?stream=1',
      expect.objectContaining({ cache: 'no-store', headers: { Accept: 'text/event-stream' } }),
    );
  });

  it('collects streamed agents only after the terminal done event', async () => {
    const agent = {
      id: 'codex',
      name: 'Codex CLI',
      bin: 'codex',
      available: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => agentStreamResponse(
        `event: agent\ndata: ${JSON.stringify(agent)}\n\n` +
          'event: done\ndata: {}\n\n',
      )),
    );
    const onAgent = vi.fn();

    await expect(fetchAgentsStream({ onAgent })).resolves.toEqual([agent]);
    expect(onAgent).toHaveBeenCalledWith(agent);
  });

  it('throws when the stream emits an error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => agentStreamResponse(
        'event: error\ndata: {"error":"agent probe failed"}\n\n',
      )),
    );

    await expect(fetchAgentsStream({ onAgent: vi.fn() }))
      .rejects.toThrow('agent probe failed');
  });

  it('throws when the stream closes before the terminal done event', async () => {
    const agent = {
      id: 'codex',
      name: 'Codex CLI',
      bin: 'codex',
      available: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => agentStreamResponse(
        `event: agent\ndata: ${JSON.stringify(agent)}\n\n`,
      )),
    );

    await expect(fetchAgentsStream({ onAgent: vi.fn() }))
      .rejects.toThrow('agents stream ended before done');
  });
});

describe('fetchAgents', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([false, true])('requests fresh batch detection only for explicit refresh=%s', async (refresh) => {
    const fetcher = vi.fn(async () => Response.json({ agents: [] }));
    vi.stubGlobal('fetch', fetcher);

    await fetchAgents({ refresh });

    expect(fetcher).toHaveBeenCalledWith(
      refresh ? '/api/agents?refresh=1' : '/api/agents',
      { cache: 'no-store' },
    );
  });
});

describe('fetchAppVersionInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns version info from the daemon response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        version: { version: '1.2.3', channel: 'beta', packaged: true, platform: 'darwin', arch: 'arm64' },
      }), { status: 200 })),
    );

    await expect(fetchAppVersionInfo()).resolves.toEqual({
      version: '1.2.3',
      channel: 'beta',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
    });
  });

  it('returns null when version info is unavailable or malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: { version: '1.2.3' } }), { status: 200 })),
    );

    await expect(fetchAppVersionInfo()).resolves.toBeNull();
  });
});

describe('fetchProjectFiles after an external write', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const file = (name: string) => ({
    name, path: name, kind: 'image', mime: 'image/png', size: 1, mtime: 1,
  });
  const response = (files: ReturnType<typeof file>[]) => Response.json({ files });

  it.each([0, 249])('replaces a settled forced snapshot after a write %ims later', async (elapsed) => {
    vi.useFakeTimers();
    const before = [file('before.png')];
    const after = [...before, file('generated.png')];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(before))
      .mockResolvedValueOnce(response(after));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjectFiles('post-write-settled', { fresh: true })).resolves.toEqual(before);
    await vi.advanceTimersByTimeAsync(elapsed);
    await expect(fetchProjectFiles('post-write-settled', {
      fresh: true, afterChange: true, requireAuthoritative: true,
    })).resolves.toEqual(after);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fences an older in-flight read and shares the post-write request with ordinary readers', async () => {
    vi.useFakeTimers();
    const before = [file('before.png')];
    const after = [...before, file('generated.png')];
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => newResponse.promise);
    vi.stubGlobal('fetch', fetchMock);

    const earlier = fetchProjectFiles('post-write-inflight', { fresh: true });
    await vi.advanceTimersByTimeAsync(95);
    const completion = fetchProjectFiles('post-write-inflight', {
      fresh: true, afterChange: true, requireAuthoritative: true,
    });
    const ordinary = fetchProjectFiles('post-write-inflight');
    newResponse.resolve(response(after));
    oldResponse.resolve(response(before));

    await expect(Promise.all([earlier, completion, ordinary])).resolves.toEqual([after, after, after]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries an overtaken write-boundary read without declaring another write', async () => {
    vi.useFakeTimers();
    const firstFiles = [file('first.png')];
    const latestFiles = [...firstFiles, file('second.png')];
    const firstResponse = deferred<Response>();
    const latestResponse = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => latestResponse.promise)
      // A retry that mistakenly declares another write still settles, but its
      // extra network request is rejected by the count below.
      .mockImplementation(async () => response(latestFiles));
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchProjectFiles('post-write-overtaken', { fresh: true, afterChange: true });
    await vi.advanceTimersByTimeAsync(1);
    const second = fetchProjectFiles('post-write-overtaken', { fresh: true, afterChange: true });
    latestResponse.resolve(response(latestFiles));
    await Promise.resolve();
    firstResponse.resolve(response(firstFiles));

    await expect(Promise.all([first, second])).resolves.toEqual([latestFiles, latestFiles]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves ordinary and broadcast-forced concurrent read coalescing', async () => {
    vi.useFakeTimers();
    const files = [file('shared.png')];
    const gate = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const readers = [
      fetchProjectFiles('post-write-burst', { fresh: true }),
      fetchProjectFiles('post-write-burst', { fresh: true }),
      fetchProjectFiles('post-write-burst'),
    ];
    gate.resolve(response(files));
    await expect(Promise.all(readers)).resolves.toEqual([files, files, files]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


});

describe('fetchProjectFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bypasses the HTTP cache for dynamic project file lists', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ files: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjectFiles('project-dynamic-list', { fresh: true }))
      .resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-dynamic-list/files',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('does not make a foreground reopen join a cancellable background read', async () => {
    const files = [{
      name: 'index.html',
      path: 'index.html',
      kind: 'html',
      mtime: 1,
      size: 1,
      mime: 'text/html',
    }];
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ files }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const background = fetchProjectFiles('project-reopen', {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    const foreground = fetchProjectFiles('project-reopen');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(background).resolves.toEqual([]);
    await expect(foreground).resolves.toEqual(files);
  });

  it('rejects an HTTP failure instead of publishing a non-authoritative empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'temporarily unavailable' } }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )));

    await expect(fetchProjectFiles('project-http-failure', {
      fresh: true,
      requireAuthoritative: true,
    }))
      .rejects.toThrow('Project files request failed (503)');
  });

  it('rejects a network failure instead of publishing a non-authoritative empty list', async () => {
    const networkError = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw networkError;
    }));

    await expect(fetchProjectFiles('project-network-failure', {
      fresh: true,
      requireAuthoritative: true,
    }))
      .rejects.toBe(networkError);
  });

  it('preserves the historical empty fallback when strict authority is not requested', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjectFiles('project-default-http-failure', { fresh: true }))
      .resolves.toEqual([]);
    await expect(fetchProjectFiles('project-default-network-failure', { fresh: true }))
      .resolves.toEqual([]);
  });

  it('still accepts an authoritative successful empty file list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ files: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    await expect(fetchProjectFiles('project-authoritative-empty', { fresh: true }))
      .resolves.toEqual([]);
  });

  it('re-reads after a successful mutation overtakes an in-flight file list', async () => {
    const workspaceContext = null;
    const staleFiles = [{
      name: 'stale.html',
      path: 'stale.html',
      kind: 'html',
      mtime: 1,
      size: 1,
      mime: 'text/html',
    }];
    const freshFiles = [{
      name: 'fresh.html',
      path: 'fresh.html',
      kind: 'html',
      mtime: 2,
      size: 2,
      mime: 'text/html',
    }];
    let resolveStaleRead!: (response: Response) => void;
    const staleRead = new Promise<Response>((resolve) => {
      resolveStaleRead = resolve;
    });
    let fileListReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/projects/project-mutation-race/files') {
        fileListReads += 1;
        if (fileListReads === 1) return staleRead;
        return new Response(JSON.stringify({ files: freshFiles }), { status: 200 });
      }
      if (url === '/api/projects/project-mutation-race/upload' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          files: [{ name: 'fresh.html', path: 'fresh.html', size: 2 }],
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const initialRead = fetchProjectFiles('project-mutation-race', {  });
    await vi.waitFor(() => expect(fileListReads).toBe(1));

    const upload = new File(['ok'], 'fresh.html', { type: 'text/html' });
    await expect(
      uploadProjectFiles('project-mutation-race', [upload], undefined),
    ).resolves.toMatchObject({ uploaded: [{ path: 'fresh.html' }], failed: [] });

    resolveStaleRead(new Response(JSON.stringify({ files: staleFiles }), { status: 200 }));

    await expect(initialRead).resolves.toEqual(freshFiles);
    expect(fileListReads).toBe(2);
  });

  it('re-reads after an external file event invalidates settled and in-flight scoped lists', async () => {
    const workspaceContext = null;
    const firstFiles = [{
      name: 'first.html',
      path: 'first.html',
      kind: 'html',
      mtime: 1,
      size: 1,
      mime: 'text/html',
    }];
    const staleFiles = [{
      name: 'stale.html',
      path: 'stale.html',
      kind: 'html',
      mtime: 2,
      size: 2,
      mime: 'text/html',
    }];
    const freshFiles = [{
      name: 'fresh.html',
      path: 'fresh.html',
      kind: 'html',
      mtime: 3,
      size: 3,
      mime: 'text/html',
    }];
    let resolveStaleRead!: (response: Response) => void;
    const staleRead = new Promise<Response>((resolve) => {
      resolveStaleRead = resolve;
    });
    let fileListReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe('/api/projects/project-event-race/files');
      fileListReads += 1;
      if (fileListReads === 1) {
        return new Response(JSON.stringify({ files: firstFiles }), { status: 200 });
      }
      if (fileListReads === 2) return staleRead;
      return new Response(JSON.stringify({ files: freshFiles }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjectFiles('project-event-race', {  }))
      .resolves.toEqual(firstFiles);
    await expect(fetchProjectFiles('project-event-race', {  }))
      .resolves.toEqual(firstFiles);
    expect(fileListReads).toBe(1);

    invalidateProjectFilesCache('project-event-race');
    const invalidatedRead = fetchProjectFiles('project-event-race', {  });
    await vi.waitFor(() => expect(fileListReads).toBe(2));

    invalidateProjectFilesCache('project-event-race');
    resolveStaleRead(new Response(JSON.stringify({ files: staleFiles }), { status: 200 }));

    await expect(invalidatedRead).resolves.toEqual(freshFiles);
    expect(fileListReads).toBe(3);
  });
});

describe('writeProjectTextFileDetailed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('surfaces daemon save errors instead of collapsing them to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'ARTIFACT_REGRESSION', message: 'new artifact is smaller than the prior version' },
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })),
    );

    await expect(writeProjectTextFileDetailed('project-1', 'preview.html', '<html></html>')).resolves.toEqual({
      ok: false,
      status: 422,
      code: 'ARTIFACT_REGRESSION',
      message: 'new artifact is smaller than the prior version',
    });
  });



  it('omits workspace headers when there is no workspace context (legacy local mode)', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ file: { name: 'preview.html', path: 'preview.html', size: 0, mtime: 0 } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await writeProjectTextFileDetailed('project-1', 'preview.html', '<html></html>');

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('openFolderDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the legacy fail-soft behavior unless throwOnError is requested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({ error: 'Could not open folder picker: zenity is not installed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )),
    );

    await expect(openFolderDialog()).resolves.toBeNull();
  });

  it('throws daemon picker messages when throwOnError is requested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({ error: 'Could not open folder picker: zenity is not installed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )),
    );

    await expect(openFolderDialog({ throwOnError: true }))
      .rejects.toThrow('Could not open folder picker: zenity is not installed');
  });
});

describe('fetchSkillExample', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Regression coverage for inherited issue #897. Skills declared with
  // a non-html `od.preview.type` ship no fetchable HTML — the daemon's
  // /example endpoint only resolves HTML files and 404s for everything
  // else, which left the gallery stuck on a misleading "Couldn't load
  // this example. The example HTML failed to fetch." state. The dispatch
  // now short-circuits at the data layer so the modal can render a calm
  // "no shipped preview" placeholder without firing a doomed network
  // call.
  it('short-circuits without a fetch when previewType is not html', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSkillExample('hatch-pet', 'image')).resolves.toEqual({
      unavailable: true,
      kind: 'image',
    });
    await expect(
      fetchSkillExample('dcf-valuation', 'markdown'),
    ).resolves.toEqual({ unavailable: true, kind: 'markdown' });

    // The doomed-call is the bug we're fixing — assert no network call
    // was made for either non-html dispatch.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to html fetch when previewType is omitted (legacy callers)', async () => {
    const fetchMock = vi.fn(
      async () => new Response('<html><body>ok</body></html>', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSkillExample('blog-post')).resolves.toEqual({
      html: '<html><body>ok</body></html>',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/blog-post/example');
  });

  it('treats missing html previews as unavailable instead of an error', async () => {
    const fetchMock = vi.fn(
      async () => new Response('not found', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSkillExample('design-brief', 'html')).resolves.toEqual({
      unavailable: true,
      kind: 'html',
    });
    // Confirm the dispatch did call through to the daemon for the html
    // path (i.e. the short-circuit above only catches non-html types).
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/design-brief/example');
  });

  it('forwards real html preview fetch failures as discriminated errors', async () => {
    const fetchMock = vi.fn(
      async () => new Response('server error', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSkillExample('design-brief', 'html')).resolves.toEqual({
      error: 'HTTP 500',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/design-brief/example');
  });
});

// Plugin previews use the same daemon contract as skill examples (the
// daemon returns 404 when the manifest declares a preview entry but no
// file ships at that path). Skills already map that 404 to
// { unavailable: true, kind: 'html' } per #897 so the modal renders a
// calm "no shipped preview" placeholder instead of "Couldn't load this
// example. The example HTML failed to fetch." Plugins lacked the
// symmetric treatment, so bundled plugins like `example-live-artifact`
// surfaced the misleading error from the Home Community grid even
// though the catalog simply ships no example HTML for that plugin.
describe('fetchPluginPreviewHtml', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('treats missing previews as unavailable instead of an error', async () => {
    const fetchMock = vi.fn(
      async () => new Response('preview not found', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPluginPreviewHtml('example-live-artifact'),
    ).resolves.toEqual({ unavailable: true, kind: 'html' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/example-live-artifact/preview',
    );
  });

  it('forwards real preview fetch failures as discriminated errors', async () => {
    const fetchMock = vi.fn(
      async () => new Response('server error', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPluginPreviewHtml('example-live-artifact'),
    ).resolves.toEqual({ error: 'HTTP 500' });
  });

  it('returns html on success', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('<html><body>preview</body></html>', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPluginPreviewHtml('example-live-artifact'),
    ).resolves.toEqual({ html: '<html><body>preview</body></html>' });
  });
});

describe('fetchPluginExampleHtml', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('treats missing example stems as unavailable instead of an error', async () => {
    const fetchMock = vi.fn(
      async () => new Response('example not found', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPluginExampleHtml('example-live-artifact', 'index'),
    ).resolves.toEqual({ unavailable: true, kind: 'html' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/example-live-artifact/example/index',
    );
  });

  it('forwards real example fetch failures as discriminated errors', async () => {
    const fetchMock = vi.fn(
      async () => new Response('server error', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPluginExampleHtml('example-live-artifact', 'index'),
    ).resolves.toEqual({ error: 'HTTP 500' });
  });
});



describe('fetchProjectFileText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('can bypass caches when fetching source text', async () => {
    const fetchMock = vi.fn(async () => new Response('<svg />', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchProjectFileText('project-1', 'diagram.svg', {
        cache: 'no-store',
        cacheBustKey: '1710000000-2',
      }),
    ).resolves.toBe('<svg />');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/raw/diagram.svg?cacheBust=1710000000-2',
      { cache: 'no-store' },
    );
  });

  it('logs HTTP failure context before returning null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' })));

    await expect(fetchProjectFileText('project-1', 'missing.svg')).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      '[fetchProjectFileText] failed:',
      expect.objectContaining({
        name: 'missing.svg',
        projectId: 'project-1',
        status: 404,
        statusText: 'Not Found',
        url: '/api/projects/project-1/raw/missing.svg',
      }),
    );
  });

  it('logs thrown fetch errors before returning null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('network down');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw error;
    }));

    await expect(fetchProjectFileText('project-1', 'diagram.svg')).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      '[fetchProjectFileText] failed:',
      expect.objectContaining({
        error,
        name: 'diagram.svg',
        projectId: 'project-1',
        url: '/api/projects/project-1/raw/diagram.svg',
      }),
    );
  });

  it('silently returns null when a background source read is aborted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    })));

    const pending = fetchProjectFileText('project-1', 'brand.json', {
      cache: 'no-store',
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('uploadProjectFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('treats every response entry as a success regardless of originalName drift', async () => {
    // Simulates an encoding edge case: the browser File.name carries a
    // composed CJK name (NFC) but multer round-trips it through latin1 and
    // returns a slightly different decoded form. The old name-equality
    // matching marked these as failed even though the server stored them.
    const composed = '测试.pdf';
    const decomposed = '测试.pdf'; // pretend the server returned a normalized variant
    const file = new File(['hello'], composed, { type: 'application/pdf' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        files: [
          {
            name: 'mxk7-test.pdf',
            path: 'mxk7-test.pdf',
            size: 5,
            originalName: decomposed,
          },
        ],
      }), { status: 200 })),
    );

    const result = await uploadProjectFiles('project-1', [file]);

    expect(result.failed).toEqual([]);
    expect(result.uploaded).toHaveLength(1);
    expect(result.uploaded[0]).toMatchObject({
      path: 'mxk7-test.pdf',
      name: decomposed,
      size: 5,
    });
  });

  it('marks the unmatched tail as failed when the server drops files mid-flight', async () => {
    const a = new File(['a'], 'a.txt', { type: 'text/plain' });
    const b = new File(['b'], 'b.txt', { type: 'text/plain' });
    const c = new File(['c'], 'c.txt', { type: 'text/plain' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        files: [
          { name: 't1-a.txt', path: 't1-a.txt', size: 1, originalName: 'a.txt' },
          { name: 't2-b.txt', path: 't2-b.txt', size: 1, originalName: 'b.txt' },
        ],
      }), { status: 200 })),
    );

    const result = await uploadProjectFiles('project-1', [a, b, c]);

    expect(result.uploaded).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ name: 'c.txt' });
  });



  it('omits workspace headers when there is no workspace context (legacy local mode)', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      files: [{ name: 'hello.txt', path: 'hello.txt', size: 5, originalName: 'hello.txt' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadProjectFiles('project-1', [file]);

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.headers).toBeUndefined();
  });

  it('invalidates the shared file list after an upload succeeds', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    let uploaded = false;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/projects/project-1/upload' && init?.method === 'POST') {
        uploaded = true;
        return new Response(JSON.stringify({
          files: [{ name: 'hello.txt', path: 'hello.txt', size: 5, originalName: 'hello.txt' }],
        }), { status: 200 });
      }
      if (url === '/api/projects/project-1/files') {
        return new Response(JSON.stringify({
          files: uploaded
            ? [{ name: 'hello.txt', path: 'hello.txt', type: 'file', size: 5, mtime: 1 }]
            : [],
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjectFiles('project-1')).resolves.toEqual([]);
    await expect(uploadProjectFiles('project-1', [file])).resolves.toMatchObject({
      uploaded: [{ path: 'hello.txt' }],
      failed: [],
    });
    await expect(fetchProjectFiles('project-1')).resolves.toEqual([
      expect.objectContaining({ name: 'hello.txt', path: 'hello.txt' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
