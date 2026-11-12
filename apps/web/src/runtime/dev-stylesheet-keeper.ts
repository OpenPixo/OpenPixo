// Development-only repair for stylesheets that Next.js's webpack dev mode
// drops during a hot update.
//
// The defect (Next 16.4, `next dev --webpack`, App Router)
// --------------------------------------------------------
// CSS for chunks loaded through `next/dynamic` (`src/App`, `FileWorkspace`,
// `SettingsDialog`) is not inserted by webpack. Next installs
// `_N_E_STYLE_LOAD`, and `RuntimeStylesForWebpack` in `app-router.js` renders
// each such file as a React `<link rel="stylesheet" precedence="next">`.
//
// When a hot update changes one of those CSS chunks, webpack's
// `hmrC.miniCss` finds that React-owned link as the "old tag", builds a
// replacement through the same `_N_E_STYLE_LOAD` hook, and at dispose time
// removes the old tag. The hook sees an href it already registered and does
// nothing, so the replacement never reaches the DOM. React still thinks the
// stylesheet is mounted and never re-inserts it. Every CSS Module in that
// chunk is gone until a full reload: the sidebar, the account panel and the
// rest of the shell render unstyled. Another session saving a file in
// `apps/web` is enough to trigger it.
//
// Turbopack and production exports never run this code path.
//
// The invariant
// -------------
// A Next-managed stylesheet may leave `<head>` only when another copy of the
// same file is already there. Next's own swaps keep to this: the CSS reloader
// in mini-css-extract adds the new copy before it removes the old one, and
// Next's link GC removes an older version only after a newer one was added.
// The webpack dispose step above is the one removal that breaks the rule, so a
// removal that leaves no copy behind is answered with a fresh, cache-busted
// copy in the same place in the cascade.

const NEXT_PRECEDENCE_PREFIX = 'next';

function isNextStylesheet(node: Node): node is HTMLLinkElement {
  if (!(node instanceof HTMLLinkElement)) return false;
  if (node.rel !== 'stylesheet') return false;
  return (node.getAttribute('data-precedence') ?? '').startsWith(NEXT_PRECEDENCE_PREFIX);
}

/** The file a link points at, ignoring origin and cache-busting query. */
function stylesheetPath(link: HTMLLinkElement): string | null {
  const href = link.getAttribute('href');
  if (!href) return null;
  try {
    return new URL(href, window.location.href).pathname;
  } catch {
    return null;
  }
}

function headHasStylesheetFor(head: HTMLHeadElement, path: string): boolean {
  for (const link of head.querySelectorAll('link[rel="stylesheet"]')) {
    if (link instanceof HTMLLinkElement && stylesheetPath(link) === path) return true;
  }
  return false;
}

function restore(head: HTMLHeadElement, removed: HTMLLinkElement, path: string, nextSibling: Node | null): void {
  const copy = removed.cloneNode(false) as HTMLLinkElement;
  copy.setAttribute('href', `${path}?${Date.now()}`);
  if (nextSibling && nextSibling.parentNode === head) head.insertBefore(copy, nextSibling);
  else head.appendChild(copy);
}

/**
 * Watch `<head>` and put back any Next-managed stylesheet that was removed
 * without a replacement. Returns a disposer. Call it only in development.
 */
export function installDevStylesheetKeeper(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const head = document.head;
  if (!head) return () => {};

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (!isNextStylesheet(node)) continue;
        const path = stylesheetPath(node);
        if (!path || headHasStylesheetFor(head, path)) continue;
        restore(head, node, path, mutation.nextSibling);
      }
    }
  });
  observer.observe(head, { childList: true });
  return () => observer.disconnect();
}
