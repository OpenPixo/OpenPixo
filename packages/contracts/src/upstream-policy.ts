/** ADR 0005: upstream infrastructure cannot become an OpenPixo release source. */
export type UpstreamHostPolicy = 'feed' | 'release' | 'site';

/**
 * Preserve the three existing boundaries. Feeds match domain labels; release
 * origins also reject the organization anywhere in a hostname and normalize
 * trailing dots; site host configuration historically rejects domain substrings.
 */
export function isUpstreamHost(hostname: string, policy: UpstreamHostPolicy = 'feed'): boolean {
  if (policy === 'site') return /open-design\.ai|nexu/i.test(hostname);
  const host = policy === 'release' ? hostname.replace(/\.+$/, '') : hostname;
  return /(^|\.)(open-design\.ai|nexu\.space)\.?$/i.test(host)
    || (policy === 'release' && /nexu/i.test(host));
}

/** Apply to already-decoded link text; decoding and malformed-URL handling stay with the caller. */
export function mentionsUpstream(text: string): boolean {
  return /opendesign|open-design|nexu/i.test(text);
}
