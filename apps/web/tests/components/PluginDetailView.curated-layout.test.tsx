// @vitest-environment jsdom

import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstalledPluginRecordSchema } from '@openpixo/contracts';

import { PluginDetailView } from '../../src/components/PluginDetailView';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return { ...actual, useAnalytics: () => ({ track: vi.fn() }) };
});

vi.mock('../../src/router', () => ({
  goBack: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../../src/state/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/projects')>();
  return { ...actual, applyPlugin: vi.fn() };
});

const PLUGIN = InstalledPluginRecordSchema.parse({
  id: 'research-suite',
  title: 'Research Suite',
  version: '2.4.0',
  sourceKind: 'bundled',
  source: '/plugins/research-suite',
  sourceMarketplaceId: 'official',
  sourceMarketplaceEntryName: 'openpixo/research-suite',
  trust: 'bundled',
  capabilitiesGranted: ['prompt:inject'],
  manifest: {
    name: 'research-suite',
    title: 'Research Suite',
    version: '2.4.0',
    description: 'Turn source material into a focused research brief.',
    license: 'MIT',
    compat: {
      agentSkills: [
        { path: ' skills/source-review/SKILL.md ' },
        { path: 'skills/source-review/SKILL.md' },
      ],
    },
    pixo: {
      kind: 'bundle',
      context: {
        skills: [{}, { ref: '   ' }],
      },
      preview: { entry: './preview.html' },
      useCase: {
        exampleOutputs: [{ path: './examples/research.html', title: 'Research example' }],
      },
      capabilities: ['prompt:inject'],
    },
  },
  fsPath: '/plugins/research-suite',
  installedAt: 0,
  updatedAt: 0,
});

function knowledgePlugin(
  id: string,
  skillPaths: string[] = ['./SKILL.md'],
) {
  return InstalledPluginRecordSchema.parse({
    id,
    title: `${id} knowledge suite`,
    version: '0.1.0',
    sourceKind: 'bundled',
    source: `/plugins/${id}`,
    sourceMarketplaceId: 'official',
    sourceMarketplaceEntryName: `openpixo/${id}`,
    trust: 'bundled',
    capabilitiesGranted: ['prompt:inject'],
    manifest: {
      name: id,
      title: `${id} knowledge suite`,
      version: '0.1.0',
      description: 'A neutral knowledge-skill fixture.',
      compat: {
        agentSkills: skillPaths.map((path) => ({ path })),
      },
      pixo: {
        kind: 'bundle',
        capabilities: ['prompt:inject'],
      },
    },
    fsPath: `/plugins/${id}`,
    installedAt: 0,
    updatedAt: 0,
  });
}

const KNOWLEDGE_PLUGIN = knowledgePlugin('knowledge-suite');
const KNOWLEDGE_SKILL_MARKDOWN = `---
name: game-research
description: >-
  A game research guide with safe Markdown descriptions.
---
# Game research
`;
const HOSTILE_KNOWLEDGE_SKILL_MARKDOWN = KNOWLEDGE_SKILL_MARKDOWN.replace(
  'A game research guide',
  'A <img src=x onerror=alert(1)> game research <script>globalThis.pwned = true</script> guide',
);

function markdownResponse(markdown: string, headers: Record<string, string> = {}) {
  return new Response(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Length': String(new TextEncoder().encode(markdown).byteLength),
      ...headers,
    },
  });
}

