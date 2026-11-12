// @vitest-environment jsdom

import { webcrypto } from 'node:crypto';
import { join } from 'node:path';
import { useLayoutEffect, useRef, useState, } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { saveTemplateMock } = vi.hoisted(() => ({
  saveTemplateMock: vi.fn(),
}));

// Shared analytics spy so deck-tracking tests can assert the exact
// (eventName, props) pairs FileViewer emits. The real provider returns a
// no-op `track` outside a provider tree, so swapping in a spy changes no
// behavior for the rest of the suite — it just records calls.
const { analyticsTrackMock } = vi.hoisted(() => ({
  analyticsTrackMock: vi.fn(),
}));

const { safetyEventMock } = vi.hoisted(() => ({
  safetyEventMock: vi.fn(),
}));

vi.mock('../../src/analytics/provider', async () => {
  const actual = await vi.importActual<typeof import('../../src/analytics/provider')>(
    '../../src/analytics/provider',
  );
  return {
    ...actual,
    useAnalytics: () => ({
      track: analyticsTrackMock,
      setConsent: () => undefined,
      setIdentity: () => undefined,
      setConfigureGlobals: () => undefined,
      setUserId: () => undefined,
      anonymousId: 'test-anon',
      sessionId: 'test-session',
      newRequestId: () => 'test-request',
    }),
  };
});

vi.mock('../../src/analytics/error-tracking', () => ({
  reportSafetyEvent: safetyEventMock,
  reportClientMetricEvent: vi.fn(() => true),
}));

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    saveTemplate: saveTemplateMock,
  };
});

import {
  FileViewer,
  SvgViewer,
  desktopPreviewAutoFitZoomPercent,
  desktopPreviewDocumentContentWidth,
  effectivePreviewScale,
  previewOverlayTransform,
  previewMeasurementFrameIsUsable,
  resolveDesktopPreviewContentMeasurement,
  resolveDesktopPreviewZoomPercent,
} from '../../src/components/FileViewer';
import {
  IframeKeepAliveProvider,
  PooledIframe,
  previewIframeKeepAliveKey,
  useIframeKeepAlivePool,
} from '../../src/components/IframeKeepAlivePool';
import type { } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';
import { I18nProvider } from '../../src/i18n';
import { __resetPreviewIsolationCache } from '../../src/runtime/powered-preview';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

import {
  ProjectPreviewProvider,
  type ProjectPreviewContextValue,
} from "../../src/components/project-preview-context";

