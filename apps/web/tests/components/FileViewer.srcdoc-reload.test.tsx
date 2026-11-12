// @vitest-environment jsdom
// Regression test for issue #4650:
// Reload button is a no-op on the srcDoc render path (deck / inspect / comment / tweaks).
//
// Root cause: `reloadKey` is not in the `srcDoc` useMemo deps, and `source`
// state is not cleared synchronously before the async re-fetch resolves.
// As a result, clicking Reload leaves stale content in the iframe srcdoc
// attribute until something else forces a re-render.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

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
      kind: 'html',
      title: 'Deck',
      entry: 'deck.html',
      renderer: 'html',
      exports: ['html'],
    },
    ...overrides,
  };
}

// Builds a minimal two-slide deck HTML body.  The `label` arg is embedded in
// the first slide so we can search the srcdoc attribute for it.
function deckHtml(label: string): string {
  return `<html><body><section class="slide"><h1>${label}</h1></section><section class="slide"><p>two</p></section></body></html>`;
}

// Produces the URL that fetchProjectFileText calls for this file.
const DECK_RAW_URL = '/api/projects/project-1/raw/deck.html';

// Returns a Fetch mock that resolves requests to `DECK_RAW_URL` with `html`
// and returns 404 for everything else.
function fetchReturning(html: string) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith(DECK_RAW_URL)) {
      return new Response(html, { status: 200 });
    }
    return new Response('', { status: 404 });
  });
}

// Returns the srcdoc iframe that is active when useUrlLoadPreview === false.
// In deck mode the element has data-testid="artifact-preview-frame".
function srcDocFrame(): HTMLIFrameElement {
  return screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
}

describe('FileViewer srcDoc-path Reload regression (#4650)', () => {

  it('updates iframe srcdoc with new file content when file is byte-equal on re-fetch and Reload is clicked', async () => {
    // This test covers the byte-equal scenario: the agent edits the file but
    // the re-fetched bytes happen to match the previously loaded bytes (e.g.
    // the edit was reverted, or the HTTP cache returned the old response).
    //
    // `reloadKey` is not in the `srcDoc` useMemo deps, so even though the
    // effect re-fetches with a cache-bust URL, `setSource(sameText)` is a
    // React state no-op → memo doesn't recompute → `srcDocTransportResetKey`
    // has remounted a NEW iframe DOM node, but that new node receives the
    // same stale srcdoc string.
    //
    // The fix must ensure reloadKey is included in the srcDoc memo deps so
    // the memo recomputes (yielding an invalidated DOM attribute) even when
    // previewSource bytes didn't change.

    const html = deckHtml('same-content');
    vi.stubGlobal('fetch', fetchReturning(html));

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile()}
      />,
    );

    // Wait for the initial srcDoc.
    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('same-content');
    });

    const frameBeforeReload = srcDocFrame();
    const srcDocBeforeReload = frameBeforeReload.getAttribute('srcDoc') ?? '';

    // Click Reload; fetch returns byte-equal content.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // Wait for the re-fetch to resolve (fetch mock still returns same html).
    await act(async () => {
      await Promise.resolve();
    });

    // After Reload the iframe must be a new DOM node (srcDocTransportResetKey
    // bumped), and its srcdoc attribute must reflect a fresh recomputation
    // driven by the new reloadKey value — even though the HTML string itself
    // is identical.  A correct implementation embeds reloadKey in the srcdoc
    // memo deps so the memo is invalidated on every reload click.
    //
    // On the unfixed branch this assertion fails because:
    //   1. reloadKey is NOT in srcDoc memo deps.
    //   2. setSource(sameHtml) is a React state no-op.
    //   3. The memo is never invalidated.
    //   4. The new iframe DOM node receives the SAME srcdoc string it had
    //      before, so the attribute comparison is a byte-for-byte match.
    const frameAfterReload = srcDocFrame();
    expect(frameAfterReload).not.toBe(frameBeforeReload);
    expect(frameAfterReload.getAttribute('srcDoc') ?? '').not.toBe(srcDocBeforeReload);
  });
});
