import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

const deckHtml = `<!doctype html>
<html>
  <head><title>Deck</title></head>
  <body>
    <section class="slide active">One</section>
    <section class="slide">Two</section>
    <section class="slide">Three</section>
  </body>
</html>`;

describe('buildSrcdoc', () => {

  it('seeds presentation storage before authored scripts without allowing script injection', () => {
    const value = '</script><script>window.injected = true</script>';
    const doc = buildSrcdoc('<html><body><script>window.saved = localStorage.getItem("task");</script></body></html>', {
      previewStorage: true,
      previewStorageSeed: { generation: 'presentation-1', values: { task: value } },
    });
    const dom = new JSDOM(doc, { runScripts: 'dangerously' });
    expect((dom.window as any).saved).toBe(value);
    expect((dom.window as any).injected).toBeUndefined();
    expect((dom.window as any).__pixoPreviewStorageSeed).toBeUndefined();
    dom.window.close();
  });

  it('preserves an artifact-authored base instead of overriding its navigation semantics', () => {
    const authored = '<base href="https://cdn.example/assets/">';
    const doc = buildSrcdoc(
      `<!doctype html><html><head>${authored}</head><body></body></html>`,
      { baseHref: '/api/projects/project-1/preview/scope-1/' },
    );

    const dom = new JSDOM(doc, {
      url: 'http://openpixo.local/',
      runScripts: 'dangerously',
    });
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: dom.window.parent,
      data: {
        type: 'pixo:preview-base-update',
        href: '/api/projects/project-1/preview/scope-2/',
      },
    }));

    expect(doc).toContain(authored);
    expect(doc).not.toContain('/api/projects/project-1/preview/scope-1/');
    expect(dom.window.document.querySelectorAll('base')).toHaveLength(1);
    expect(dom.window.document.querySelector('base')?.getAttribute('href'))
      .toBe('https://cdn.example/assets/');
    dom.window.close();
  });

  it('updates an injected preview base in place without navigating the document', () => {
    const doc = buildSrcdoc(
      '<!doctype html><html><head></head><body><main>Preview</main></body></html>',
      { baseHref: 'openpixo://app/api/projects/project-1/preview/scope-1/' },
    );
    const dom = new JSDOM(doc, {
      url: 'http://openpixo.local/',
      runScripts: 'dangerously',
    });
    const before = dom.window.document.documentElement;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: dom.window.parent,
      data: {
        type: 'pixo:preview-base-update',
        requestId: 'renew-1',
        href: 'openpixo://app/api/projects/project-1/preview/scope-2/',
      },
    }));

    expect(dom.window.document.documentElement).toBe(before);
    expect(dom.window.document.querySelector('base')?.getAttribute('href'))
      .toBe('openpixo://app/api/projects/project-1/preview/scope-2/');
    dom.window.close();
  });

  it('keeps relative assets resolvable when Electron transports srcDoc through a Blob URL', () => {
    const doc = buildSrcdoc(
      '<!doctype html><html><head></head><body><img src="./asset.png"></body></html>',
      { baseHref: 'openpixo://app/api/projects/project-1/preview/scope-1/pages/' },
    );
    const dom = new JSDOM(doc, { url: 'blob:openpixo://app/preview-document' });

    expect(dom.window.document.baseURI)
      .toBe('openpixo://app/api/projects/project-1/preview/scope-1/pages/');
    expect(new URL('./asset.png', dom.window.document.baseURI).href)
      .toBe('openpixo://app/api/projects/project-1/preview/scope-1/pages/asset.png');
    dom.window.close();
  });

  it('echoes the witnessed content-size generation with separate scroll and client widths', () => {
    const doc = buildSrcdoc('<main>Preview</main>', {
      previewMeasurementEpoch: 'revision-42',
    });

    expect(doc).toContain('data-pixo-preview-content-size-bridge');
    expect(doc).toContain('lastRequest.measurementId');
    expect(doc).toContain('lastRequest.generation');
    expect(doc).toContain('var documentEpoch = "revision-42"');
    expect(doc).toContain('documentEpoch: documentEpoch');
    expect(doc).toContain('scrollWidth: size && size.scrollWidth');
    expect(doc).toContain('clientWidth: size && size.clientWidth');
    expect(doc).toContain("typeof data.measurementId !== 'string'");
    expect(doc).not.toContain("type: 'pixo:preview-content-size', width:");
  });

  it('injects the motion-freeze style only when freezeMotion is set', () => {
    const frozen = buildSrcdoc(deckHtml, { freezeMotion: true });
    expect(frozen).toContain('data-pixo-motion-freeze');
    // End-state, not paused-at-t0: entry animations with fill-mode both must
    // land on their final keyframe or thumbnails render as blank frames.
    expect(frozen).toContain('animation-duration: 0.001s !important');
    expect(frozen).toContain('animation-iteration-count: 1 !important');
    expect(frozen).toContain('transition-duration: 0.001s !important');

    const normal = buildSrcdoc(deckHtml, { });
    expect(normal).not.toContain('data-pixo-motion-freeze');
  });

  it('injects preview observability before author scripts', () => {
    const html = '<!doctype html><html><head><script>throw new Error("boot")</script></head><body></body></html>';
    const srcdoc = buildSrcdoc(html, { previewObservability: true });

    expect(srcdoc).toContain('data-pixo-preview-observability');
    expect(srcdoc).toContain("send('runtime_error'");
    expect(srcdoc).toContain("send('white_screen'");
    expect(srcdoc.indexOf('data-pixo-preview-observability')).toBeLessThan(
      srcdoc.indexOf('<script>throw new Error("boot")</script>'),
    );
    expect(buildSrcdoc(html)).not.toContain('data-pixo-preview-observability');
  });

  it('defers trusted font stylesheets without changing authored layout CSS', async () => {
    const parserWindow = new JSDOM('').window;
    vi.stubGlobal('DOMParser', parserWindow.DOMParser);
    const fontHref = 'https://fonts.googleapis.com/css2?family=Inter&display=swap';
    const html = `<!doctype html><html><head>
      <link href="${fontHref}" rel="stylesheet">
      <link href="/layout.css" rel="stylesheet">
    </head><body><main>Preview</main></body></html>`;
    try {
      const srcdoc = buildSrcdoc(html, { deferFontStylesheets: true });
      const document = new JSDOM(srcdoc).window.document;
      const fontLink = document.querySelector<HTMLLinkElement>('link[href^="https://fonts.googleapis.com/"]');
      const layoutLink = document.querySelector<HTMLLinkElement>('link[href="/layout.css"]');

      expect(fontLink?.media).toBe('print');
      expect(fontLink?.hasAttribute('data-pixo-deferred-font-stylesheet')).toBe(true);
      expect(layoutLink?.media).toBe('');
      expect(layoutLink?.hasAttribute('data-pixo-deferred-font-stylesheet')).toBe(false);
      expect(srcdoc.indexOf('data-pixo-font-stylesheet-loader')).toBeLessThan(
        srcdoc.indexOf('fonts.googleapis.com'),
      );

      const runtime = new JSDOM(srcdoc, { runScripts: 'dangerously' });
      await new Promise<void>((resolve) => runtime.window.queueMicrotask(resolve));
      const runtimeFontLink = runtime.window.document.querySelector<HTMLLinkElement>(
        'link[href^="https://fonts.googleapis.com/"]',
      );
      runtimeFontLink?.dispatchEvent(new runtime.window.Event('load'));
      expect(runtimeFontLink?.media).toBe('all');
      expect(runtimeFontLink?.hasAttribute('data-pixo-deferred-font-stylesheet')).toBe(false);
      runtime.window.close();

      const unchanged = new JSDOM(buildSrcdoc(html)).window.document;
      expect(unchanged.querySelector<HTMLLinkElement>('link[href^="https://fonts.googleapis.com/"]')?.media).toBe('');
    } finally {
      vi.unstubAllGlobals();
      parserWindow.close();
    }
  });

  it('echoes the host challenge token from the srcDoc transport readiness probe', () => {
    const srcdoc = buildSrcdoc('<main>Preview</main>', {
      transportActivationGeneration: 'generation-42',
    });

    expect(srcdoc).toContain("data.type === 'pixo:srcdoc-transport-ready-probe'");
    expect(srcdoc).toContain('announceReady(data.probeId)');
    expect(srcdoc).toContain('message.probeId = probeId');
    expect(srcdoc).toContain('data-pixo-srcdoc-transport-body-complete="generation-42"');
    expect(srcdoc).toContain('var bodyComplete = false');
    expect(srcdoc).toContain('new MutationObserver(function(records)');
    expect(srcdoc).toContain('message.bodyComplete = bodyComplete');
    expect(srcdoc).not.toContain("document.querySelector('template[data-pixo-srcdoc-transport-body-complete]')");
    expect(srcdoc).toContain('message.documentReadyState = document.readyState');
    expect(srcdoc).toContain('message.bodyChildCount = document.body ? document.body.children.length : 0');
  });

  it('keeps parser completion latched after authored code removes the completed body', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const generation = 'generation-remove-body';
    const srcdoc = buildSrcdoc(
      `<html><head></head><body><main>Ready</main><script>
        window.addEventListener('DOMContentLoaded', function(){ document.body.remove(); });
      </script></body></html>`,
      { transportActivationGeneration: generation },
    );
    const dom = new JSDOM(srcdoc, {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window, 'parent', {
          value: { postMessage: (message: Record<string, unknown>) => messages.push(message) },
        });
      },
    });
    await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve()));
    await new Promise<void>((resolve) => dom.window.queueMicrotask(resolve));

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'pixo:srcdoc-transport-ready-probe',
        generation,
        probeId: 'probe-after-body-removal',
      },
    }));

    expect(dom.window.document.body).toBeNull();
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'pixo:srcdoc-transport-activated',
      generation,
      probeId: 'probe-after-body-removal',
      bodyComplete: true,
    }));
    dom.window.close();
  });

  it('does not accept an authored lookalike before a truncated injected tail', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const generation = 'generation-truncated-tail';
    const completeSrcdoc = buildSrcdoc(
      '<html><head></head><body><template data-pixo-srcdoc-transport-body-complete></template><main>Partial</main></body></html>',
      { transportActivationGeneration: generation },
    );
    const injectedMarker = `<template data-pixo-srcdoc-transport-body-complete="${generation}"></template>`;
    const markerIndex = completeSrcdoc.indexOf(injectedMarker);
    expect(markerIndex).toBeGreaterThan(-1);
    const srcdoc = completeSrcdoc.slice(0, markerIndex);
    const dom = new JSDOM(srcdoc, {
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperty(window, 'parent', {
          value: { postMessage: (message: Record<string, unknown>) => messages.push(message) },
        });
      },
    });
    await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve()));
    await new Promise<void>((resolve) => dom.window.queueMicrotask(resolve));

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'pixo:srcdoc-transport-ready-probe',
        generation,
        probeId: 'probe-truncated-tail',
      },
    }));

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'pixo:srcdoc-transport-activated',
      generation,
      probeId: 'probe-truncated-tail',
      bodyComplete: false,
    }));
    dom.window.close();
  });

  it('paints an opaque background before drawing so empty rasters never flatten to black', () => {
    const srcdoc = buildSrcdoc('<main style="color:red">Hero</main>');

    // A fresh 2D canvas is transparent black; without an opaque base, a
    // foreignObject that paints nothing flattens to a solid BLACK PNG in
    // clipboards/viewers (the reported bug). The bridge must fill first.
    expect(srcdoc).toContain('function snapshotBackgroundColor()');
    expect(srcdoc).toContain('ctx.fillStyle = bgColor;');
    expect(srcdoc).toContain('ctx.fillRect(0, 0, capW, capH);');
    // The fill happens before the rasterized image is drawn over it.
    const fillIdx = srcdoc.indexOf('ctx.fillRect(0, 0, capW, capH);');
    const drawIdx = srcdoc.indexOf('ctx.drawImage(img, 0, 0, capW, capH);');
    expect(fillIdx).toBeGreaterThan(-1);
    expect(drawIdx).toBeGreaterThan(fillIdx);
  });

  it('reports an empty-render error instead of shipping a blank capture', () => {
    const srcdoc = buildSrcdoc('<main style="color:red">Hero</main>');

    // When the foreignObject paints nothing the canvas is uniform; the bridge
    // must surface that as an honest failure (rejected promise → pixo:snapshot:result
    // error) so the host can fall back / show an error rather than copy a (now
    // white-filled but still empty) frame.
    expect(srcdoc).toContain('function canvasLooksBlank(');
    expect(srcdoc).toContain("reject(new Error('empty-render'))");
  });

  it('renders snapshot SVGs through data URLs so canvas export stays origin-clean', () => {
    const srcdoc = buildSrcdoc('<main style="color:red">Hero</main>');

    expect(srcdoc).toContain("img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);");
    expect(srcdoc).not.toContain('createObjectURL');
    expect(srcdoc).not.toContain('snapshot too large');
  });

  it('crops snapshots with an XHTML wrapper instead of moving foreignObject offscreen', () => {
    const srcdoc = buildSrcdoc('<main style="color:red">Hero</main>');

    expect(srcdoc).toContain('function scrollOffset()');
    expect(srcdoc).toContain('left:\' + (-scroll.x) + \'px;top:\' + (-scroll.y) + \'px;');
    expect(srcdoc).toContain('<foreignObject x="0" y="0"');
    expect(srcdoc).not.toContain('<foreignObject x="\' + (-window.scrollX || 0)');
  });

  it('removes external stylesheet dependencies from snapshot clones before rasterizing', () => {
    const srcdoc = buildSrcdoc('<link rel="stylesheet" href="https://fonts.example/app.css"><style>@import "https://fonts.example/css"; @font-face { font-family: Remote; src: url(remote.woff2); } main { color: red; }</style><main>Hero</main>');

    expect(srcdoc).toContain('link[rel~="stylesheet"], link[rel~="preload"], link[rel~="preconnect"]');
    expect(srcdoc).toContain('.replace(/@import[^;]+;/gi,');
    expect(srcdoc).toContain('.replace(/@font-face\\s*\\{[^}]*\\}/gi,');
  });

  it('prunes hidden snapshot clone nodes before rasterizing decks', () => {
    const srcdoc = buildSrcdoc(deckHtml, { });

    expect(srcdoc).toContain('function pruneHiddenSnapshotNodes');
    expect(srcdoc).toContain("computed.display === 'none'");
    expect(srcdoc).toContain("computed.visibility === 'hidden'");
    expect(srcdoc).toContain('pruneHiddenSnapshotNodes(document.documentElement, clone)');
  });

  it('strips snapshot resources only AFTER pruning so the original/clone lists stay index-aligned', () => {
    // Regression (#5444): prune pairs original/clone querySelectorAll('*')
    // lists by index. Removing clone scripts/links first shifted every later
    // clone under the wrong original and the misdirected removals deleted
    // visible content (often the <body> itself), so any page containing a
    // script or stylesheet link rasterized as a uniform frame → the capture
    // failed with 'empty-render' ("Preview is still loading" toast) on every
    // pure-web (no desktop compositor) deployment.
    const srcdoc = buildSrcdoc('<main style="color:red">Hero</main>');

    expect(srcdoc).toContain('function stripSnapshotResources');
    const pruneCall = srcdoc.indexOf('pruneHiddenSnapshotNodes(document.documentElement, clone)');
    const stripCall = srcdoc.indexOf('stripSnapshotResources(clone)');
    expect(pruneCall).toBeGreaterThan(-1);
    expect(stripCall).toBeGreaterThan(pruneCall);
    // And inlineSnapshotStyles no longer removes nodes itself.
    const inlineBody = srcdoc.slice(
      srcdoc.indexOf('function inlineSnapshotStyles'),
      srcdoc.indexOf('function stripSnapshotResources'),
    );
    expect(inlineBody).not.toContain('.remove()');
  });

  it('serializes snapshot content as XHTML so void elements do not break the SVG parse', () => {
    // Regression (#5444): innerHTML emits void elements (<br>, <img>) without
    // self-closing slashes — invalid XML inside foreignObject, so the SVG
    // image fired onerror ('snapshot image failed') for any page containing
    // one. XMLSerializer emits well-formed XHTML; XML-invalid attribute
    // names (@click, :href) are dropped for the same reason.
    const srcdoc = buildSrcdoc('<main style="color:red">Hero<br><img alt="x"></main>');

    expect(srcdoc).toContain('function serializeSnapshotXhtml');
    expect(srcdoc).toContain('new XMLSerializer()');
    expect(srcdoc).toContain('serializeSnapshotXhtml(cloneBody || clone)');
    expect(srcdoc).not.toContain('cloneBody ? cloneBody.innerHTML : clone.innerHTML');
    expect(srcdoc).toContain('XML_NAME');
  });

  it('can guard preview iframes against load-time focus stealing', () => {
    // This test would fail if injectPreviewFocusGuard were removed from
    // buildSrcdoc — the guard script would be absent, and the assertions
    // below would not find the data-pixo-preview-focus-guard marker.
    const srcdoc = buildSrcdoc(
      '<!doctype html><html><head><script>window.focus();document.body.focus();</script></head><body>Hero</body></html>',
      { previewFocusGuard: true },
    );

    expect(srcdoc).toContain('data-pixo-preview-focus-guard');
    expect(srcdoc).toContain("Object.defineProperty(window, 'focus'");
    expect(srcdoc).toContain("Object.defineProperty(HTMLElement.prototype, 'focus'");
    expect(srcdoc.indexOf('data-pixo-preview-focus-guard')).toBeLessThan(
      srcdoc.indexOf('<script>window.focus();document.body.focus();</script>'),
    );
  });
});