function projectWorkspaceCollabValue(
  workspaceContext: null | null,
): ProjectPreviewContextValue {
  return { projectResourceAuthority: 'local' };
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  __resetPreviewIsolationCache();
  // `useWorkspaceContext` caches the last resolved context at module scope so a
  // remount does not flash the signed-out state. Left alone, a test that signs
  // into a team would silently sign the NEXT test in too.

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  analyticsTrackMock.mockReset();
  safetyEventMock.mockReset();
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

function baseFile(overrides: Partial<ProjectFile>): ProjectFile {
  return {
    name: 'asset.png',
    path: 'asset.png',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'image',
    mime: 'image/png',
    ...overrides,
  };
}

function testRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function latestPreviewContentSizeRequest(source: Window) {
  const request = previewContentSizeRequests(source)
    .reverse()
    .find((data) => data.type === 'pixo:preview-content-size-request');
  if (!request?.measurementId || !request.generation) {
    throw new Error('Expected a witnessed preview content-size request');
  }
  return request;
}

function previewContentSizeRequests(source: Window) {
  const postMessage = source.postMessage as ReturnType<typeof vi.fn>;
  return [...postMessage.mock.calls]
    .map(([data]) => data as {
      type?: string;
      measurementId?: string;
      generation?: string;
      documentEpoch?: string;
      canvasWidth?: number;
      previewScale?: number;
    })
    .filter((data) => data.type === 'pixo:preview-content-size-request');
}

function postPreviewContentSizeResponse(
  source: Window,
  request: { measurementId?: string; generation?: string; documentEpoch?: string },
  scrollWidth: number,
  clientWidth: number,
) {
  window.dispatchEvent(new MessageEvent('message', {
    source,
    data: {
      type: 'pixo:preview-content-size',
      measurementId: request.measurementId,
      generation: request.generation,
      documentEpoch: request.documentEpoch,
      scrollWidth,
      clientWidth,
    },
  }));
}

async function openUnifiedExportTab() {
  // Export is a standalone header button now (no tab strip inside the popover).
  fireEvent.click(await screen.findByRole('button', { name: /export/i }));
}

describe('FileViewer preview scale', () => {
  it('keeps responsive previews at 100% and fits true fixed-width overflow', () => {
    const responsive = resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-responsive',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        canvasWidth: 964,
        previewScale: 1,
      },
      response: {
        measurementId: 'measure-responsive',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        scrollWidth: 964,
        clientWidth: 964,
      },
      currentGeneration: 'generation-1',
      latestMeasurementId: 'measure-responsive',
      currentCanvasWidth: 964,
      currentPreviewScale: 1,
      confirmedContentWidth: null,
    });
    expect(responsive).toEqual({
      action: 'accept',
      contentWidth: 964,
      measuredClientWidth: 964,
      overflow: false,
    });
    expect(desktopPreviewAutoFitZoomPercent(
      { width: 964, height: 710 },
      responsive.action === 'accept' ? responsive.contentWidth : null,
    )).toBe(100);

    const fixedWidth = resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-fixed',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        canvasWidth: 964,
        previewScale: 1,
      },
      response: {
        measurementId: 'measure-fixed',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        scrollWidth: 1440,
        clientWidth: 964,
      },
      currentGeneration: 'generation-1',
      latestMeasurementId: 'measure-fixed',
      currentCanvasWidth: 964,
      currentPreviewScale: 1,
      confirmedContentWidth: null,
    });
    expect(fixedWidth).toEqual({
      action: 'accept',
      contentWidth: 1440,
      measuredClientWidth: 964,
      overflow: true,
    });
    expect(desktopPreviewAutoFitZoomPercent(
      { width: 964, height: 710 },
      fixedWidth.action === 'accept' ? fixedWidth.contentWidth : null,
    ))
      .toBeCloseTo(66.9444, 3);
  });

  it('rejects scaled viewport-floor feedback instead of collapsing auto-fit to 1%', () => {
    const polluted = resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-scaled',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        canvasWidth: 964,
        previewScale: 0.669444,
      },
      response: {
        measurementId: 'measure-scaled',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        scrollWidth: 96_400,
        clientWidth: 96_400,
      },
      currentGeneration: 'generation-1',
      latestMeasurementId: 'measure-scaled',
      currentCanvasWidth: 964,
      currentPreviewScale: 0.669444,
      confirmedContentWidth: 1440,
      confirmedOverflow: true,
    });

    expect(polluted).toEqual({ action: 'preserve' });
    expect(desktopPreviewAutoFitZoomPercent({ width: 964, height: 710 }, 1440))
      .toBeCloseTo(66.9444, 3);
  });

  it('ignores stale measurements and rejects retained offscreen 1px preview frames', () => {
    const stale = resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-old',
        generation: 'generation-old',
        documentEpoch: 'document-old',
        canvasWidth: 964,
        previewScale: 1,
      },
      response: {
        measurementId: 'measure-old',
        generation: 'generation-old',
        documentEpoch: 'document-old',
        scrollWidth: 96_400,
        clientWidth: 96_400,
      },
      currentGeneration: 'generation-new',
      latestMeasurementId: 'measure-new',
      currentCanvasWidth: 964,
      currentPreviewScale: 1,
      confirmedContentWidth: 1440,
      confirmedOverflow: true,
    });
    expect(stale).toEqual({ action: 'ignore' });
    expect(resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-new-host-generation',
        generation: 'generation-new',
        documentEpoch: 'document-new',
        canvasWidth: 964,
        previewScale: 1,
      },
      response: {
        measurementId: 'measure-new-host-generation',
        generation: 'generation-new',
        documentEpoch: 'document-old',
        scrollWidth: 96_400,
        clientWidth: 96_400,
      },
      currentGeneration: 'generation-new',
      latestMeasurementId: 'measure-new-host-generation',
      currentCanvasWidth: 964,
      currentPreviewScale: 1,
      confirmedContentWidth: 1440,
      confirmedOverflow: true,
    })).toEqual({ action: 'ignore' });
    expect(resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-before-resize',
        generation: 'generation-new',
        documentEpoch: 'document-new',
        canvasWidth: 964,
        previewScale: 1,
      },
      response: {
        measurementId: 'measure-before-resize',
        generation: 'generation-new',
        documentEpoch: 'document-new',
        scrollWidth: 964,
        clientWidth: 964,
      },
      currentGeneration: 'generation-new',
      latestMeasurementId: 'measure-before-resize',
      currentCanvasWidth: 720,
      currentPreviewScale: 1,
      confirmedContentWidth: 964,
      confirmedOverflow: false,
    })).toEqual({ action: 'ignore' });

    expect(previewMeasurementFrameIsUsable({
      connected: true,
      active: true,
      frameRect: testRect(-99_532, 0, 1, 710),
      canvasRect: testRect(0, 0, 964, 710),
    })).toBe(false);
    expect(previewMeasurementFrameIsUsable({
      connected: true,
      active: true,
      frameRect: testRect(0, 0, 964, 710),
      canvasRect: testRect(0, 0, 964, 710),
    })).toBe(true);
  });

  it('does not chase viewport-relative overflow while scaled without a neutral witness', () => {
    const grown = resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-growth',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        canvasWidth: 964,
        previewScale: 0.669444,
      },
      response: {
        measurementId: 'measure-growth',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        scrollWidth: 1800,
        clientWidth: 1440,
      },
      currentGeneration: 'generation-1',
      latestMeasurementId: 'measure-growth',
      currentCanvasWidth: 964,
      currentPreviewScale: 0.669444,
      confirmedContentWidth: 1440,
      confirmedOverflow: true,
    });
    expect(grown).toEqual({ action: 'preserve' });

    const missingWitness = resolveDesktopPreviewContentMeasurement({
      request: {
        measurementId: 'measure-no-witness',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        canvasWidth: 964,
        previewScale: 0.5,
      },
      response: {
        measurementId: 'measure-no-witness',
        generation: 'generation-1',
        documentEpoch: 'document-1',
        scrollWidth: 1928,
        clientWidth: 1928,
      },
      currentGeneration: 'generation-1',
      latestMeasurementId: 'measure-no-witness',
      currentCanvasWidth: 964,
      currentPreviewScale: 0.5,
      confirmedContentWidth: null,
    });
    expect(missingWitness).toEqual({ action: 'remeasure-neutral' });
  });

  it('keeps file viewer selectors in the effective global stylesheet', () => {
    const css = readExpandedIndexCss();

    expect(css).toContain('.viewer');
    expect(css).toContain('.viewer-toolbar');
    expect(css).toContain('.viewer-action');
  });

  it('uses a layered skeleton for the initial preview loading state', () => {
    const css = readExpandedIndexCss();

    expect(css).toContain('.viewer-loading-stage');
    expect(css).toContain('aspect-ratio: 16 / 9;');
    expect(css).toContain('.viewer-loading-card-back-one');
    expect(css).toContain('.viewer-loading-card-main::before');
    expect(css).toContain('.viewer-loading-chart');
    expect(css).toContain('@keyframes pixo-viewer-loading-sweep');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.viewer-loading-stage,[\s\S]*animation: none;/,
    );
  });





  it('warms a newly retained inactive HTML viewer without forcing a GPU layer on activation', async () => {
    const file = baseFile({
      name: 'inactive-first-open.html',
      path: 'inactive-first-open.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Inactive first open',
        entry: 'inactive-first-open.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const rawReads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/raw/inactive-first-open.html')) {
        rawReads.push(url);
        return new Response('<html><body>Already warm</body></html>', { status: 200 });
      }
      return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
    }));
    const props = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      file,
    };
    const { container, rerender } = render(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'local',
      }}>
        <FileViewer {...props} workspaceActive={false} />
      </ProjectPreviewProvider>,
    );

    const retainedFrame = await waitFor(() => {
      expect(rawReads).toHaveLength(1);
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[data-testid="artifact-preview-frame-retained-inactive-first-open.html"], iframe[data-testid="artifact-preview-frame-srcdoc-retained-inactive-first-open.html"]',
      );
      expect(frame).not.toBeNull();
      return frame!;
    });
    expect(container.querySelector<HTMLElement>('.viewer-toolbar')?.style.visibility).toBe('hidden');
    expect(retainedFrame.style.visibility).toBe('');
    expect(retainedFrame.style.transform).toBe('');
    expect(retainedFrame.style.willChange).toBe('');
    expect(retainedFrame.dataset.pixoActive).toBe('true');

    rerender(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'local',
      }}>
        <FileViewer {...props} workspaceActive />
      </ProjectPreviewProvider>,
    );

    expect(document.querySelector('iframe[data-testid="artifact-preview-frame"]')).toBe(retainedFrame);
    expect(container.querySelector<HTMLElement>('.viewer-toolbar')?.style.visibility).toBe('');
    expect(retainedFrame.style.visibility).toBe('');
    expect(retainedFrame.style.transform).toBe('');
    expect(retainedFrame.style.willChange).toBe('');
    expect(rawReads).toHaveLength(1);
  });

  it('never downgrades denied project resources to local reads', async () => {
    const file = baseFile({
      name: 'authority.html',
      path: 'authority.html',
      mime: 'text/html',
      kind: 'html',
    });
    const rawReads: Array<{ init?: RequestInit; url: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/raw/authority.html')) {
        rawReads.push({ init, url });
        return new Response('<html><body>Authorized</body></html>', { status: 200 });
      }
      return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
    }));

    const denied = render(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'denied',
      }}>
        <FileViewer projectId="project-1" projectKind="prototype" file={file} />
      </ProjectPreviewProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rawReads).toEqual([]);
    expect(document.querySelector('.viewer-loading')).toBeNull();
    expect(screen.getByText(/Preview unavailable/)).toBeTruthy();
    denied.unmount();

    const local = render(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'local',
      }}>
        <FileViewer projectId="project-1" projectKind="prototype" file={file} />
      </ProjectPreviewProvider>,
    );
    await waitFor(() => expect(rawReads).toHaveLength(1));
    expect(rawReads[0]?.url).not.toContain('workspaceId=');
    expect(new Headers(rawReads[0]?.init?.headers).get('x-pixo-workspace-id')).toBeNull();

    local.rerender(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'denied',
      }}>
        <FileViewer projectId="project-1" projectKind="prototype" file={file} />
      </ProjectPreviewProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Preview unavailable/)).toBeTruthy());
    expect(rawReads).toHaveLength(1);
  });

  it('gates non-HTML resource URLs for pending and denied projects', () => {
    const file = baseFile({
      name: 'private.png',
      path: 'private.png',
      mime: 'image/png',
      kind: 'image',
    });
    const { rerender } = render(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),

        projectResourceAuthority: 'pending',
      }}>
        <FileViewer projectId="project-1" projectKind="prototype" file={file} />
      </ProjectPreviewProvider>,
    );
    expect(document.querySelector('.viewer-loading')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();

    rerender(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'denied',
      }}>
        <FileViewer projectId="project-1" projectKind="prototype" file={file} />
      </ProjectPreviewProvider>,
    );
    expect(document.querySelector('.viewer-loading')).toBeNull();
    expect(screen.getByText(/Preview unavailable/)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();

    rerender(
      <ProjectPreviewProvider value={{
        ...projectWorkspaceCollabValue(null),
        projectResourceAuthority: 'local',
      }}>
        <FileViewer projectId="project-1" projectKind="prototype" file={file} />
      </ProjectPreviewProvider>,
    );
    expect(screen.getByRole('img').getAttribute('src')).toContain(
      '/api/projects/project-1/raw/private.png',
    );
  });

  it('keeps the preview viewport trigger flat by default', () => {
    const css = readExpandedIndexCss();
    const rules = Array.from(css.matchAll(/\.viewer-viewport-trigger\s*\{[^}]+\}/g), (match) => match[0]);

    // Flat = no chip. Transparent fill + transparent border + no shadow; the
    // resting state must not read as a raised control sitting on the bar.
    expect(rules.some((rule) => rule.includes('background-color: transparent;'))).toBe(true);
    expect(rules.some((rule) => rule.includes('border-color: transparent;'))).toBe(true);
    expect(rules.some((rule) => rule.includes('box-shadow: none;'))).toBe(true);
    expect(rules.every((rule) => !rule.includes('box-shadow: var(--shadow-xs);'))).toBe(true);
    // …and it must hug its content so the label and chevron stay visible. A
    // fixed square hid the label and left an empty chip behind (issue: the
    // deck toolbar's "empty grey block").
    expect(rules.some((rule) => rule.includes('width: auto;'))).toBe(true);
    expect(rules.every((rule) => !rule.includes('width: 30px;'))).toBe(true);
  });

  it('keeps the draw toolbar floating without reserving preview space', () => {
    const css = readExpandedIndexCss();

    expect(css).not.toContain('--preview-draw-dock-clearance');
    expect(css).not.toContain('padding-bottom: var(--preview-draw-dock-clearance);');
  });

  it('uses the requested zoom for desktop preview overlays', () => {
    expect(effectivePreviewScale('desktop', 1.5, { width: 320, height: 480 })).toBe(1.5);
  });

  it('calculates a desktop auto-fit zoom for wide landing pages', () => {
    expect(desktopPreviewAutoFitZoomPercent({ width: 900, height: 700 })).toBe(100);
    expect(desktopPreviewAutoFitZoomPercent({ width: 900, height: 700 }, 1440)).toBeCloseTo(62.5);
    expect(desktopPreviewAutoFitZoomPercent({ width: 900, height: 700 }, 900)).toBe(100);
    expect(desktopPreviewAutoFitZoomPercent({ width: 1600, height: 900 }, 1440)).toBe(100);
  });

  it('measures desktop preview document content width from real iframe layout', () => {
    const doc = document.implementation.createHTMLDocument('preview');
    Object.defineProperty(doc.documentElement, 'scrollWidth', { configurable: true, value: 960 });
    Object.defineProperty(doc.body, 'scrollWidth', { configurable: true, value: 1440 });

    expect(desktopPreviewDocumentContentWidth(doc)).toBe(1440);
  });

  it('clamps mobile and tablet overlay scale to the iframe auto-fit scale', () => {
    expect(effectivePreviewScale('mobile', 1, { width: 390, height: 844 })).toBeLessThan(1);
    expect(effectivePreviewScale('tablet', 1.25, { width: 820, height: 700 })).toBeLessThan(1);
  });

  it('offsets tablet and mobile overlays to the centered viewport card', () => {
    expect(previewOverlayTransform('desktop', 1.25, { width: 1200, height: 800 })).toEqual({
      scale: 1.25,
      offsetX: 0,
      offsetY: 0,
    });

    expect(previewOverlayTransform('mobile', 1, { width: 1200, height: 1000 })).toEqual({
      scale: 1,
      offsetX: 405,
      offsetY: 24,
    });

    const tablet = previewOverlayTransform('tablet', 1.25, { width: 1200, height: 800 });
    expect(tablet.scale).toBeCloseTo(752 / 1180, 5);
    expect(tablet.offsetX).toBeCloseTo(24 + (1152 - 820 * (752 / 1180)) / 2, 5);
    expect(tablet.offsetY).toBe(24);
  });
});

