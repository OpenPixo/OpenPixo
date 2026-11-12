// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

// These tests exercise FileViewer's local-project preview path. Keep the
// authorization scope resolved from the first render so cache assertions do
// not depend on the asynchronous workspace-context probe.


import { FileViewer } from '../../src/components/FileViewer';

beforeEach(() => window.history.replaceState({}, '', '/?forceInline=1'));

afterEach(() => {
  window.history.replaceState({}, '', '/');
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Minimal deck file fixture that forces the srcDoc render path.
function deckFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'deck.html',
    path: 'deck.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'deck',
      title: 'Deck',
      entry: 'deck.html',
      renderer: 'deck-html',
      exports: ['html'],
    },
    ...overrides,
  };
}

// Embeds a label inside a minimal deck HTML body so the srcdoc can be
// searched for it.
function deckHtml(label: string): string {
  return `<html><body><section class="slide"><h1>${label}</h1></section></body></html>`;
}

const RAW_URL_PREFIX = '/api/projects/project-1/raw/';

// Returns the srcdoc iframe rendered for the deck (srcDoc) path.
function srcDocFrame(): HTMLIFrameElement {
  return screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
}

// A controllable fetch stub — callers resolve or reject each queued request
// individually by calling the returned handle.
type FetchHandle = {
  resolve: (html: string | null, status?: number) => void;
};

function deferredFetch(): { handle: FetchHandle; stub: typeof fetch } {
  let resolveRequest!: (resp: Response) => void;
  const handle: FetchHandle = {
    resolve: (html, status = 200) => {
      resolveRequest(
        html !== null
          ? new Response(html, { status })
          : new Response('', { status: 500 }),
      );
    },
  };
  const stub = vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    if (url.startsWith(RAW_URL_PREFIX)) {
      return new Promise<Response>((ok) => {
        resolveRequest = ok;
      });
    }
    return new Response('', { status: 404 });
  });
  return { handle, stub };
}

// Fetches that resolve immediately with a fixed response.
function fetchReturning(html: string) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    if (url.startsWith(RAW_URL_PREFIX)) {
      return new Response(html, { status: 200 });
    }
    return new Response('', { status: 404 });
  });
}

