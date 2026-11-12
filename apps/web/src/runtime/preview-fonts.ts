const FONT_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'fonts.bunny.net',
  'fonts.cdnfonts.com',
]);

export function isApprovedFontStylesheetHref(href: string): boolean {
  // Font-CDN links are always absolute https URLs; a relative href cannot be an
  // approved CDN and is correctly treated as an untrusted external stylesheet.
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && FONT_HOSTS.has(url.hostname.toLowerCase());
}