describe('FileViewer JSON artifacts', () => {
  it('pretty-prints valid JSON in the text viewer', async () => {
    const file = baseFile({
      name: 'data.json',
      path: 'data.json',
      kind: 'code',
      mime: 'application/json',
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/data.json') {
        return new Response('{"title":"Launch Metrics","stats":{"views":42,"active":true}}');
      }
      return new Response('', { status: 404 });
    }));

    const { container } = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    await waitFor(() => {
      expect(container.querySelector('.lines')?.textContent).toBe(
        '{\n  "title": "Launch Metrics",\n  "stats": {\n    "views": 42,\n    "active": true\n  }\n}',
      );
    });
  });

  it('keeps raw JSON when pretty-printing would round an unsafe integer', async () => {
    const file = baseFile({
      name: 'data.json',
      path: 'data.json',
      kind: 'code',
      mime: 'application/json',
    });
    const rawJson = '{"id":9007199254740993,"name":"large"}';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/data.json') {
        return new Response(rawJson);
      }
      return new Response('', { status: 404 });
    }));

    const { container } = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    await waitFor(() => {
      const displayedText = container.querySelector('.lines')?.textContent ?? '';
      expect(displayedText).toBe(rawJson);
      expect(displayedText).toContain('9007199254740993');
      expect(displayedText).not.toContain('9007199254740992');
    });
  });

  it('keeps raw JSON when pretty-printing would round a high-precision decimal', async () => {
    const file = baseFile({
      name: 'data.json',
      path: 'data.json',
      kind: 'code',
      mime: 'application/json',
    });
    const rawJson = '{"ratio":0.1234567890123456789,"name":"precise"}';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/data.json') {
        return new Response(rawJson);
      }
      return new Response('', { status: 404 });
    }));

    const { container } = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    await waitFor(() => {
      const displayedText = container.querySelector('.lines')?.textContent ?? '';
      expect(displayedText).toBe(rawJson);
      expect(displayedText).toContain('0.1234567890123456789');
      expect(displayedText).not.toContain('0.12345678901234568');
    });
  });

  it('keeps raw JSON when pretty-printing would round a high-precision exponent', async () => {
    const file = baseFile({
      name: 'data.json',
      path: 'data.json',
      kind: 'code',
      mime: 'application/json',
    });
    const rawJson = '{"ratio":1.234567890123456789e2,"name":"precise"}';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/data.json') {
        return new Response(rawJson);
      }
      return new Response('', { status: 404 });
    }));

    const { container } = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    await waitFor(() => {
      const displayedText = container.querySelector('.lines')?.textContent ?? '';
      expect(displayedText).toBe(rawJson);
      expect(displayedText).toContain('1.234567890123456789e2');
      expect(displayedText).not.toContain('123.45678901234568');
    });
  });

  it('keeps raw JSON when pretty-printing would erase signed negative zero', async () => {
    const file = baseFile({
      name: 'data.json',
      path: 'data.json',
      kind: 'code',
      mime: 'application/json',
    });
    const rawJson = '{"delta":-0}';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/data.json') {
        return new Response(rawJson);
      }
      return new Response('', { status: 404 });
    }));

    const { container } = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    await waitFor(() => {
      const displayedText = container.querySelector('.lines')?.textContent ?? '';
      expect(displayedText).toBe(rawJson);
      expect(displayedText).toContain('-0');
      expect(displayedText).not.toContain('{"delta":0}');
    });
  });
});