describe('FileViewer srcDoc reload — prevSourceBeforeReloadRef race conditions', () => {
  it('seeds a same-version remount from the settled source without a redundant background read', async () => {
    const v1 = deckHtml('REVISIT-CACHED-V1');
    vi.stubGlobal('fetch', fetchReturning(v1));

    const first = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile({ name: 'revisit.html', path: 'revisit.html' })}
      />,
    );

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('REVISIT-CACHED-V1');
    });
    first.unmount();

    const remountFetch = fetchReturning(deckHtml('UNEXPECTED-REMOTE-V2'));
    vi.stubGlobal('fetch', remountFetch);
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile({ name: 'revisit.html', path: 'revisit.html' })}
      />,
    );

    expect(srcDocFrame().getAttribute('srcDoc')).toContain('REVISIT-CACHED-V1');
    // This source-cache regression deliberately does not forge the iframe's
    // exact paint-probe acknowledgement. The first-load cover and its
    // paint-verified remount behavior are exercised in FileViewer.test.tsx.
    expect(
      remountFetch.mock.calls.some(([input]) => String(input).startsWith(RAW_URL_PREFIX)),
    ).toBe(false);
  });

  it('invalidates a cached v1 after a file event and loads v2 even when metadata is unchanged', async () => {
    const file = deckFile({ name: 'remote-update.html', path: 'remote-update.html' });
    vi.stubGlobal('fetch', fetchReturning(deckHtml('REMOTE-CACHED-V1')));

    const first = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
      />,
    );
    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('REMOTE-CACHED-V1');
    });
    first.unmount();

    const { handle: v2Handle, stub: v2Fetch } = deferredFetch();
    const v2FetchMock = vi.mocked(v2Fetch);
    vi.stubGlobal('fetch', v2Fetch);
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        filesRefreshKey={1}
      />,
    );

    expect(screen.queryByTestId('artifact-preview-frame')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        v2FetchMock.mock.calls.some(([input]) => String(input).startsWith(RAW_URL_PREFIX)),
      ).toBe(true);
    });

    await act(async () => {
      v2Handle.resolve(deckHtml('REMOTE-ORIGIN-V2'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('REMOTE-ORIGIN-V2');
    });
    expect(srcDocFrame().getAttribute('srcDoc')).not.toContain('REMOTE-CACHED-V1');

    const rawCall = v2FetchMock.mock.calls.find(([input]) =>
      String(input).startsWith(RAW_URL_PREFIX),
    );
    expect(rawCall?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('does not seed a changed-version remount with the previous HTML', async () => {
    const v1 = deckHtml('VERSION-BEFORE-MTIME-CHANGE');
    vi.stubGlobal('fetch', fetchReturning(v1));

    const first = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile({ name: 'versioned.html', path: 'versioned.html', mtime: 1 })}
      />,
    );
    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('VERSION-BEFORE-MTIME-CHANGE');
    });
    first.unmount();

    const { stub: heldChangedVersion } = deferredFetch();
    vi.stubGlobal('fetch', heldChangedVersion);
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile({ name: 'versioned.html', path: 'versioned.html', mtime: 2 })}
      />,
    );

    expect(screen.queryByTestId('artifact-preview-frame')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('VERSION-BEFORE-MTIME-CHANGE');
  });

  it('invalidates the settled snapshot when Reload is requested', async () => {
    const v1 = deckHtml('BEFORE-EXPLICIT-RELOAD');
    vi.stubGlobal('fetch', fetchReturning(v1));

    const first = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile({ name: 'reload-invalidates.html', path: 'reload-invalidates.html' })}
      />,
    );
    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('BEFORE-EXPLICIT-RELOAD');
    });

    const { stub: heldReload } = deferredFetch();
    vi.stubGlobal('fetch', heldReload);
    fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    first.unmount();

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile({ name: 'reload-invalidates.html', path: 'reload-invalidates.html' })}
      />,
    );

    expect(screen.queryByTestId('artifact-preview-frame')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('BEFORE-EXPLICIT-RELOAD');
  });

  // ---------------------------------------------------------------------------
  // Race 1: double-click wipes the fallback ref before the first fetch fails
  // ---------------------------------------------------------------------------
  it('restores the last good preview when a second Reload click fires before the first fetch resolves and that first fetch fails', async () => {
    // Step 1: initial render — file content "V1" lands in the iframe srcdoc.
    const v1 = deckHtml('version-one');
    vi.stubGlobal('fetch', fetchReturning(v1));

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile()}
      />,
    );

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('version-one');
    });

    // Step 2: first Reload click — source goes null, fetch1 is in flight.
    const { handle: fetch1Handle, stub: fetch1Stub } = deferredFetch();
    vi.stubGlobal('fetch', fetch1Stub);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // At this point source === null, so the ref (if re-captured unconditionally
    // on every reload) would be overwritten with null on the next click.

    // Step 3: second Reload click fires BEFORE fetch1 resolves.
    // source is still null here (fetch1 has not resolved yet).
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // Step 4: resolve fetch1 with a non-2xx to trigger the restore path.
    await act(async () => {
      fetch1Handle.resolve(null, 500);
      await Promise.resolve();
    });

    // Also drain any queued microtasks from the second click's pending fetch.
    await act(async () => {
      await Promise.resolve();
    });

    // --- KEY ASSERTION ---
    // The iframe must still display "version-one".  On the buggy branch the
    // ref was overwritten with null by the second click (source was null when
    // the second click captured it), so the restore path has nothing to set
    // and the preview goes blank.
    await waitFor(() => {
      const srcdoc = srcDocFrame().getAttribute('srcDoc') ?? '';
      expect(srcdoc).toContain('version-one');
    });
  });

  // ---------------------------------------------------------------------------
  // Race 2: file-switch shows loading state, not blank iframe or old HTML
  // ---------------------------------------------------------------------------
  it('shows the loading indicator for File B (not a blank iframe or File A HTML) when the user switches files while a reload fetch is in flight and File B source is unavailable', async () => {
    // Build two distinct deck files rooted at different raw URLs so fetch
    // mocks can distinguish them.
    const fileA = deckFile({ name: 'deck-a.html', path: 'deck-a.html' });
    const fileB = deckFile({ name: 'deck-b.html', path: 'deck-b.html' });

    const RAW_A = `/api/projects/project-1/raw/deck-a.html`;
    const RAW_B = `/api/projects/project-1/raw/deck-b.html`;

    const htmlA = deckHtml('FILE-A-HTML');

    // Step 1: mount with File A and wait for it to load.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_A)) return new Response(htmlA, { status: 200 });
        return new Response('', { status: 404 });
      }),
    );

    const { rerender } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={fileA}
      />,
    );

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('FILE-A-HTML');
    });

    // Step 2: click Reload on File A — ref captures "FILE-A-HTML", source goes
    // null, fetch for File A is now in flight (deferred).
    let resolveFileAFetch!: (resp: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_A)) {
          return new Promise<Response>((ok) => {
            resolveFileAFetch = ok;
          });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // Step 3: switch to File B BEFORE the File A fetch resolves.
    // A fresh fetch for File B immediately returns null (non-2xx) to trigger
    // whatever fallback logic exists.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_B)) {
          // Initial load for File B also fails so we can observe the srcdoc
          // state without a successful fetch masking the contamination.
          return new Response('', { status: 500 });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={fileB}
        />,
      );
    });

    // Step 4: drain microtasks so React processes the file-switch re-render
    // and any pending fetch callbacks.
    await act(async () => {
      await Promise.resolve();
    });

    // --- KEY ASSERTIONS ---
    //
    // 1. File B's source is null and has never been loaded, so the loading
    //    skeleton must be visible.  On the buggy branch sourceEverLoadedRef
    //    is still true from File A (the if-guard at ~5436 skips the reset
    //    when a reload snapshot is present), so the component skips the
    //    skeleton and renders the iframe instead — with File A's HTML if the
    //    restore-branch fires, or a blank srcdoc otherwise.
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();

    // 2. The srcdoc iframe itself must NOT be present while the loading state
    //    is active — a blank <iframe srcDoc=""> is not an acceptable stand-in
    //    for the loading indicator.
    expect(screen.queryByTestId('artifact-preview-frame')).toBeNull();

    // 3. The loading indicator text must not contain File A's HTML content.
    expect(screen.queryByText(/FILE-A-HTML/)).toBeNull();

    // Resolve the stale File A fetch last (it should be discarded, not applied
    // to the now-File-B viewer).
    if (resolveFileAFetch) {
      act(() => {
        resolveFileAFetch(new Response(htmlA, { status: 200 }));
      });
      await act(async () => {
        await Promise.resolve();
      });
      // After the stale resolution, File A's HTML must still not appear in
      // any rendered element.
      expect(screen.queryByText(/FILE-A-HTML/)).toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // Settled sandbox-shim artifacts now use the daemon-guarded URL path. A
  // reload must keep that transport stable while the source probe is pending.
  // ---------------------------------------------------------------------------
  it('keeps the guarded URL iframe active while source is null after Reload', async () => {
    window.history.replaceState({}, '', '/');
    // sessionStorage requires the sandbox shim; persistent localStorage uses srcDoc.
    // Settled on-disk HTML can
    // receive that shim from the daemon without taking the srcDoc transport.
    const shimFile: ProjectFile = {
      name: 'app.html',
      path: 'app.html',
      type: 'file',
      size: 512,
      mtime: 1710000001,
      kind: 'html',
      mime: 'text/html',
    };
    const shimHtml =
      '<html><body><script>sessionStorage.setItem("key","val");</script><p>loaded</p></body></html>';

    // Step 1: mount with shimHtml and wait for the guarded URL lane.
    vi.stubGlobal('fetch', fetchReturning(shimHtml));

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={shimFile}
      />,
    );

    // Wait for the source fetch to resolve so the component has non-null source.
    await waitFor(() => {
      const frame = screen.queryByTestId('artifact-preview-frame');
      expect(frame).not.toBeNull();
      expect((frame as HTMLIFrameElement).getAttribute('data-pixo-render-mode')).toBe('url-load');
      expect((frame as HTMLIFrameElement).getAttribute('src')).toContain('pixoPreviewBridge=sandbox');
    });

    // Step 2: click Reload. The source probe is deferred so we observe the
    // intermediate source=null window.
    const { handle: reloadHandle, stub: reloadStub } = deferredFetch();
    vi.stubGlobal('fetch', reloadStub);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // Step 3: the same URL transport remains active; it must not fall through
    // to the dormant srcDoc/bootstrap iframe while the probe is pending.
    const activeFrame = screen.getByTestId('artifact-preview-frame');
    expect(activeFrame.getAttribute('data-pixo-render-mode')).toBe('url-load');
    expect(activeFrame.getAttribute('data-pixo-active')).toBe('true');
    expect(activeFrame.getAttribute('src')).toContain('pixoPreviewBridge=sandbox');

    const srcDocFrame = screen.queryByTestId('artifact-preview-frame-srcdoc');
    expect(srcDocFrame?.getAttribute('data-pixo-active')).toBe('false');

    // Drain the deferred fetch so it doesn't leak into subsequent tests.
    await act(async () => {
      reloadHandle.resolve(shimHtml);
      await Promise.resolve();
    });
  });

  it('keeps a 43-file Babel prototype on the guarded real-URL transport', async () => {
    window.history.replaceState({}, '', '/');
    const externalScripts = Array.from(
      { length: 43 },
      (_, index) => `<script type="text/babel" src="./components/screen-${index + 1}.jsx"></script>`,
    ).join('');
    const html = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="./styles/app.css">',
      '<script src="./scripts/support.js"></script>',
      externalScripts,
      '<script type="module" src="./scripts/module.js"></script>',
      '</head><body>',
      '<img src="./assets/card.svg" srcset="./assets/card.svg 1x, ./assets/card@2x.svg 2x">',
      '<main id="root"></main>',
      '</body></html>',
    ].join('');
    vi.stubGlobal('fetch', fetchReturning(html));

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={{
          name: 'prototypes/booking/index.html',
          path: 'prototypes/booking/index.html',
          type: 'file',
          size: 64 * 1024,
          mtime: 1710000002,
          kind: 'html',
          mime: 'text/html',
        }}
      />,
    );

    await waitFor(() => {
      const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(frame.getAttribute('data-pixo-render-mode')).toBe('url-load');
      expect(frame.getAttribute('data-pixo-active')).toBe('true');
      const src = new URL(frame.getAttribute('src') ?? '', 'http://localhost');
      expect(src.pathname).toBe('/api/projects/project-1/raw/prototypes/booking/index.html');
      expect(src.searchParams.getAll('pixoPreviewBridge')).toEqual([
        'scroll',
        'snapshot',
        'observability',
        'sandbox',
        'focus',
      ]);
      expect(src.searchParams.getAll('pixoPreviewBridge')).not.toContain('redirect');
    });

    expect(screen.getByTestId('artifact-preview-frame-srcdoc').getAttribute('data-pixo-active')).toBe('false');
  });

  // ---------------------------------------------------------------------------
  // Race 3: stale snapshot must not survive an identity-mismatched fetch
  // ---------------------------------------------------------------------------
  it('does not restore the reload snapshot on a later normal failed load after an identity-mismatched fetch left the ref un-cleared', async () => {
    const fileA = deckFile({ name: 'deck-a.html', path: 'deck-a.html' });
    const fileB = deckFile({ name: 'deck-b.html', path: 'deck-b.html' });

    const RAW_A = `/api/projects/project-1/raw/deck-a.html`;
    const RAW_B = `/api/projects/project-1/raw/deck-b.html`;

    const htmlA = deckHtml('V1-CONTENT');

    // Step 1: mount with File A and wait for "V1-CONTENT" to appear.
    vi.stubGlobal('fetch', fetchReturning(htmlA));

    const { rerender } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={fileA}
      />,
    );

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('V1-CONTENT');
    });

    // Step 2: click Reload on File A.
    // prevSourceBeforeReloadRef is now { source: htmlA, projectId, fileName: 'deck-a.html' }.
    // source goes null; fetch for A is in flight (deferred).
    let resolveFileAReloadFetch!: (resp: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_A)) {
          return new Promise<Response>((ok) => {
            resolveFileAReloadFetch = ok;
          });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // Step 3: switch to File B while the File A reload fetch is still in
    // flight.  File B's fetch returns null (500) immediately, triggering the
    // identity-mismatch branch.  On the buggy implementation the mismatch
    // branch returns early WITHOUT clearing prevSourceBeforeReloadRef, leaving
    // the stale snapshot armed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_B)) {
          return new Response('', { status: 500 });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={fileB}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Step 4: switch back to File A.  File A's fetch returns null (500) — a
    // normal failed load, NOT a Reload click.  On the buggy implementation
    // prevSourceBeforeReloadRef is still non-null (leaked from step 2),
    // the identity check passes (projectId + fileName both match A again),
    // and the snapshot "V1-CONTENT" is incorrectly restored into the srcdoc.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_A)) {
          return new Response('', { status: 500 });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={fileA}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // --- KEY ASSERTION ---
    // The stale snapshot must NOT be restored. Revisiting a file that loaded
    // earlier deliberately skips the loading skeleton, but its old iframe must
    // still stay empty after the new read fails.
    // On the buggy branch the leaked ref satisfies the identity check and
    // setSource(snap.source) is called, surfacing "V1-CONTENT" instead of the
    // empty preview.
    expect(screen.getByTestId('artifact-preview-frame')).toHaveAttribute('srcdoc', '');

    // Also confirm the stale HTML is not present anywhere in the rendered DOM.
    expect(screen.queryByText(/V1-CONTENT/)).toBeNull();

    // Drain the in-flight File A reload fetch so it doesn't leak into other
    // tests (it was started in step 2 and never resolved).
    if (resolveFileAReloadFetch) {
      act(() => {
        resolveFileAReloadFetch(new Response('', { status: 500 }));
      });
      await act(async () => {
        await Promise.resolve();
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Race P2 (Codex P2 #5): canceled-fetch ref leak
  //
  // Sequence:
  //   1. Mount file A ("A-V1"), wait for it to load.
  //   2. Click Reload on A — prevSourceBeforeReloadRef captures {A, A-V1},
  //      source goes null, A-reload fetch is in flight (deferred).
  //   3. Switch to file B — A's in-flight fetch is canceled (cancelled=true);
  //      the .then() callback returns early without touching the ref, so
  //      prevSourceBeforeReloadRef remains armed with the A-V1 snapshot.
  //   4. Switch back to A before B's fetch resolves (B fetch also deferred) —
  //      B's fetch is also canceled (cancelled=true), ref still armed.
  //   5. A's new fetch returns null (500) — a normal failed load, NOT a
  //      Reload click.  On the buggy build the identity check passes
  //      (snap.fileName='deck-a.html' === file.name='deck-a.html') and
  //      setSource(snap.source) restores "A-V1" from the stale snapshot.
  //
  // The fix: clear prevSourceBeforeReloadRef in the [projectId, file.name]
  // effect (the per-file reset that also clears sourceEverLoadedRef), so the
  // ref cannot outlive a file-identity change regardless of fetch-cancel order.
  // ---------------------------------------------------------------------------
  it('does not restore the reload snapshot on a normal failed load after B fetch was canceled and the ref was never cleared by a callback', async () => {
    const fileA = deckFile({ name: 'deck-a.html', path: 'deck-a.html' });
    const fileB = deckFile({ name: 'deck-b.html', path: 'deck-b.html' });

    const RAW_A = `/api/projects/project-1/raw/deck-a.html`;
    const RAW_B = `/api/projects/project-1/raw/deck-b.html`;

    const htmlA = deckHtml('A-V1-CONTENT');

    // Step 1: mount with File A and wait for "A-V1-CONTENT" to appear.
    vi.stubGlobal('fetch', fetchReturning(htmlA));

    const { rerender } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={fileA}
      />,
    );

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('A-V1-CONTENT');
    });

    // Step 2: click Reload on File A.
    // prevSourceBeforeReloadRef now = { source: htmlA, projectId, fileName: 'deck-a.html' }.
    // source goes null; A-reload fetch deferred (in flight, never resolved).
    let resolveAReloadFetch!: (resp: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_A)) {
          return new Promise<Response>((ok) => {
            resolveAReloadFetch = ok;
          });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // Step 3: switch to file B while A-reload fetch is still in flight.
    // B's fetch is also deferred — it will never resolve in this test.
    // Switching files sets cancelled=true for A's fetch; the .then() callback
    // skips all branches (returns at "if (cancelled) return") so the ref stays
    // armed.  The [projectId, file.name] effect runs and resets
    // sourceEverLoadedRef (and lastGoodSourceForRoutingRef) — but on the buggy
    // build it does NOT clear prevSourceBeforeReloadRef.
    let resolveBFetch!: (resp: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_B)) {
          return new Promise<Response>((ok) => {
            resolveBFetch = ok;
          });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={fileB}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Step 4: switch back to File A before B's fetch resolves.
    // B's fetch is canceled (cancelled=true for B's effect cleanup).
    // A's new fetch returns null (500) immediately — this is a NORMAL failed
    // load, not a Reload-triggered fetch.  The Reload button was NOT clicked.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url.startsWith(RAW_A)) {
          return new Response('', { status: 500 });
        }
        return new Response('', { status: 404 });
      }),
    );

    act(() => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={fileA}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // --- KEY ASSERTION ---
    // No Reload click happened for this A load.  prevSourceBeforeReloadRef
    // must have been invalidated when the file identity changed (A→B step 3
    // or B→A step 4).  A normal 500 response must NOT restore "A-V1-CONTENT".
    //
    // On the buggy build: the ref was left armed by the canceled-fetch path
    // (B's .then() never ran), the identity check passes (A===A), and
    // setSource(snap.source) wrongly surfaces "A-V1-CONTENT" in the srcdoc.
    // Revisiting A does not flash the loading skeleton, so the invariant here
    // is that the iframe stays empty and its stale content does not return.
    expect(screen.getByTestId('artifact-preview-frame')).toHaveAttribute('srcdoc', '');
    expect(screen.queryByText(/A-V1-CONTENT/)).toBeNull();

    // Drain deferred fetches so they don't leak into subsequent tests.
    if (resolveAReloadFetch) {
      act(() => {
        resolveAReloadFetch(new Response('', { status: 500 }));
      });
      await act(async () => {
        await Promise.resolve();
      });
    }
    if (resolveBFetch) {
      act(() => {
        resolveBFetch(new Response('', { status: 500 }));
      });
      await act(async () => {
        await Promise.resolve();
      });
    }
  });
});
