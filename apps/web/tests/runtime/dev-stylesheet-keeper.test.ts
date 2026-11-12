// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { installDevStylesheetKeeper } from '../../src/runtime/dev-stylesheet-keeper';

const APP_CSS = '/_next/static/css/_app-pages-browser_src_App_tsx.css';

function nextStylesheet(href: string, precedence = 'next'): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('href', href);
  link.setAttribute('data-precedence', precedence);
  return link;
}

function stylesheetsFor(pathname: string): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(
    (link) => new URL(link.getAttribute('href') ?? '', window.location.href).pathname === pathname,
  );
}

/** MutationObserver callbacks run as a microtask after the DOM change. */
async function flushObservers(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.head.innerHTML = '';
});

describe('installDevStylesheetKeeper', () => {
  it('puts back a Next stylesheet that was removed with no copy left (webpack CSS hot update)', async () => {
    const before = nextStylesheet('/_next/static/css/app/layout.css?v=1', 'next_static/css/app/layout.css');
    const app = nextStylesheet(APP_CSS);
    const after = nextStylesheet('/_next/static/css/after.css');
    document.head.append(before, app, after);
    dispose = installDevStylesheetKeeper();

    // What webpack's `hmrC.miniCss` dispose step does when Next's style-load
    // hook kept the replacement out of the DOM: drop the old tag, add nothing.
    app.remove();
    await flushObservers();

    const restored = stylesheetsFor(APP_CSS);
    expect(restored).toHaveLength(1);
    expect(restored[0]).not.toBe(app);
    expect(restored[0]!.getAttribute('data-precedence')).toBe('next');
    // Cache-busted so the browser fetches the updated chunk, not the bytes it held.
    expect(restored[0]!.getAttribute('href')).toMatch(/_App_tsx\.css\?\d+$/);
    // Same place in the cascade.
    expect(restored[0]!.previousElementSibling).toBe(before);
    expect(restored[0]!.nextElementSibling).toBe(after);
  });

  it('leaves a swap alone when a newer copy of the same file is already in place', async () => {
    const old = nextStylesheet(APP_CSS);
    document.head.append(old);
    dispose = installDevStylesheetKeeper();

    // mini-css-extract's CSS reloader and Next's link GC both add the new copy
    // first and remove the old one after.
    const fresh = nextStylesheet(`${APP_CSS}?1794522579762`);
    document.head.append(fresh);
    old.remove();
    await flushObservers();

    expect(stylesheetsFor(APP_CSS)).toEqual([fresh]);
  });

  it('treats an absolute href and a pathname href as the same file', async () => {
    const old = nextStylesheet(APP_CSS);
    document.head.append(old);
    dispose = installDevStylesheetKeeper();

    const fresh = nextStylesheet(`${window.location.origin}${APP_CSS}?2`);
    document.head.append(fresh);
    old.remove();
    await flushObservers();

    expect(stylesheetsFor(APP_CSS)).toEqual([fresh]);
  });

  it('ignores links Next does not manage and preload hints', async () => {
    const own = document.createElement('link');
    own.rel = 'stylesheet';
    own.setAttribute('href', '/own.css');
    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'style';
    preload.setAttribute('href', APP_CSS);
    preload.setAttribute('data-precedence', 'next');
    document.head.append(own, preload);
    dispose = installDevStylesheetKeeper();

    own.remove();
    preload.remove();
    await flushObservers();

    expect(document.head.querySelectorAll('link')).toHaveLength(0);
  });

  it('stops watching once disposed', async () => {
    const app = nextStylesheet(APP_CSS);
    document.head.append(app);
    installDevStylesheetKeeper()();

    app.remove();
    await flushObservers();

    expect(stylesheetsFor(APP_CSS)).toHaveLength(0);
  });
});
