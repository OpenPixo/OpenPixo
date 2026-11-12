import { isProductSiteUrl } from '@openpixo/contracts';

export function openFirstPartyExternalLinkFromClick(event: MouseEvent, openExternal: (url: string) => void): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  let url: URL;
  try { url = new URL(anchor.href); } catch { return; }
  if (!isProductSiteUrl(url.href)) return;
  event.preventDefault();
  openExternal(url.toString());
}