function mockKnowledgeDetailRequests(markdown = HOSTILE_KNOWLEDGE_SKILL_MARKDOWN) {
  vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `/api/plugins/${KNOWLEDGE_PLUGIN.id}`) {
      return new Response(JSON.stringify(KNOWLEDGE_PLUGIN), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === `/api/plugins/${KNOWLEDGE_PLUGIN.id}/asset/SKILL.md`) {
      return markdownResponse(markdown);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(PLUGIN), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PluginDetailView curated installed-extension layout', () => {

  it('renders the demo copy and official identity in Simplified Chinese', async () => {
    render(
      <I18nProvider initial="zh-CN">
        <PluginDetailView pluginId={PLUGIN.id} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: '返回列表' })).toBeTruthy();
    expect(screen.getByRole('region', { name: /快捷命令/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /数据连接/ })).toBeNull();
    expect(screen.getByRole('region', { name: /知识技能/ })).toBeTruthy();
    expect(screen.getByText('OpenPixo 官方')).toBeTruthy();
    expect(screen.getByText('OpenPixo', { selector: '.plugin-suite-detail__author' })).toBeTruthy();
  });

  it('renders a safe paragraph from a knowledge skill description', async () => {
    mockKnowledgeDetailRequests();

    const { container } = render(
      <I18nProvider initial="en">
        <PluginDetailView pluginId={KNOWLEDGE_PLUGIN.id} />
      </I18nProvider>,
    );

    const skills = await screen.findByRole('region', { name: /knowledge skills/i });
    const heading = within(skills).getByRole('heading', { name: './SKILL.md' });
    const article = heading.closest('article');
    await waitFor(() => {
      expect(article?.querySelector('p')).toHaveTextContent(
        'A game research guide with safe Markdown descriptions.',
      );
    });
    expect(article?.querySelector('p')?.textContent).not.toContain('>-');
    expect(article?.querySelector('img')).toBeNull();
    expect(article?.querySelector('script')).toBeNull();
    expect(article?.textContent).not.toContain('onerror');
    expect(article?.textContent).not.toContain('globalThis.pwned');
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('does not reuse a shared skill-path description while the next plugin asset is pending', async () => {
    const alpha = knowledgePlugin('alpha-suite');
    const beta = knowledgePlugin('beta-suite');
    let resolveBetaAsset: ((response: Response) => void) | undefined;
    const betaAsset = new Promise<Response>((resolve) => {
      resolveBetaAsset = resolve;
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `/api/plugins/${alpha.id}`) {
        return new Response(JSON.stringify(alpha), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === `/api/plugins/${beta.id}`) {
        return new Response(JSON.stringify(beta), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === `/api/plugins/${alpha.id}/asset/SKILL.md`) {
        return markdownResponse('---\ndescription: Alpha description\n---\n');
      }
      if (url === `/api/plugins/${beta.id}/asset/SKILL.md`) return betaAsset;
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const view = render(
      <I18nProvider initial="en">
        <PluginDetailView pluginId={alpha.id} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Alpha description')).toBeTruthy();

    view.rerender(
      <I18nProvider initial="en">
        <PluginDetailView pluginId={beta.id} />
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { name: beta.title })).toBeTruthy();
    const betaSkill = screen.getByRole('heading', { name: './SKILL.md' }).closest('article');
    expect(betaSkill?.querySelector('p')).toBeNull();
    expect(screen.queryByText('Alpha description')).toBeNull();

    resolveBetaAsset?.(markdownResponse('---\ndescription: Beta description\n---\n'));
  });

  it('bounds knowledge-skill asset count and concurrency and skips non-Markdown paths', async () => {
    const paths = [
      './one.md',
      './two.md',
      './three.md',
      './four.md',
      './five.md',
      './six.md',
      './seven.md',
      './eight.md',
      './nine.md',
      './notes.txt',
    ];
    const plugin = knowledgePlugin('bounded-suite', paths);
    const assetRequests: string[] = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `/api/plugins/${plugin.id}`) {
        return new Response(JSON.stringify(plugin), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      assetRequests.push(url);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return markdownResponse('---\ndescription: Bounded description\n---\n');
    });

    render(
      <I18nProvider initial="en">
        <PluginDetailView pluginId={plugin.id} />
      </I18nProvider>,
    );
    expect(await screen.findAllByText('Bounded description')).toHaveLength(8);
    expect(assetRequests).toHaveLength(8);
    expect(assetRequests.some((url) => url.endsWith('/notes.txt'))).toBe(false);
    expect(maxActiveRequests).toBeLessThanOrEqual(2);
  });

  it.each([
    {
      name: 'non-Markdown response media type',
      response: () => markdownResponse(
        '---\ndescription: Must not render\n---\n',
        { 'Content-Type': 'application/json' },
      ),
    },
    {
      name: 'declared oversized response',
      response: () => markdownResponse(
        '---\ndescription: Must not render\n---\n',
        { 'Content-Length': '1000000' },
      ),
    },
  ])('falls back to no description for a $name', async ({ response }) => {
    let assetResponse: Response | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `/api/plugins/${KNOWLEDGE_PLUGIN.id}`) {
        return new Response(JSON.stringify(KNOWLEDGE_PLUGIN), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      assetResponse = response();
      return assetResponse;
    });

    render(
      <I18nProvider initial="en">
        <PluginDetailView pluginId={KNOWLEDGE_PLUGIN.id} />
      </I18nProvider>,
    );
    const skillHeading = await screen.findByRole('heading', { name: './SKILL.md' });
    await waitFor(() => expect(assetResponse).toBeDefined());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(assetResponse?.bodyUsed).toBe(true);
    expect(skillHeading.closest('article')?.querySelector('p')).toBeNull();
  });

  it.each([
    { name: 'missing Content-Length', contentLength: undefined },
    { name: 'underreported Content-Length', contentLength: '1' },
  ])('cancels a streamed response over the byte cap with $name', async ({ contentLength }) => {
    let streamCancelled = false;
    const chunk = new TextEncoder().encode('x'.repeat(40_000));
    let chunksSent = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksSent >= 3) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        chunksSent += 1;
      },
      cancel() {
        streamCancelled = true;
      },
    }), {
      headers: {
        'Content-Type': 'text/markdown',
        ...(contentLength === undefined ? {} : { 'Content-Length': contentLength }),
      },
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `/api/plugins/${KNOWLEDGE_PLUGIN.id}`) {
        return new Response(JSON.stringify(KNOWLEDGE_PLUGIN), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return response;
    });

    render(
      <I18nProvider initial="en">
        <PluginDetailView pluginId={KNOWLEDGE_PLUGIN.id} />
      </I18nProvider>,
    );
    const skillHeading = await screen.findByRole('heading', { name: './SKILL.md' });
    await waitFor(() => expect(streamCancelled).toBe(true));
    expect(skillHeading.closest('article')?.querySelector('p')).toBeNull();
  });
});