describe('FileViewer SVG artifacts', () => {
  it('routes SVG artifacts to the SVG viewer instead of the generic image viewer', () => {
    const file = baseFile({
      name: 'diagram.svg',
      path: 'diagram.svg',
      mime: 'image/svg+xml',
      artifactManifest: {
        version: 1,
        kind: 'svg',
        title: 'Diagram',
        entry: 'diagram.svg',
        renderer: 'svg',
        exports: ['svg'],
      },
    });

    const markup = renderToStaticMarkup(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    expect(markup).toContain('class="viewer svg-viewer"');
    expect(markup).not.toContain('class="viewer image-viewer"');
    expect(markup).toContain('Preview');
    expect(markup).toContain('Code');
    expect(markup).toContain('src="/api/projects/project-1/raw/diagram.svg?v=1710000000&amp;r=0"');
  });

  it('keeps normal image artifacts on the existing image viewer path', () => {
    const file = baseFile({ name: 'photo.png', path: 'photo.png' });

    const markup = renderToStaticMarkup(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    expect(markup).toContain('class="viewer image-viewer"');
    expect(markup).not.toContain('class="viewer svg-viewer"');
    expect(markup).not.toContain('class="viewer-tabs"');
  });

  it('marks preview and source modes through the SVG viewer toggle controls', () => {
    const file = baseFile({ name: 'diagram.svg', path: 'diagram.svg', mime: 'image/svg+xml' });

    const previewMarkup = renderToStaticMarkup(
      <SvgViewer projectId="project-1" file={file} initialMode="preview" />,
    );
    const sourceMarkup = renderToStaticMarkup(
      <SvgViewer
        projectId="project-1"
        file={file}
        initialMode="source"
        initialSource="<svg><title>Diagram</title></svg>"
      />,
    );

    expect(previewMarkup).toContain('class="viewer-tab active" aria-pressed="true">Preview</button>');
    expect(previewMarkup).toContain('aria-pressed="false">Code</button>');
    expect(previewMarkup).toContain('<img');

    expect(sourceMarkup).toContain('aria-pressed="false">Preview</button>');
    expect(sourceMarkup).toContain('class="viewer-tab active" aria-pressed="true">Code</button>');
    expect(sourceMarkup).toContain('class="viewer-source"');
    expect(sourceMarkup).not.toContain('<img');
  });

  it('keeps a URL-loaded preview iframe alive while the viewer unmounts and remounts', () => {
    const file = baseFile({
      name: 'page.html',
      path: 'page.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'page.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    function Shell() {
      const [visible, setVisible] = useState(true);
      return (
        <IframeKeepAliveProvider>
          <button type="button" onClick={() => setVisible((next) => !next)}>
            {visible ? 'Leave project' : 'Return project'}
          </button>
          {visible ? (
            <FileViewer
              projectId="project-1"
              projectKind="prototype"
              file={file}
              liveHtml="<html><body>hi</body></html>"
            />
          ) : (
            <div data-testid="home-view" />
          )}
        </IframeKeepAliveProvider>
      );
    }

    const { container } = render(<Shell />);

    const firstFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(firstFrame.getAttribute('src')).toContain('/api/projects/project-1/raw/page.html?v=1710000000&r=0&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability&pixoPreviewEpoch=');
    const firstSrc = firstFrame.getAttribute('src');

    fireEvent.click(screen.getByRole('button', { name: 'Leave project' }));

    expect(screen.queryByTestId('artifact-preview-frame')).toBeNull();
    expect(screen.getByTestId('home-view')).toBeTruthy();
    const parkedFrame = container.querySelector<HTMLIFrameElement>('.iframe-keep-alive-pool iframe');
    expect(parkedFrame).toBe(firstFrame);
    expect(parkedFrame?.getAttribute('src')).toBe(firstFrame.getAttribute('src'));

    fireEvent.click(screen.getByRole('button', { name: 'Return project' }));

    expect(screen.getByTestId('artifact-preview-frame')).toBe(firstFrame);
    expect(firstFrame.getAttribute('src')).toBe(firstSrc);
  });



  it('promotes large HTML files to the srcDoc path when the routing preview shows sandbox-unsafe scripts', async () => {
    const file = baseFile({
      name: 'index.html',
      path: 'index.html',
      mime: 'text/html',
      kind: 'html',
      size: 3 * 1024 * 1024,
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Imported app',
        entry: 'index.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const previewText = '<!doctype html><html><head><script src="./app.js"></script></head>';
    let fullHtml = `${previewText}<body><main>Imported filesystem app</main></body></html>`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith('/api/projects/project-1/text-preview/index.html')) {
        return new Response(JSON.stringify({
          text: previewText,
          poweredPreview: { required: false, reasons: [] },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/api/projects/project-1/raw/index.html')) {
        return new Response(fullHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url === '/api/projects/project-1/files') {
        return new Response(JSON.stringify({ files: [file] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    await waitFor(() => {
      const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(frame.getAttribute('data-pixo-render-mode')).toBe('srcdoc');
      expect(frame.getAttribute('srcDoc')).toContain('Imported filesystem app');
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/projects/project-1/text-preview/index.html'), { cache: 'no-store' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/project-1/raw/index.html?cacheBust='),
      { cache: 'no-store' },
    );

    fullHtml = `${previewText}<body><main>Updated filesystem app</main></body></html>`;
    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={{ ...file, mtime: file.mtime + 1 }}
      />,
    );

    await waitFor(() => {
      const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(frame.getAttribute('data-pixo-render-mode')).toBe('srcdoc');
      expect(frame.getAttribute('srcDoc')).toContain('Updated filesystem app');
    });
  });

  it('evicts least-recent inactive preview iframes once the pool exceeds its limit', () => {
    function Harness({ activeKey }: { activeKey: string | null }) {
      return (
        <IframeKeepAliveProvider maxEntries={2}>
          {activeKey ? (
            <PooledIframe
              cacheKey={previewIframeKeepAliveKey('project-1', `${activeKey}.html`)}
              src={`/api/projects/project-1/raw/${activeKey}.html?v=1&r=0`}
              title={`${activeKey}.html`}
              sandbox="allow-scripts allow-downloads"
              data-testid="pooled-frame"
              data-pixo-render-mode="url-load"
              data-pixo-active="true"
            />
          ) : null}
        </IframeKeepAliveProvider>
      );
    }

    const { container, rerender } = render(<Harness activeKey="one" />);
    const firstFrame = screen.getByTestId('pooled-frame');
    rerender(<Harness activeKey={null} />);
    rerender(<Harness activeKey="two" />);
    const secondFrame = screen.getByTestId('pooled-frame');
    rerender(<Harness activeKey={null} />);
    rerender(<Harness activeKey="three" />);
    const thirdFrame = screen.getByTestId('pooled-frame');
    rerender(<Harness activeKey={null} />);

    const parkedFrames = Array.from(
      container.querySelectorAll<HTMLIFrameElement>('.iframe-keep-alive-pool iframe'),
    );
    expect(parkedFrames).toEqual([secondFrame, thirdFrame]);
    expect(parkedFrames).not.toContain(firstFrame);
  });

  it('recreates an evicted preview iframe at its artifact URL when revisited', () => {
    function Harness({ activeKey }: { activeKey: string | null }) {
      return (
        <IframeKeepAliveProvider maxEntries={1}>
          {activeKey ? (
            <PooledIframe
              cacheKey={previewIframeKeepAliveKey('project-1', `${activeKey}.html`)}
              src={`/api/projects/project-1/raw/${activeKey}.html?v=1&r=0`}
              title={`${activeKey}.html`}
              data-testid="pooled-frame"
              data-pixo-render-mode="url-load"
              data-pixo-active="true"
            />
          ) : null}
        </IframeKeepAliveProvider>
      );
    }

    const { rerender } = render(<Harness activeKey="one" />);
    const firstFrame = screen.getByTestId('pooled-frame') as HTMLIFrameElement;

    rerender(<Harness activeKey={null} />);
    rerender(<Harness activeKey="two" />);
    expect(document.body.contains(firstFrame)).toBe(false);

    rerender(<Harness activeKey={null} />);
    rerender(<Harness activeKey="one" />);
    const recreatedFrame = screen.getByTestId('pooled-frame') as HTMLIFrameElement;

    expect(recreatedFrame).not.toBe(firstFrame);
    expect(recreatedFrame.getAttribute('src')).toBe(
      '/api/projects/project-1/raw/one.html?v=1&r=0',
    );
  });

  it('parks a newly pooled iframe before starting its srcDoc navigation', () => {
    const originalSetAttribute = HTMLIFrameElement.prototype.setAttribute;
    const navigationAttributes: string[] = [];
    const setAttribute = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute')
      .mockImplementation(function setIframeAttribute(
        this: HTMLIFrameElement,
        name: string,
        value: string,
      ) {
        if (name === 'src' || name === 'srcdoc') navigationAttributes.push(name);
        return originalSetAttribute.call(this, name, value);
      });
    try {
      render(
        <IframeKeepAliveProvider>
          <PooledIframe
            cacheKey={previewIframeKeepAliveKey('project-1', 'deck.html')}
            src="about:blank"
            srcDoc="<!doctype html><html><body>Deck</body></html>"
            title="deck.html"
          />
        </IframeKeepAliveProvider>,
      );

      expect(navigationAttributes).toEqual(['src', 'srcdoc']);
    } finally {
      setAttribute.mockRestore();
    }
  });

  it('recreates a srcDoc preview iframe instead of parking its browsing context across project views', () => {
    const viewer = (
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={baseFile({
          name: 'deck.html',
          path: 'deck.html',
          mime: 'text/html',
          kind: 'html',
        })}
        liveHtml={'<!doctype html><html><body><main>Deck</main><script>location.reload()</script></body></html>'}
        workspaceActive
      />
    );
    const { container, rerender } = render(
      <IframeKeepAliveProvider>{viewer}</IframeKeepAliveProvider>,
    );
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const srcDoc = frame.srcdoc;
    const frameName = frame.name;

    rerender(<IframeKeepAliveProvider>{null}</IframeKeepAliveProvider>);
    expect(container.querySelector('.iframe-keep-alive-pool')?.contains(frame)).toBe(false);
    expect(frame.isConnected).toBe(false);

    rerender(<IframeKeepAliveProvider>{viewer}</IframeKeepAliveProvider>);
    const reactivatedFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(reactivatedFrame).not.toBe(frame);
    expect(reactivatedFrame.srcdoc).toBe(srcDoc);
    expect(reactivatedFrame.name).toBe(frameName);
  });

  it('does not cover non-empty srcDoc content while paint verification is pending', () => {
    const viewer = (
      <I18nProvider initial="zh-CN">
        <FileViewer
          projectId="first-paint-project"
          projectKind="prototype"
          file={baseFile({
            name: 'first-paint-deck.html',
            path: 'first-paint-deck.html',
            mime: 'text/html',
            kind: 'html',
          })}
          liveHtml={'<!doctype html><html><body><main>First paint</main><script>location.reload()</script></body></html>'}
          workspaceActive
        />
      </I18nProvider>
    );
    const { unmount } = render(viewer);
    expect(screen.queryByTestId('artifact-preview-first-load')).not.toBeInTheDocument();
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    const probe = postMessage.mock.calls.find(
      ([message]) => (message as { type?: unknown }).type === 'pixo:srcdoc-transport-ready-probe',
    )?.[0] as { generation?: string; probeId?: string } | undefined;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'pixo:srcdoc-transport-activated',
          generation: probe?.generation,
          probeId: probe?.probeId,
          bodyComplete: true,
        },
      }));
    });
    expect(screen.queryByTestId('artifact-preview-first-load')).not.toBeInTheDocument();

    unmount();
    render(viewer);
    expect(screen.queryByTestId('artifact-preview-first-load')).not.toBeInTheDocument();
  });

  it('uses a doctype-less Blob bootstrap to preserve quirks mode outside Electron', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:http://localhost/quirks-preview-bootstrap');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 Chrome/148.0');
    try {
      render(
        <FileViewer
          projectId="quirks-preview-project"
          projectKind="prototype"
          file={baseFile({
            name: 'quirks-preview.html',
            mime: 'text/html',
            kind: 'html',
          })}
          liveHtml={'<section><h2>Quirks preview</h2></section>'}
          workspaceActive
        />,
      );

      const srcDocFrame = screen.getByTestId('artifact-preview-frame-srcdoc') as HTMLIFrameElement;
      expect(srcDocFrame.getAttribute('src')).toBe('blob:http://localhost/quirks-preview-bootstrap');
      expect(srcDocFrame.hasAttribute('srcdoc')).toBe(false);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const bootstrapBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
      expect((await bootstrapBlob.text()).trimStart().startsWith('<!doctype')).toBe(false);
    } finally {
      userAgent.mockRestore();
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', {
          configurable: true,
          value: originalCreateObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }
    }
  });

  it('re-challenges the shared Electron shell when the same file tab changes projects', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:openpixo://app/shared-project-bootstrap');
    const postMessage = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('OpenPixo/0.20 Electron/41.3.0');
    const contentWindow = { postMessage } as unknown as Window;
    const contentWindowGetter = vi.spyOn(
      HTMLIFrameElement.prototype,
      'contentWindow',
      'get',
    ).mockReturnValue(contentWindow);
    try {
      const renderViewer = (projectId: string) => (
        <FileViewer
          projectId={projectId}
          projectKind="prototype"
          file={baseFile({
            name: 'index.html',
            path: 'index.html',
            mime: 'text/html',
            kind: 'html',
          })}
          liveHtml={'<!doctype html><html><body><main>Project preview</main><script>location.reload()</script></body></html>'}
          workspaceActive
        />
      );
      const { rerender } = render(renderViewer('project-a'));
      const firstFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      fireEvent.load(firstFrame);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pixo:srcdoc-transport-activate' }),
        '*',
      );

      postMessage.mockClear();
      rerender(renderViewer('project-b'));
      expect(screen.getByTestId('artifact-preview-frame')).not.toBe(firstFrame);
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'pixo:srcdoc-transport-shell-probe' },
        '*',
      );
    } finally {
      contentWindowGetter.mockRestore();
      userAgent.mockRestore();
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', {
          configurable: true,
          value: originalCreateObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }
      if (originalRevokeObjectURL) {
        Object.defineProperty(URL, 'revokeObjectURL', {
          configurable: true,
          value: originalRevokeObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    }
  });

  it('enforces the iframe pool limit when new active frames attach over parked entries', () => {
    function Frame({ name }: { name: string }) {
      return (
        <PooledIframe
          cacheKey={previewIframeKeepAliveKey('project-1', `${name}.html`)}
          src={`/api/projects/project-1/raw/${name}.html?v=1&r=0`}
          title={`${name}.html`}
          data-testid={`pooled-frame-${name}`}
        />
      );
    }
    function Harness({ names }: { names: string[] }) {
      return (
        <IframeKeepAliveProvider maxEntries={2}>
          {names.map((name) => <Frame key={name} name={name} />)}
        </IframeKeepAliveProvider>
      );
    }

    const { container, rerender } = render(<Harness names={['parked']} />);
    const parked = screen.getByTestId('pooled-frame-parked');
    rerender(<Harness names={[]} />);
    expect(container.querySelector('.iframe-keep-alive-pool iframe')).toBe(parked);

    rerender(<Harness names={['active-one', 'active-two']} />);

    expect(document.body.contains(parked)).toBe(false);
    expect(screen.getByTestId('pooled-frame-active-one')).toBeTruthy();
    expect(screen.getByTestId('pooled-frame-active-two')).toBeTruthy();
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
  });

  it('evicts inactive preview iframes for a project when the project is invalidated', () => {
    function Harness({ active }: { active: boolean }) {
      const pool = useIframeKeepAlivePool();
      return (
        <>
          <button type="button" onClick={() => pool.evictProject('project-1')}>
            Invalidate project
          </button>
          {active ? (
            <PooledIframe
              cacheKey={previewIframeKeepAliveKey('project-1', 'page.html')}
              src="/api/projects/project-1/raw/page.html?v=1&r=0"
              title="page.html"
              sandbox="allow-scripts allow-downloads"
              data-testid="pooled-frame"
              data-pixo-render-mode="url-load"
              data-pixo-active="true"
            />
          ) : null}
        </>
      );
    }

    const { container, rerender } = render(
      <IframeKeepAliveProvider>
        <Harness active />
      </IframeKeepAliveProvider>,
    );
    const firstFrame = screen.getByTestId('pooled-frame');

    rerender(
      <IframeKeepAliveProvider>
        <Harness active={false} />
      </IframeKeepAliveProvider>,
    );
    expect(container.querySelector('.iframe-keep-alive-pool iframe')).toBe(firstFrame);

    fireEvent.click(screen.getByRole('button', { name: 'Invalidate project' }));

    expect(container.querySelector('.iframe-keep-alive-pool iframe')).toBeNull();
  });

  it('reattaches a fresh visible iframe after active project invalidation', () => {
    function Harness() {
      const pool = useIframeKeepAlivePool();
      return (
        <>
          <button
            type="button"
            onClick={() => pool.evictProject('project-1', { includeActive: true })}
          >
            Invalidate active project
          </button>
          <PooledIframe
            cacheKey={previewIframeKeepAliveKey('project-1', 'page.html')}
            src="/api/projects/project-1/raw/page.html?v=1&r=0"
            title="page.html"
            sandbox="allow-scripts allow-downloads"
            data-testid="pooled-frame"
            data-pixo-render-mode="url-load"
            data-pixo-active="true"
          />
        </>
      );
    }

    render(
      <IframeKeepAliveProvider>
        <Harness />
      </IframeKeepAliveProvider>,
    );
    const firstFrame = screen.getByTestId('pooled-frame');

    fireEvent.click(screen.getByRole('button', { name: 'Invalidate active project' }));

    const secondFrame = screen.getByTestId('pooled-frame');
    expect(secondFrame).not.toBe(firstFrame);
    expect(secondFrame.getAttribute('src')).toBe('/api/projects/project-1/raw/page.html?v=1&r=0');
  });

  it('URL-loads a plain HTML preview iframe instead of inlining via srcDoc', () => {
    const file = baseFile({
      name: 'page.html',
      path: 'page.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'page.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    const markup = renderToStaticMarkup(
      <FileViewer projectId="project-1" projectKind="prototype" file={file} liveHtml="<html><body>hi</body></html>" />,
    );

    expect(markup).toContain('data-testid="artifact-preview-frame"');
    expect(markup).toContain('data-pixo-render-mode="url-load"');
    expect(markup).toContain('data-pixo-render-mode="url-load" data-pixo-active="true"');
    expect(markup).toContain('data-pixo-render-mode="srcdoc" data-pixo-active="false"');
    expect(markup).toContain('src="/api/projects/project-1/raw/page.html?v=1710000000&amp;r=0&amp;pixoPreviewBridge=scroll&amp;pixoPreviewBridge=snapshot&amp;pixoPreviewBridge=observability&amp;pixoPreviewEpoch=preview-document-');
    expect(markup).toContain('sandbox="allow-scripts allow-forms allow-downloads"');
  });

  it('reloads a URL-loaded HTML preview with a new cache key without replacing the iframe', () => {
    const file = baseFile({
      name: 'page.html',
      path: 'page.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'page.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toContain('/api/projects/project-1/raw/page.html?v=1710000000&r=0&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability&pixoPreviewEpoch=');

    fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));

    const reloadedFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(reloadedFrame).toBe(frame);
    expect(reloadedFrame.getAttribute('src')).toContain('/api/projects/project-1/raw/page.html?v=1710000000&r=1&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability&pixoPreviewEpoch=');
  });

  it('keeps raw file-watch refresh measurements on the refreshed document epoch', async () => {
    const replaceMock = vi.fn();
    const frameWindows = new WeakMap<HTMLIFrameElement, Window>();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRectMock(this: HTMLElement) {
        if (
          this.classList.contains('viewer-body') ||
          this.classList.contains('preview-canvas') ||
          this instanceof HTMLIFrameElement
        ) {
          return testRect(0, 0, 900, 700);
        }
        return testRect(0, 0, 0, 0);
      });
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
      let fakeWindow = frameWindows.get(this);
      if (!fakeWindow) {
        fakeWindow = {
          document: document.implementation.createHTMLDocument('preview'),
          location: { replace: replaceMock },
          postMessage: vi.fn(),
        } as unknown as Window;
        frameWindows.set(this, fakeWindow);
      }
      return fakeWindow;
    });
    const file = baseFile({
      name: 'page.html',
      path: 'page.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'page.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const props = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      file,
      liveHtml: '<html><body><main style="min-width:1440px">Wide</main></body></html>',
    };
    const { rerender } = render(<FileViewer {...props} />);
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const initialEpoch = new URL(frame.src).searchParams.get('pixoPreviewEpoch');
    expect(initialEpoch).toMatch(/^preview-document-\d+$/);

    rerender(<FileViewer {...props} filesRefreshKey={7} />);

    await waitFor(() => expect(frame.getAttribute('src')).toContain('fr=7'));
    expect(replaceMock).not.toHaveBeenCalled();
    const refreshedUrl = new URL(frame.src, window.location.href);
    expect(refreshedUrl.pathname).toBe('/api/projects/project-1/raw/page.html');
    expect(refreshedUrl.searchParams.get('fr')).toBe('7');
    expect(refreshedUrl.searchParams.get('pixoPreviewEpoch')).toMatch(/^preview-document-\d+$/);
    expect(refreshedUrl.searchParams.get('pixoPreviewEpoch')).not.toBe(initialEpoch);

    frame.setAttribute('src', refreshedUrl.toString());
    fireEvent.load(frame);
    const previewWindow = frame.contentWindow!;
    const refreshedRequest = latestPreviewContentSizeRequest(previewWindow);
    expect(refreshedRequest.documentEpoch).toBe(refreshedUrl.searchParams.get('pixoPreviewEpoch'));
    act(() => postPreviewContentSizeResponse(previewWindow, refreshedRequest, 1440, 900));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '63%' })).toBeTruthy();
    });

  });

  it('applies a committed file-watch generation and refreshed mtime in one preview navigation', async () => {
    const replaceMock = vi.fn();
    const frameWindows = new WeakMap<HTMLIFrameElement, Window>();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
      let fakeWindow = frameWindows.get(this);
      if (!fakeWindow) {
        fakeWindow = {
          document: document.implementation.createHTMLDocument('preview'),
          location: { replace: replaceMock },
          postMessage: vi.fn(),
        } as unknown as Window;
        frameWindows.set(this, fakeWindow);
      }
      return fakeWindow;
    });
    const htmlFile = (mtime: number) => baseFile({
      name: 'watch-coalesce.html',
      path: 'watch-coalesce.html',
      mtime,
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Watch coalesce',
        entry: 'watch-coalesce.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const sharedProps = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      liveHtml: '<html><body>watch</body></html>',
    };
    const { rerender } = render(
      <FileViewer {...sharedProps} file={htmlFile(1_000)} filesRefreshKey={1} />,
    );
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const initialSrc = frame.getAttribute('src');
    const navigations: string[] = [];
    const observer = new MutationObserver(() => {
      navigations.push(frame.getAttribute('src') ?? '');
    });
    observer.observe(frame, { attributes: true, attributeFilter: ['src'] });

    rerender(<FileViewer {...sharedProps} file={htmlFile(2_000)} filesRefreshKey={2} />);
    await waitFor(() => expect(frame.getAttribute('src')).toContain('fr=2'));
    const refreshedSrc = frame.getAttribute('src');
    expect(refreshedSrc).not.toBe(initialSrc);
    expect(refreshedSrc).toContain('v=2000');
    expect(replaceMock).not.toHaveBeenCalled();

    // Re-rendering the same committed snapshot is inert.
    rerender(<FileViewer {...sharedProps} file={htmlFile(2_000)} filesRefreshKey={2} />);
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    observer.disconnect();
    expect(frame.getAttribute('src')).toBe(refreshedSrc);
    expect(new Set(navigations)).toEqual(new Set([refreshedSrc ?? '']));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('prewarms the latest file-watch refresh while retained and does not navigate on reactivation', async () => {
    const replaceMock = vi.fn();
    const frameWindows = new WeakMap<HTMLIFrameElement, Window>();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
      let fakeWindow = frameWindows.get(this);
      if (!fakeWindow) {
        fakeWindow = {
          document: document.implementation.createHTMLDocument('preview'),
          location: { replace: replaceMock },
          postMessage: vi.fn(),
        } as unknown as Window;
        frameWindows.set(this, fakeWindow);
      }
      return fakeWindow;
    });
    const file = baseFile({
      name: 'retained.html',
      path: 'retained.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Retained',
        entry: 'retained.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const props = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      file,
      liveHtml: '<html><body>retained</body></html>',
    };
    const { rerender } = render(<FileViewer {...props} />);
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const initialSrc = frame.getAttribute('src');
    replaceMock.mockClear();

    rerender(<FileViewer {...props} workspaceActive={false} filesRefreshKey={7} />);
    rerender(<FileViewer {...props} workspaceActive={false} filesRefreshKey={9} />);
    await waitFor(() => expect(frame.getAttribute('src')).toContain('fr=9'));
    const prewarmedSrc = frame.getAttribute('src');
    expect(prewarmedSrc).not.toBe(initialSrc);
    expect(replaceMock).not.toHaveBeenCalled();

    rerender(<FileViewer {...props} workspaceActive filesRefreshKey={9} />);
    expect(frame.getAttribute('src')).toBe(prewarmedSrc);
    expect(replaceMock).not.toHaveBeenCalled();

    rerender(<FileViewer {...props} workspaceActive={false} filesRefreshKey={9} />);
    rerender(<FileViewer {...props} workspaceActive filesRefreshKey={9} />);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('keeps file action nodes mounted while a retained viewer becomes inactive', async () => {
    const chromeActionsHost = document.createElement('div');
    chromeActionsHost.id = 'app-chrome-file-actions';
    chromeActionsHost.dataset.appChromeFileActions = 'true';
    document.body.appendChild(chromeActionsHost);
    const file = baseFile({
      name: 'toolbar-owner.html',
      path: 'toolbar-owner.html',
      mime: 'text/html',
      kind: 'html',
    });
    const props = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      file,
      liveHtml: '<html><body>toolbar owner</body></html>',
    };

    try {
      const { rerender } = render(<FileViewer {...props} workspaceActive />);
      const owner = await waitFor(() => {
        const node = chromeActionsHost.querySelector<HTMLElement>(
          '[data-pixo-file-actions-owner="toolbar-owner.html"]',
        );
        expect(node).not.toBeNull();
        return node!;
      });

      rerender(<FileViewer {...props} workspaceActive={false} />);

      expect(chromeActionsHost.contains(owner)).toBe(true);
      expect(owner.style.display).toBe('none');
    } finally {
      chromeActionsHost.remove();
    }
  });

  it('prewarms simultaneous mtime and file-watch updates while retained, then reactivates without navigation', async () => {
    const replaceMock = vi.fn();
    const frameWindows = new WeakMap<HTMLIFrameElement, Window>();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
      let fakeWindow = frameWindows.get(this);
      if (!fakeWindow) {
        fakeWindow = {
          document: document.implementation.createHTMLDocument('preview'),
          location: { replace: replaceMock },
          postMessage: vi.fn(),
        } as unknown as Window;
        frameWindows.set(this, fakeWindow);
      }
      return fakeWindow;
    });
    const htmlFile = (mtime: number) => baseFile({
      name: 'retained-version.html',
      path: 'retained-version.html',
      mtime,
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Retained version',
        entry: 'retained-version.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const sharedProps = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      liveHtml: '<html><body>retained</body></html>',
    };
    const { rerender } = render(
      <FileViewer {...sharedProps} file={htmlFile(1_000)} filesRefreshKey={1} />,
    );
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const initialSrc = frame.getAttribute('src');
    replaceMock.mockClear();

    rerender(
      <FileViewer
        {...sharedProps}
        file={htmlFile(2_000)}
        filesRefreshKey={7}
        workspaceActive={false}
      />,
    );
    rerender(
      <FileViewer
        {...sharedProps}
        file={htmlFile(3_000)}
        filesRefreshKey={9}
        workspaceActive={false}
      />,
    );
    await waitFor(() => expect(frame.getAttribute('src')).toContain('fr=9'));

    expect(document.querySelector('iframe[title="retained-version.html"]')).toBe(frame);
    const prewarmedSrc = String(frame.getAttribute('src'));
    expect(prewarmedSrc).not.toBe(initialSrc);
    expect(prewarmedSrc).toContain('v=3000');
    expect(prewarmedSrc).toContain('fr=9');
    expect(replaceMock).not.toHaveBeenCalled();

    rerender(
      <FileViewer
        {...sharedProps}
        file={htmlFile(3_000)}
        filesRefreshKey={9}
        workspaceActive
      />,
    );
    expect(frame.getAttribute('src')).toBe(prewarmedSrc);
    expect(replaceMock).not.toHaveBeenCalled();

    rerender(
      <FileViewer
        {...sharedProps}
        file={htmlFile(3_000)}
        filesRefreshKey={9}
        workspaceActive={false}
      />,
    );
    rerender(
      <FileViewer
        {...sharedProps}
        file={htmlFile(3_000)}
        filesRefreshKey={9}
        workspaceActive
      />,
    );
    await Promise.resolve();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('keeps powered HTML previews on the powered URL when file-watch refreshes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const replaceMock = vi.fn();
    const frameWindows = new WeakMap<HTMLIFrameElement, Window>();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRectMock(this: HTMLElement) {
        if (
          this.classList.contains('viewer-body') ||
          this.classList.contains('preview-canvas') ||
          this instanceof HTMLIFrameElement
        ) {
          return testRect(0, 0, 900, 700);
        }
        return testRect(0, 0, 0, 0);
      });
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
      let fakeWindow = frameWindows.get(this);
      if (!fakeWindow) {
        fakeWindow = {
          document: document.implementation.createHTMLDocument('preview'),
          location: { replace: replaceMock },
          postMessage: vi.fn(),
        } as unknown as Window;
        frameWindows.set(this, fakeWindow);
      }
      return fakeWindow;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (url === '/api/preview/isolation') {
        return new Response(JSON.stringify({
          supported: true,
          projectOrigins: true,
          baseOrigin: 'http://127.0.0.1:43111',
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    }));

    const file = baseFile({
      name: 'worker.html',
      path: 'worker.html',
      mime: 'text/html',
      kind: 'html',
      mtime: 1000,
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Worker Preview',
        entry: 'worker.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const workerHtml = '<!doctype html><html><body><script>new Worker("worker.js")</script></body></html>';
    const poweredSrc = 'http://pixo-a33e35d302125bbd8e647043a4025b29.localhost:43111/api/projects/project-1/powered/worker.html?v=1000&r=0&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability';

    const { rerender } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml={workerHtml}
      />,
    );

    await waitFor(() => {
      const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(frame.getAttribute('data-pixo-powered')).toBe('true');
      expect(frame.getAttribute('src')).toContain(`${poweredSrc}&pixoPreviewEpoch=`);
    });
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const initialEpoch = new URL(frame.src).searchParams.get('pixoPreviewEpoch');
    expect(initialEpoch).toMatch(/^preview-document-\d+$/);

    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        filesRefreshKey={7}
        liveHtml={workerHtml}
      />,
    );

    await waitFor(() => expect(frame.getAttribute('src')).toContain('fr=7'));
    expect(replaceMock).not.toHaveBeenCalled();
    const refreshedUrl = new URL(frame.src);
    expect(refreshedUrl.pathname).toBe('/api/projects/project-1/powered/worker.html');
    expect(refreshedUrl.searchParams.get('fr')).toBe('7');
    expect(refreshedUrl.searchParams.get('pixoPreviewEpoch')).toMatch(/^preview-document-\d+$/);
    expect(refreshedUrl.searchParams.get('pixoPreviewEpoch')).not.toBe(initialEpoch);

    frame.setAttribute('src', refreshedUrl.toString());
    fireEvent.load(frame);
    const previewWindow = frame.contentWindow!;
    const refreshedRequest = latestPreviewContentSizeRequest(previewWindow);
    expect(refreshedRequest.documentEpoch).toBe(refreshedUrl.searchParams.get('pixoPreviewEpoch'));
    act(() => postPreviewContentSizeResponse(previewWindow, refreshedRequest, 1440, 900));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '63%' })).toBeTruthy();
    });

    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={{ ...file, mtime: 2000 }}
        filesRefreshKey={7}
        liveHtml={workerHtml}
      />,
    );

    await waitFor(() => {
      const nextRevisionFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      const nextRevisionUrl = new URL(nextRevisionFrame.src);
      expect(nextRevisionFrame.getAttribute('data-pixo-powered')).toBe('true');
      expect(nextRevisionUrl.origin).toBe('http://pixo-a33e35d302125bbd8e647043a4025b29.localhost:43111');
      expect(nextRevisionUrl.searchParams.get('v')).toBe('2000');
      expect(nextRevisionUrl.searchParams.get('fr')).toBeNull();
    });
    const nextRevisionFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    const nextRevisionEpoch = new URL(nextRevisionFrame.src).searchParams.get('pixoPreviewEpoch');
    expect(nextRevisionEpoch).not.toBe(refreshedUrl.searchParams.get('pixoPreviewEpoch'));

    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={{ ...file, mtime: 2000, size: file.size + 1 }}
        filesRefreshKey={7}
        liveHtml={workerHtml}
      />,
    );

    await waitFor(() => {
      const resizedRevisionFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      const resizedRevisionUrl = new URL(resizedRevisionFrame.src);
      expect(resizedRevisionFrame.getAttribute('data-pixo-powered')).toBe('true');
      expect(resizedRevisionUrl.origin).toBe('http://pixo-a33e35d302125bbd8e647043a4025b29.localhost:43111');
      expect(resizedRevisionUrl.searchParams.get('pixoPreviewEpoch')).not.toBe(nextRevisionEpoch);
    });
  });

  it('remounts the srcDoc HTML preview when reload is requested', () => {
    window.history.replaceState({}, '', '/?forceInline=1');
    const file = baseFile({
      name: 'deck.html',
      path: 'deck.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Deck',
        entry: 'deck.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml={'<html><body><section class="slide">one</section><section class="slide">two</section></body></html>'}
      />,
    );

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('data-pixo-render-mode')).toBe('srcdoc');

    fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));

    const reloadedFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(reloadedFrame).not.toBe(frame);
    expect(reloadedFrame.getAttribute('data-pixo-render-mode')).toBe('srcdoc');
  });

  it('offers image export for URL-loaded HTML previews', async () => {
    const file = baseFile({
      name: 'workspace.html',
      path: 'workspace.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Workspace',
        entry: 'workspace.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body><main>Workspace</main></body></html>"
      />,
    );

    expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).getAttribute('data-pixo-render-mode')).toBe('url-load');

    await openUnifiedExportTab();

    expect(screen.getByRole('menuitem', { name: /export as image/i })).toBeTruthy();
  });

  it('renders sandbox-shim artifacts on the srcdoc transport without entering edit mode (#2791)', () => {
    const file = baseFile({
      name: 'search.html',
      path: 'search.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Search',
        entry: 'search.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml='<html><body><script src="app.js"></script><main data-pixo-id="results">Results</main></body></html>'
      />,
    );

    const srcDocFrame = container.querySelector('iframe[data-pixo-render-mode="srcdoc"]') as HTMLIFrameElement | null;
    expect(srcDocFrame?.getAttribute('data-pixo-active')).toBe('true');
    expect(srcDocFrame?.srcdoc).toContain('data-pixo-id="results"');
    expect(srcDocFrame?.srcdoc).not.toContain('data-pixo-lazy-srcdoc-transport');
    expect(srcDocFrame?.srcdoc).toContain('data-pixo-sandbox-shim');
  });

  it('retains the opaque storage shim when the isolated preview origin is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={baseFile({ name: 'saved-form.html', path: 'saved-form.html', mime: 'text/html', kind: 'html', artifactManifest: {
          version: 1, kind: 'html', title: 'Saved tasks', entry: 'saved-form.html', renderer: 'html', exports: ['html'],
        } })}
        liveHtml='<html><body><h1>Saved tasks</h1><script>localStorage.getItem("tasks")</script></body></html>'
      />,
    );
    const frame = container.querySelector('iframe[data-pixo-active="true"]') as HTMLIFrameElement;
    expect(frame.getAttribute('data-pixo-render-mode')).toBe('srcdoc');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    await waitFor(() => {
      const activation = postMessage.mock.calls.map(([message]) => message)
        .find(message => message.type === 'pixo:srcdoc-transport-activate');
      expect(activation?.html).toContain('data-pixo-sandbox-shim');
      expect(activation?.html).toContain('localStorage.getItem');
    });
  });

  it('uses an absolute personal-project base for injected Electron previews', () => {
    const file = baseFile({
      name: 'pages/index.html',
      path: 'pages/index.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'pages/index.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml='<html><head><link rel="stylesheet" href="app.css"></head><body><script src="app.js"></script><main>Preview</main></body></html>'
      />,
    );

    const srcDocFrame = container.querySelector(
      'iframe[data-pixo-render-mode="srcdoc"]',
    ) as HTMLIFrameElement | null;
    expect(srcDocFrame?.getAttribute('data-pixo-active')).toBe('true');
    expect(srcDocFrame?.srcdoc).toContain(
      '<base href="http://localhost:3000/api/projects/project-1/raw/pages/" data-pixo-project-preview-base>',
    );
  });

  it('keeps the URL document warm across repeated Code and Preview switches', async () => {
    const file = baseFile({
      name: 'page.html',
      path: 'page.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'page.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml='<html><body><main>Warm URL preview</main></body></html>'
      />,
    );

    const initialFrame = container.querySelector(
      'iframe[data-pixo-render-mode="url-load"]',
    ) as HTMLIFrameElement;
    const initialSrc = initialFrame.getAttribute('src');
    expect(initialSrc).toContain('/raw/');

    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
      expect(initialFrame.getAttribute('data-pixo-active')).toBe('false');
      expect(initialFrame.getAttribute('src')).toBe(initialSrc);

      fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
      expect(initialFrame.getAttribute('data-pixo-active')).toBe('true');
      expect(initialFrame.getAttribute('src')).toBe(initialSrc);
    }

    expect(container.querySelector('iframe[data-pixo-render-mode="url-load"]')).toBe(initialFrame);
  });

  it('uses the next file URL immediately when switching URL-loaded HTML previews', () => {
    const first = baseFile({
      name: 'first.html',
      path: 'first.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'First',
        entry: 'first.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const second = {
      ...first,
      name: 'second.html',
      path: 'second.html',
      artifactManifest: {
        ...first.artifactManifest!,
        title: 'Second',
        entry: 'second.html',
      },
    };
    const observedCommittedSrcs: Array<string | null> = [];

    function Switcher() {
      const [file, setFile] = useState<ProjectFile>(first);
      const hostRef = useRef<HTMLDivElement | null>(null);
      useLayoutEffect(() => {
        observedCommittedSrcs.push(
          hostRef.current
            ?.querySelector<HTMLIFrameElement>('[data-testid="artifact-preview-frame"]')
            ?.getAttribute('src') ?? null,
        );
      });
      return (
        <div ref={hostRef}>
          <button type="button" onClick={() => setFile(second)}>Switch file</button>
          <FileViewer projectId="project-1" projectKind="prototype" file={file}
            liveHtml="<html><body>preview</body></html>"
          />
        </div>
      );
    }

    const { container } = render(<Switcher />);
    const getFrame = () => container.querySelector<HTMLIFrameElement>('[data-testid="artifact-preview-frame"]');
    const initialFrame = getFrame();
    expect(initialFrame?.getAttribute('src')).toContain('/api/projects/project-1/raw/first.html?v=1710000000&r=0&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability&pixoPreviewEpoch=');

    const observationsBeforeSwitch = observedCommittedSrcs.length;
    fireEvent.click(screen.getByRole('button', { name: 'Switch file' }));

    const nextFrame = getFrame();
    expect(nextFrame).toBeTruthy();
    expect(observedCommittedSrcs[observationsBeforeSwitch]).toContain(
      '/api/projects/project-1/raw/second.html?v=1710000000&r=0&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability&pixoPreviewEpoch=',
    );
    expect(nextFrame?.getAttribute('src')).toContain('/api/projects/project-1/raw/second.html?v=1710000000&r=0&pixoPreviewBridge=scroll&pixoPreviewBridge=snapshot&pixoPreviewBridge=observability&pixoPreviewEpoch=');
  });

  it('allows downloads in React component preview iframes', async () => {
    const file = baseFile({
      name: 'Card.jsx',
      path: 'Card.jsx',
      mime: 'text/jsx',
      kind: 'code',
      artifactManifest: {
        version: 1,
        kind: 'react-component',
        title: 'Card',
        entry: 'Card.jsx',
        renderer: 'react-component',
        exports: ['jsx', 'html', 'zip'],
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/Card.jsx') {
        return new Response('export default function Card() { return <button>Download</button>; }');
      }
      return new Response('', { status: 404 });
    }));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    const frame = await screen.findByTestId('react-component-preview-frame');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-downloads');
  });

  it('points a .jsx module loaded by a sibling HTML to that entry, not the React error (issue #2744)', async () => {
    const file = baseFile({
      name: 'icons.jsx',
      path: 'icons.jsx',
      mime: 'text/jsx',
      kind: 'code',
      artifactManifest: {
        version: 1,
        kind: 'react-component',
        title: 'icons',
        entry: 'icons.jsx',
        renderer: 'react-component',
        exports: ['jsx'],
      },
    });
    let resolveHtmlSource!: (response: Response) => void;
    const pendingHtmlSource = new Promise<Response>((resolve) => { resolveHtmlSource = resolve; });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url === '/api/projects/project-1/files') {
          return new Response(
            JSON.stringify({
              files: [
                { name: 'icons.jsx', path: 'icons.jsx' },
                { name: 'backups.html', path: 'backups.html' },
              ],
            }),
          );
        }
        if (url === '/api/projects/project-1/raw/backups.html') {
          return pendingHtmlSource;
        }
        if (url === '/api/projects/project-1/raw/icons.jsx') {
          return new Response('window.I = { star: null };');
        }
        return new Response('', { status: 404 });
      }),
    );

    const onOpenFileReplacing = vi.fn();
    const { container } = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        onOpenFileReplacing={onOpenFileReplacing}
      />,
    );
    resolveHtmlSource(new Response('<script type="text/babel" src="icons.jsx"></script>'));

    // The module points at its HTML entry instead of rendering the React
    // runtime (which would throw "No React component export found").
    await screen.findByRole('button', { name: /backups\.html/ });
    expect(screen.queryByTestId('react-component-preview-frame')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();

    // The toolbar still offers a way to read the raw code: clicking the Code
    // tab swaps the pointer for the file's source. Issue #2744 follow-up.
    fireEvent.click(screen.getByRole('button', { name: /^code$/i }));
    expect(container.textContent).toContain('window.I');
    expect(screen.queryByRole('button', { name: /backups\.html/ })).toBeNull();

    // Back on Preview, clicking the entry opens the HTML page and closes the
    // dead-end module tab (icons.jsx) in one move.
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /backups\.html/ }));
    expect(onOpenFileReplacing).toHaveBeenCalledWith('backups.html', 'icons.jsx');
  });

  it('nudges the export button once when an artifact becomes exportable', async () => {
    const file = baseFile({
      name: 'nudge.html',
      path: 'nudge.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Nudge',
        entry: 'nudge.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    render(
      <FileViewer
        projectId="project-nudge"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body><h1>Ready</h1></body></html>"
      />,
    );

    const exportButton = screen.getByRole('button', { name: /export/i });
    await waitFor(() => {
      expect(exportButton.classList.contains('export-ready-nudge')).toBe(true);
    });

    fireEvent.click(exportButton);

    expect(exportButton.classList.contains('export-ready-nudge')).toBe(false);
  });

  it('nudges each exportable artifact once when the mounted viewer switches files', async () => {
    const firstFile = baseFile({
      name: 'nudge-first.html',
      path: 'nudge-first.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'First',
        entry: 'nudge-first.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const secondFile = baseFile({
      name: 'nudge-second.html',
      path: 'nudge-second.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Second',
        entry: 'nudge-second.html',
        renderer: 'html',
        exports: ['html'],
      },
    });

    const { rerender } = render(
      <FileViewer
        projectId="project-nudge-switch"
        projectKind="prototype"
        file={firstFile}
        liveHtml="<html><body><h1>First</h1></body></html>"
      />,
    );

    const firstExportButton = screen.getByRole('button', { name: /export/i });
    await waitFor(() => {
      expect(firstExportButton.classList.contains('export-ready-nudge')).toBe(true);
    });
    fireEvent.click(firstExportButton);
    expect(firstExportButton.classList.contains('export-ready-nudge')).toBe(false);

    rerender(
      <FileViewer
        projectId="project-nudge-switch"
        projectKind="prototype"
        file={secondFile}
        liveHtml="<html><body><h1>Second</h1></body></html>"
      />,
    );

    const secondExportButton = screen.getByRole('button', { name: /export/i });
    await waitFor(() => {
      expect(secondExportButton.classList.contains('export-ready-nudge')).toBe(true);
    });
  });





  // The per-file "Publish" entry point (a single file → a backend link) is
  // gated on HAVING A WORKSPACE, not on having a TEAM one.
  //
  // It was briefly team-only, on the premise that a public link is a hub
  // snapshot keyed by teamId and a personal session had nothing to publish
  // under. B's control-key auth path stopped refusing non-team callers — it now
  // mints a principal whose teamId IS the workspace id, and its access check
  // only compares that id against the resource's own — so a personal workspace
  // publishes into its own partition of one. The daemon's `publicFilePrincipal`
  // was widened to match, and these two tests pin both halves of the rule: the
  // card renders for a personal workspace, and is still gone with no workspace
  // at all (where the daemon really does answer 409).
  function publicPublishFile() {
    return baseFile({
      name: 'index.html',
      path: 'index.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'index.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
  }

  // The current panel presents link access inline. Reading it must not publish.
  function publishHelpCase(fileFor: () => ProjectFile, label: string) {

  }

  publishHelpCase(publicPublishFile, 'HtmlViewer');

  // The version-history entry carries the same disabled contract as the Share
  // button beside it in the same toolbar: `viewerOnly`, with
  // `fileViewer.readonlySharedNoExport` as the reason.
  //
  // This supersedes recvq56vFjQKfT, which had un-gated the entry on the
  // reasoning that browsing history is a pure read action. That reasoning does
  // not survive what the entry actually leads to: `.file-versions` is excluded
  // from member mirrors, so a readonly member's panel can never hold the
  // owner's history — measured live, the owner's 4 versions rendered as 1
  // synthetic entry the member's own read had just created (飞书 recvqAMSX4RXPm,
  // daemon side fixed in 5f34ae655). An entry that can only ever open an empty
  // panel is not a read affordance worth keeping.
  it('disables the version-history entry for a viewer-only shared project, like Share', async () => {
    const file = publicPublishFile(); // an .html file, so versioningAvailable is true
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deployments: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={file}
        liveHtml="<html><body><h1>Hello</h1></body></html>"
        viewerOnly
      />,
    );

    const historyButton = await screen.findByRole('button', { name: 'Versions' });
    expect(historyButton).toBeDisabled();
    expect(historyButton).toHaveAttribute('title', 'This project is read-only.');
  });



  it('closes the version modal and shows success feedback after switching versions', async () => {
    const file = baseFile({
      name: 'index.html',
      path: 'index.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'index.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const currentVersion = {
      id: 'v2',
      fileName: 'index.html',
      version: 2,
      label: 'Current checkpoint',
      createdAt: 1_725_000_000_000,
      source: 'manual',
      prompt: 'Current prompt',
      size: 42,
      mime: 'text/html',
      kind: 'html',
      current: true,
    };
    const priorVersion = {
      ...currentVersion,
      id: 'v1',
      version: 1,
      label: 'Prior checkpoint',
      prompt: 'Prior prompt',
      current: false,
    };
    const restoredVersion = {
      ...currentVersion,
      id: 'v3',
      version: 3,
      label: 'Restored checkpoint',
      source: 'restore',
      prompt: 'Prior prompt',
      restoreFromVersionId: 'v1',
      current: true,
    };
    const onFileSaved = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/projects/project-1/files/index.html/versions' && method === 'GET') {
        return new Response(JSON.stringify({ file, versions: [currentVersion, priorVersion] }), { status: 200 });
      }
      if (url === '/api/projects/project-1/files/index.html/versions/v1' && method === 'GET') {
        return new Response(JSON.stringify({
          version: priorVersion,
          content: '<html><body><h1>Prior</h1></body></html>',
        }), { status: 200 });
      }
      if (url === '/api/projects/project-1/files/index.html/versions/v1/restore' && method === 'POST') {
        return new Response(JSON.stringify({ file, version: restoredVersion }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body><h1>Current</h1></body></html>"
        onFileSaved={onFileSaved}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));
    const versionDialog = await screen.findByRole('dialog', { name: 'Versions' });
    fireEvent.click(within(versionDialog).getByRole('option', { name: /Prior prompt/ }));

    const switchButton = within(versionDialog).getByRole('button', { name: 'Switch to this version' }) as HTMLButtonElement;
    await waitFor(() => expect(switchButton.disabled).toBe(false));
    fireEvent.click(switchButton);

    const confirmDialog = await screen.findByRole('alertdialog', { name: 'Switch to this version?' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Switch' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Versions' })).toBeNull();
    });
    // Scope to the toast: #6156 added the `artifact-preview-first-load` cover,
    // which is a `role="status"` of its own, so a bare `findByRole('status')`
    // now resolves ambiguously against the preview's loading state.
    await waitFor(() => {
      expect(document.querySelector('.pixo-toast')?.textContent).toContain('Switched to this version.');
    });
    expect(onFileSaved).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/files/index.html/versions/v1/restore',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('disables version actions when the newly selected preview fails to load', async () => {
    const file = baseFile({
      name: 'index.html',
      path: 'index.html',
      mime: 'text/html',
      kind: 'html',
    });
    const currentVersion = {
      id: 'v3',
      fileName: 'index.html',
      version: 3,
      label: 'Current checkpoint',
      createdAt: 1_725_000_000_000,
      source: 'manual',
      prompt: 'Current prompt',
      size: 42,
      mime: 'text/html',
      kind: 'html',
      current: true,
    };
    const priorVersion = {
      ...currentVersion,
      id: 'v2',
      version: 2,
      label: 'Prior checkpoint',
      prompt: 'Prior prompt',
      current: false,
    };
    const brokenVersion = {
      ...currentVersion,
      id: 'v1',
      version: 1,
      label: 'Broken checkpoint',
      prompt: 'Broken prompt',
      current: false,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/projects/project-1/files/index.html/versions' && method === 'GET') {
        return new Response(JSON.stringify({ file, versions: [currentVersion, priorVersion, brokenVersion] }), { status: 200 });
      }
      if (url === '/api/projects/project-1/files/index.html/versions/v2' && method === 'GET') {
        return new Response(JSON.stringify({
          version: priorVersion,
          content: '<html><body><h1>Prior</h1></body></html>',
        }), { status: 200 });
      }
      if (url === '/api/projects/project-1/files/index.html/versions/v1' && method === 'GET') {
        return new Response(JSON.stringify({ error: { code: 'VERSION_NOT_FOUND' } }), { status: 500 });
      }
      if (url.includes('/restore') && method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body><h1>Current</h1></body></html>"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));
    const versionDialog = await screen.findByRole('dialog', { name: 'Versions' });
    fireEvent.click(within(versionDialog).getByRole('option', { name: /Prior prompt/ }));
    const switchButton = within(versionDialog).getByRole('button', { name: 'Switch to this version' }) as HTMLButtonElement;
    const openButton = within(versionDialog).getByRole('button', { name: 'Open preview in a new window' }) as HTMLButtonElement;
    await waitFor(() => expect(switchButton.disabled).toBe(false));
    expect(openButton.disabled).toBe(false);

    fireEvent.click(within(versionDialog).getByRole('option', { name: /Broken prompt/ }));
    await waitFor(() => {
      expect(within(versionDialog).getByRole('alert').textContent).toContain('Could not load this version preview.');
    });
    expect(switchButton.disabled).toBe(true);
    expect(openButton.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files/index.html/versions/v1/restore',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not show an export-started toast when desktop PDF export is canceled', async () => {
    const file = baseFile({
      name: 'index.html',
      path: 'index.html',
      mime: 'text/html',
      kind: 'html',
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'Page',
        entry: 'index.html',
        renderer: 'html',
        exports: ['html'],
      },
    });
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.pathname
          : typeof (input as { url?: unknown })?.url === 'string'
            ? (input as { url: string }).url
            : '';
      if (url === '/api/projects/project-1/export/pdf') {
        return new Response(JSON.stringify({ ok: true, canceled: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={file}
        liveHtml="<html><body><h1>Hello</h1></body></html>"
      />,
    );

    await openUnifiedExportTab();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Export as PDF/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/export/pdf',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Export started')).toBeNull();
  });

  it('coalesces markdown split-pane scroll sync to one animation frame', async () => {
    const file = baseFile({
      name: 'notes.md',
      path: 'notes.md',
      mime: 'text/markdown',
      kind: 'text',
      artifactManifest: {
        version: 1,
        kind: 'markdown-document',
        title: 'Notes',
        entry: 'notes.md',
        renderer: 'markdown',
        exports: ['md'],
      },
    });
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frameCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      frameCallbacks.delete(id);
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/raw/notes.md') {
        return new Response('# Notes\n\n' + Array.from({ length: 40 }, (_, index) => `Line ${index}`).join('\n\n'));
      }
      return new Response('', { status: 404 });
    }));
    const flushFrames = () => {
      const callbacks = Array.from(frameCallbacks.entries());
      frameCallbacks.clear();
      for (const [, callback] of callbacks) callback(16);
    };

    render(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    const editor = await screen.findByRole('textbox') as HTMLTextAreaElement;
    const preview = screen.getByLabelText(/markdown preview/i) as HTMLElement;
    let editorTop = 0;
    let previewTop = 0;
    let previewSetCount = 0;
    Object.defineProperties(editor, {
      scrollHeight: { configurable: true, value: 4000 },
      clientHeight: { configurable: true, value: 1000 },
      scrollTop: {
        configurable: true,
        get: () => editorTop,
        set: (value: number) => {
          editorTop = value;
        },
      },
    });
    Object.defineProperties(preview, {
      scrollHeight: { configurable: true, value: 7000 },
      clientHeight: { configurable: true, value: 1000 },
      scrollTop: {
        configurable: true,
        get: () => previewTop,
        set: (value: number) => {
          previewSetCount += 1;
          previewTop = value;
        },
      },
    });

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        flushFrames();
        await Promise.resolve();
      });
    }
    expect(frameCallbacks.size).toBe(0);
    requestAnimationFrameMock.mockClear();
    previewSetCount = 0;
    previewTop = 0;

    editor.scrollTop = 1500;
    const originalText = editor.value;
    fireEvent.change(editor, { target: { value: `${originalText}\n\nDraft 1` } });
    fireEvent.change(editor, { target: { value: `${originalText}\n\nDraft 2` } });
    fireEvent.change(editor, { target: { value: `${originalText}\n\nDraft 3` } });

    expect(editor.scrollTop).toBe(1500);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(previewTop).toBe(0);
    expect(previewSetCount).toBe(0);
    expect(frameCallbacks.size).toBe(1);

    await act(async () => {
      flushFrames();
    });

    expect(previewTop).toBe(3000);
    expect(previewSetCount).toBe(1);

    previewTop = 2800;
    fireEvent.scroll(preview);
    await act(async () => {
      flushFrames();
      flushFrames();
    });

    expect(editorTop).toBe(1500);

    previewTop = 3600;
    fireEvent.wheel(preview);
    fireEvent.scroll(preview);
    await act(async () => {
      flushFrames();
    });

    expect(editorTop).toBe(1800);
  });

  it('renders unsafe SVG source as escaped text instead of executable markup', () => {
    const file = baseFile({ name: 'unsafe.svg', path: 'unsafe.svg', mime: 'image/svg+xml' });
    const unsafeSource = [
      '<svg onload="alert(1)"><script>alert(2)</script><text>Logo</text></svg>',
      '<svg><![CDATA[<script>alert(3)</script>]]></svg>',
    ].join('\n');

    const markup = renderToStaticMarkup(
      <SvgViewer
        projectId="project-1"
        file={file}
        initialMode="source"
        initialSource={unsafeSource}
      />,
    );

    expect(markup).toContain('&lt;svg onload=&quot;alert(1)&quot;&gt;');
    expect(markup).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(markup).toContain('&lt;![CDATA[&lt;script&gt;alert(3)&lt;/script&gt;]]&gt;');
    expect(markup).not.toContain('<svg onload');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<![CDATA[');
    expect(markup).not.toContain('dangerouslySetInnerHTML');
  });
});
