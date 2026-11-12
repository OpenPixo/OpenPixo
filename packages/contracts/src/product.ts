/** Public OpenPixo identity and explicitly configured public destinations. */
export const PRODUCT_NAME = 'OpenPixo';
export const PRODUCT_CLI_NAME = 'pixo';
// Empty destinations render as placeholders and must never be opened as URLs.
// The repository is private until the owner opens it. PRODUCT_SITE_URL stays
// empty although the site is live: filling it in also turns on plugin share
// links to pages the site does not have, and attribution bridging.
export const PRODUCT_REPOSITORY_URL: string = '';
export const PRODUCT_SITE_URL: string = '';
export const PRODUCT_SUPPORT_EMAIL: string = 'support@openpixo.com';
/** Where someone can always get a full installer by hand. */
export const PRODUCT_DOWNLOAD_URL = 'https://openpixo.com/download';
export const PRODUCT_SUPPORT_URL = 'https://openpixo.com/support';
export const PRODUCT_RELEASES_URL = 'https://openpixo.com/changelog';
export const PRODUCT_ISSUES_URL = PRODUCT_REPOSITORY_URL ? `${PRODUCT_REPOSITORY_URL}/issues` : '';
export const PRODUCT_PRIVACY_URL = 'https://openpixo.com/privacy';

/** The site's Chinese pages are the English address with a `.zh` suffix. */
export function localizedProductPage(url: string, locale: string): string {
  return /^zh\b/iu.test(locale) ? `${url}.zh` : url;
}

// Production OpenPixo Cloud (Supabase). Public release builds bake it into the packaged
// app. The key is Supabase's public `sb_publishable_` client key (project openpixo-prod); the
// "anon" names here and in PIXO_CLOUD_ANON_KEY predate it.
export const PRODUCT_CLOUD_URL: string = 'https://mzaguxpokeuamhyyntnk.supabase.co';
export const PRODUCT_CLOUD_ANON_KEY: string =
  'sb_publishable_QS0WkfOnrWVRTAy1WIZESQ_AlkWzhJs';

// The hosted agent gateway runs apart from the Supabase project, on OpenPixo's own domain, so it
// can move again without an app update.
export const PRODUCT_AGENT_URL: string = 'https://api.openpixo.com';

export interface OpenPixoCloudConfig {
  url: string;
  anonKey: string;
  /** Base of the agent gateway: `<agentUrl>/agent-chat/...`. */
  agentUrl: string;
}

function cloudAddress(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
      || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * An HTTPS origin (loopback HTTP for development) and a single-line anon key, or null. The
 * production cloud has its gateway; any other cloud names one, or serves it as a function of its
 * own, as a local stand-in does. A gateway address that is present but invalid is null too.
 */
export function parseOpenPixoCloudConfig(
  rawUrl: string | undefined,
  rawAnonKey: string | undefined,
  rawAgentUrl?: string | undefined,
): OpenPixoCloudConfig | null {
  const urlText = rawUrl?.trim();
  const anonKey = rawAnonKey?.trim();
  if (!urlText || !anonKey || /[\r\n]/u.test(anonKey)) return null;
  const address = cloudAddress(urlText);
  if (address == null || address.pathname !== '/') return null;
  const url = address.origin;
  const agentText = rawAgentUrl?.trim();
  if (agentText) {
    const agent = cloudAddress(agentText);
    return agent == null ? null : { url, anonKey, agentUrl: `${agent.origin}${agent.pathname.replace(/\/+$/u, '')}` };
  }
  return { url, anonKey, agentUrl: url === PRODUCT_CLOUD_URL ? PRODUCT_AGENT_URL : `${url}/functions/v1` };
}

export const OPENPIXO_REGISTRY = {
  url: null as string | null,
  publicKeys: {} as Record<string, string>,
};

/** True only for the configured public product site. Empty means no destination. */
export function isProductSiteUrl(value: string): boolean {
  if (!PRODUCT_SITE_URL) return false;
  try { return new URL(value).origin === new URL(PRODUCT_SITE_URL).origin; }
  catch { return false; }
}
