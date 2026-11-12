// Under the packaged openpixo:// custom protocol, a CSS font request can fail
// inside Chromium's font loader even when fetch() of the same URL succeeds.
// An errored CSS FontFace is terminal — Chromium never retries it.
//
// Recovery bypasses the font loader entirely: fetch the bytes over the
// (working) fetch path and register an in-memory FontFace built from the
// ArrayBuffer. A successfully loaded JS FontFace joins font matching
// alongside the errored CSS one and the glyphs repaint immediately. The
// same sweep also self-heals dev/HTTP sessions where a font fetch lost a
// startup race.
type RecoverableFont = {
  family: string;
  url: string;
  descriptors?: FontFaceDescriptors;
};

// Sweep immediately on mount; later sweeps catch fonts whose fetch failed
// while startup was still congested.
const RETRY_DELAYS_MS = [0, 4_000, 15_000, 45_000];

function fontFamily(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function erroredFaces(doc: Document): FontFace[] {
  const errored: FontFace[] = [];
  if (!doc.fonts || typeof doc.fonts.forEach !== 'function') return errored;
  doc.fonts.forEach((face) => {
    if (face.status === 'error') errored.push(face);
  });
  return errored;
}

const DESCRIPTORS = [
  ['font-weight', 'weight'],
  ['font-style', 'style'],
  ['font-stretch', 'stretch'],
  ['font-display', 'display'],
  ['font-feature-settings', 'featureSettings'],
  ['font-variation-settings', 'variationSettings'],
  ['unicode-range', 'unicodeRange'],
  ['ascent-override', 'ascentOverride'],
  ['descent-override', 'descentOverride'],
  ['line-gap-override', 'lineGapOverride'],
] as const;

function normalizedDescriptor(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/^normal$/, '400').replace(/^bold$/, '700');
}

function matchesFace(face: FontFace, font: RecoverableFont): boolean {
  if (fontFamily(face.family) !== font.family) return false;
  const descriptors = font.descriptors ?? {};
  // Match the failed slice, not just its family: Noto Serif SC declares many
  // independent unicode-range files, most of which have never been requested.
  return (['weight', 'style', 'stretch', 'unicodeRange'] as const).every((key) => {
    const actual = face[key];
    const expected = descriptors[key] ?? (key === 'unicodeRange' ? 'U+0-10FFFF' : 'normal');
    return !actual || normalizedDescriptor(actual) === normalizedDescriptor(expected);
  });
}

function sameOriginFontUrl(source: string, base: string, doc: Document): string | null {
  try {
    const url = new URL(source, base);
    const documentUrl = new URL(doc.baseURI);
    // Custom-scheme origins serialize as "null"; comparing origin strings
    // would accidentally accept another scheme or another openpixo host.
    if (!['http:', 'https:', 'openpixo:'].includes(url.protocol)) return null;
    return url.protocol === documentUrl.protocol && url.host === documentUrl.host ? url.href : null;
  } catch {
    return null;
  }
}

function declaredErroredFonts(doc: Document, errored: FontFace[]): RecoverableFont[] {
  const fonts: RecoverableFont[] = [];
  const visited = new Set<CSSStyleSheet>();
  const visitRules = (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      // Numeric CSSOM constants keep this usable in lightweight DOM hosts.
      if (rule.type === 5) {
        const style = (rule as CSSFontFaceRule).style;
        const font: RecoverableFont = {
          family: fontFamily(style.getPropertyValue('font-family')),
          url: '',
          descriptors: {},
        };
        for (const [cssName, descriptor] of DESCRIPTORS) {
          const value = style.getPropertyValue(cssName).trim();
          if (value) Object.assign(font.descriptors!, { [descriptor]: value });
        }
        if (!errored.some((face) => matchesFace(face, font))) continue;
        const source = style.getPropertyValue('src');
        for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)) {
          const url = sameOriginFontUrl((match[1] ?? match[2] ?? match[3] ?? '').trim(), base, doc);
          if (!url) continue;
          fonts.push({ ...font, url });
          break;
        }
      } else if (rule.type === 3) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) visitSheet(imported);
      } else if ('cssRules' in rule) {
        visitRules((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };
  const visitSheet = (sheet: CSSStyleSheet) => {
    if (visited.has(sheet)) return;
    visited.add(sheet);
    try {
      visitRules(sheet.cssRules, sheet.href ?? doc.baseURI);
    } catch {
      // A cross-origin stylesheet can refuse CSSOM access. Other accessible
      // sheets must still be recoverable.
    }
  };
  for (const sheet of Array.from(doc.styleSheets ?? [])) visitSheet(sheet);
  return fonts;
}

async function recoverFont(doc: Document, font: RecoverableFont): Promise<boolean> {
  try {
    const resp = await fetch(font.url);
    if (!resp.ok) return false;
    const bytes = await resp.arrayBuffer();
    const face = new FontFace(font.family, bytes, font.descriptors);
    await face.load();
    doc.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedules post-startup sweeps that re-load any recoverable font whose
 * CSS-declared FontFace settled in the terminal `error` state. Idempotent
 * per call; returns a cancel function for unmount/tests.
 */
export function installFontRecovery(doc: Document = document): () => void {
  const recovered = new Set<string>();
  const pending = new Set<string>();
  const timers: ReturnType<typeof setTimeout>[] = [];

  const sweep = async () => {
    for (const font of declaredErroredFonts(doc, erroredFaces(doc))) {
      const key = JSON.stringify(font);
      if (recovered.has(key) || pending.has(key)) continue;
      pending.add(key);
      try {
        if (await recoverFont(doc, font)) recovered.add(key);
      } finally {
        pending.delete(key);
      }
    }
  };

  for (const delay of RETRY_DELAYS_MS) {
    timers.push(setTimeout(() => void sweep(), delay));
  }
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
