import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFontRecovery } from '../../src/runtime/font-recovery';

interface FakeFontFace {
  family: string;
  status: string;
  weight?: string;
  style?: string;
  stretch?: string;
  unicodeRange?: string;
  descriptors?: FontFaceDescriptors;
}

function fontRule(values: Record<string, string>): CSSFontFaceRule {
  return {
    type: 5,
    style: { getPropertyValue: (name: string) => values[name] ?? '' },
  } as unknown as CSSFontFaceRule;
}

function fontSheet(rules: CSSRule[], href = 'openpixo://app/_next/static/css/app.css'): CSSStyleSheet {
  return { cssRules: rules, href } as unknown as CSSStyleSheet;
}

function fakeDocument(
  faces: FakeFontFace[],
  sheets: CSSStyleSheet[] = [],
): { doc: Document; added: FakeFontFace[] } {
  const added: FakeFontFace[] = [];
  const doc = {
    baseURI: 'openpixo://app/',
    styleSheets: sheets,
    fonts: {
      forEach: (cb: (face: FakeFontFace) => void) => {
        for (const face of [...faces, ...added]) cb(face);
      },
      add: (face: FakeFontFace) => {
        added.push(face);
      },
    },
  } as unknown as Document;
  return { doc, added };
}

describe('installFontRecovery', () => {
  const loadMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    loadMock.mockReset().mockResolvedValue(undefined);
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'FontFace',
      class {
        family: string;
        descriptors?: FontFaceDescriptors;
        status = 'loaded';
        constructor(family: string, _source: unknown, descriptors?: FontFaceDescriptors) {
          this.family = family;
          this.descriptors = descriptors;
        }
        load = loadMock;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const serifSheet = () => fontSheet([fontRule({ 'font-family': 'Instrument Serif', src: 'url(/serif.woff2)' })]);

  it('re-registers an errored declared family from fetched bytes', async () => {
    const { doc, added } = fakeDocument([{ family: 'Instrument Serif', status: 'error' }], [serifSheet()]);
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(0);
    expect(added.map((f) => f.family)).toEqual(['Instrument Serif']);
    expect(fetchMock).toHaveBeenCalledWith('openpixo://app/serif.woff2');

    // Later sweeps must not stack duplicate registrations.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(added.filter((f) => f.family === 'Instrument Serif')).toHaveLength(1);
    cancel();
  });

  it('leaves healthy fonts alone', async () => {
    const { doc, added } = fakeDocument([{ family: 'Instrument Serif', status: 'loaded' }], [serifSheet()]);
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(added).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    cancel();
  });

  it('retries on a later sweep after a failed fetch', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('still congested'))
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const { doc, added } = fakeDocument([{ family: 'Instrument Serif', status: 'error' }], [serifSheet()]);
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(0);
    expect(added).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(added.map((f) => f.family)).toEqual(['Instrument Serif']);
    cancel();
  });

  it('does not re-register retired default font families', async () => {
    const { doc, added } = fakeDocument([
      { family: 'Albert Sans', status: 'error' },
      { family: 'JiduMono Pro', status: 'error' },
    ]);
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(0);
    expect(added).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    cancel();
  });

  it('recovers a generated Next font using its stylesheet-relative URL and variable weight', async () => {
    const { doc, added } = fakeDocument(
      [{ family: '__GeistSans_ab12', status: 'error', weight: '100 900' }],
      [fontSheet([fontRule({
        'font-family': '"__GeistSans_ab12"',
        'font-weight': '100 900',
        src: 'url("../media/geist.woff2") format("woff2")',
      })])],
    );
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('openpixo://app/_next/static/media/geist.woff2');
    expect(added).toEqual([expect.objectContaining({
      family: '__GeistSans_ab12', descriptors: { weight: '100 900' },
    })]);
    cancel();
  });

  it('recovers only the failed CJK subset and preserves its descriptors', async () => {
    const subset = (range: string, name: string) => fontRule({
      'font-family': '"Noto Serif SC"',
      'font-weight': '700',
      'font-display': 'swap',
      'unicode-range': range,
      src: `url(../media/${name}.woff2) format("woff2")`,
    });
    const { doc, added } = fakeDocument(
      [{ family: 'Noto Serif SC', status: 'error', weight: '700', unicodeRange: 'U+4E00-4E7F' }],
      [fontSheet([subset('U+4E00-4E7F', 'used'), subset('U+4E80-4EFF', 'unused')])],
    );
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('openpixo://app/_next/static/media/used.woff2');
    expect(added[0]?.descriptors).toEqual({
      weight: '700', display: 'swap', unicodeRange: 'U+4E00-4E7F',
    });
    cancel();
  });

  it('walks imports and grouped rules while skipping inaccessible stylesheets', async () => {
    const blocked = { get cssRules() { throw new Error('SecurityError'); } } as unknown as CSSStyleSheet;
    const imported = fontSheet([
      { type: 4, cssRules: [fontRule({
        'font-family': '"Instrument Serif"', src: 'url(serif.woff2)',
      })] } as unknown as CSSGroupingRule,
    ], 'openpixo://app/_next/static/serif.css');
    const { doc, added } = fakeDocument(
      [{ family: 'Instrument Serif', status: 'error' }],
      [blocked, fontSheet([{ type: 3, styleSheet: imported } as unknown as CSSImportRule])],
    );
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('openpixo://app/_next/static/serif.woff2');
    expect(added[0]?.family).toBe('Instrument Serif');
    cancel();
  });

  it.each([
    'https://fonts.example.test/serif.woff2',
    'openpixo://another-app/serif.woff2',
    'another-scheme://app/serif.woff2',
    'file:///serif.woff2',
  ])('does not recover a font outside the document origin: %s', async (url) => {
    const { doc, added } = fakeDocument(
      [{ family: 'Instrument Serif', status: 'error' }],
      [fontSheet([fontRule({ 'font-family': 'Instrument Serif', src: `url("${url}")` })])],
    );
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(added).toHaveLength(0);
    cancel();
  });

  it('does not duplicate a recovery request while an earlier sweep is still loading', async () => {
    let finishFetch!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { finishFetch = resolve; }));
    const { doc, added } = fakeDocument([{ family: 'Instrument Serif', status: 'error' }], [serifSheet()]);
    const cancel = installFontRecovery(doc);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finishFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await vi.advanceTimersByTimeAsync(0);

    expect(added).toHaveLength(1);
    cancel();
  });

  it('cancel stops pending sweeps', async () => {
    const { doc, added } = fakeDocument([{ family: 'Instrument Serif', status: 'error' }], [serifSheet()]);
    const cancel = installFontRecovery(doc);
    cancel();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(added).toHaveLength(0);
  });
});
