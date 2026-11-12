// @vitest-environment jsdom


import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type InstalledPluginRecord, type McpServerConfig, type SkillSummary } from '@openpixo/contracts';

const workspaceA: null = null;
let workspaceContextState: {
  context: null | null;
  loading: boolean;
  failure?: 'unsupported';
  identityChangePending?: boolean;
} = { context: null, loading: false };

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

// Team plugin projections load after stream activation. This suite exercises
// context serialization; supply the same readiness signal as a live workspace.




import { HomeView } from '../../src/components/HomeView';

import { homeHeroPromptText, setHomeHeroPrompt } from '../helpers/home-hero-lexical';

// HomeHero's prompt input migrated from a <textarea>+highlight overlay to the
// same Lexical contenteditable the project composer uses. The `home-hero-input`
// hook is now a contenteditable <div> with no `.value`, so:
//   - driving text uses `setHomeHeroPrompt(...)` (a real `editor.update`) where
//     the old tests did `fireEvent.change(input, { target: { value } })`.
//   - reading text uses `homeHeroPromptText()` where they read `input.value`.
// Picking from the @-picker still inserts an atomic mention PILL whose literal
// text is `@<token>`, and the editor appends a trailing space — so serialized
// editor text carries that space (the host trims it before submit).

// Settle the Lexical update listener's onChange/onTrigger React state updates
// (they flush a microtask after the discrete editor update) before asserting,
// mirroring the project composer's `typeAndSettle`.
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

const SKILL: SkillSummary = {
  id: 'prototype-lab',
  name: 'Prototype Lab',
  description: 'Create a focused prototype.',
  triggers: ['prototype', 'flow'],
  mode: 'prototype',
  previewType: 'html',
  defaultFor: [],
  upstream: null,
  hasBody: true,
  examplePrompt: 'Design a focused onboarding prototype.',
  aggregatesExamples: false,
};

const DECK_SKILL: SkillSummary = {
  ...SKILL,
  id: 'deck-lab',
  name: 'Deck Lab',
  description: 'Create a focused slide deck.',
  triggers: ['deck', 'slides'],
  mode: 'deck',
  examplePrompt: 'Design a focused investor deck.',
};

const GAME_PROTOTYPE_PLUGIN = makePlugin('fixture-game-prototype', 'Game Prototype');
const MCP_SERVER: McpServerConfig = {
  id: 'linear',
  label: 'Linear',
  transport: 'stdio',
  enabled: true,
  command: 'npx',
};

function makePlugin(id: string, title: string): InstalledPluginRecord {
  return {
    id,
    title,
    version: '1.0.0',
    sourceKind: 'bundled',
    source: `/tmp/${id}`,
    trust: 'bundled',
    capabilitiesGranted: ['prompt:inject'],
    fsPath: `/tmp/${id}`,
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: id,
      title,
      version: '1.0.0',
      description: `${title} fixture`,
      tags: ['fixture'],
      pixo: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: {
          query: `Hydrated query from ${title}`,
        },
      },
    },
  };
}

afterEach(() => {
  workspaceContextState = { context: workspaceA, loading: false };
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

// #5517 removed the inline template rail from Home; scenario templates are
// picked from the composer footer's radial Template picker instead.


describe('HomeView context picker', () => {


  it('stages pasted files on Home and submits them as first-turn context', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const onSubmit = vi.fn();
    const file = new File(['brief'], 'brief.pdf', { type: 'application/pdf' });

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    const input = await screen.findByTestId('home-hero-input');
    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    expect(screen.getByTestId('composer-plus-attach')).toBeTruthy();
    // Lexical's PastePlugin reads `clipboardData.files` (the old textarea path
    // read `clipboardData.items[].getAsFile()`); the staged-file outcome is
    // identical, only the clipboard shape the handler inspects changed.
    fireEvent.paste(input, {
      clipboardData: {
        files: [file],
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
      },
    });

    await waitFor(() => expect(screen.getByText('brief.pdf')).toBeTruthy());
    await waitFor(() => expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '',
      attachments: [file],
    }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginId');
  });

  // OPEND-3085: the Home Add menu carries the same rows as the project
  // composer's — the context actions sit flat below "Attach files" and the
  // resource submenus follow, while the working directory keeps its own row
  // under the input instead of a submenu group.
  it('lists the Demo Add-menu rows on Home', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        onBrowseRegistry={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    const menu = screen.getAllByRole('menu')[0] as HTMLElement;
    const rows = Array.from(
      menu.querySelectorAll<HTMLElement>(
        ':scope > .plus-menu__item, :scope > .plus-menu__submenu-row > .plus-menu__parent',
      ),
    ).map((row) => row.getAttribute('data-testid'));
    expect(rows).toEqual([
      'composer-plus-attach',
      'composer-plus-reference-project',
      'composer-plus-local-code',
      'composer-plus-plugins',
      'composer-plus-mcp',
    ]);
    expect(screen.queryByTestId('composer-plus-working-dir')).toBeNull();
    // The working directory stays on its own row under the input.
    expect(screen.getByTestId('working-dir-trigger')).toBeTruthy();
  });

  // OPEND-3126: the two context actions are reachable from the Add menu ONLY.
  // The working-directory menu under the input is back to its folder rows, so
  // "Reference another project" and "Link local code" are not offered twice.
  it('keeps reference-project and local-code out of the working-directory menu (OPEND-3126)', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        onBrowseRegistry={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    fireEvent.click(screen.getByTestId('working-dir-trigger'));
    const panel = await screen.findByTestId('working-dir-panel');
    expect(screen.getByTestId('working-dir-pick')).toBeTruthy();
    expect(screen.queryByTestId('working-dir-reference-project')).toBeNull();
    expect(screen.queryByTestId('working-dir-local-code')).toBeNull();
    expect(panel.textContent).not.toContain('Reference another project');
    expect(panel.textContent).not.toContain('Link local code');
    // No stray separator either: the panel is one group of folder rows again.
    expect(panel.querySelector('[role="separator"]')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    // …and the Add menu still carries both, unchanged.
    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    expect(screen.getByTestId('composer-plus-reference-project')).toBeTruthy();
    expect(screen.getByTestId('composer-plus-local-code')).toBeTruthy();
  });

  it('adds multiple @ plugins as context without applying or hydrating their query', async () => {
    const plugins = [
      makePlugin('chart-plugin', 'Chart Plugin'),
      makePlugin('deck-plugin', 'Deck Plugin'),
    ];
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Build @chart');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /chart plugin/i }));

    // Picking inserts an atomic plugin mention pill (`@Chart Plugin`) plus a
    // trailing space, and stages the plugin as context in HomeView state. The
    // inline pill is now the only on-screen representation of the staged context
    // (the duplicate top context-badge row was removed), so the submit payload
    // below is the authoritative check that the plugin was staged.
    await waitFor(() => {
      expect(homeHeroPromptText().trim()).toBe('Build @Chart Plugin');
    });

    // Re-seed the draft with a fresh `@deck` trigger appended after the first
    // mention (the old test did the equivalent full-value replace). Picking the
    // second plugin reconstructs both mention pills via the host's draft sync.
    setHomeHeroPrompt('Build @Chart Plugin @deck');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /deck plugin/i }));

    await waitFor(() => {
      expect(homeHeroPromptText().trim()).toBe('Build @Chart Plugin @Deck Plugin');
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/apply'))).toBe(false);
    expect(homeHeroPromptText()).not.toContain('Hydrated query');

    await waitFor(() => expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Build @Chart Plugin @Deck Plugin',
      contextPlugins: [
        expect.objectContaining({ id: 'chart-plugin', title: 'Chart Plugin' }),
        expect.objectContaining({ id: 'deck-plugin', title: 'Deck Plugin' }),
      ],
    }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginId');
  });

  it('binds a selected home skill to the created project payload', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        skills={[SKILL]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('@proto');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /prototype lab/i }));

    await waitFor(() => {
      expect(homeHeroPromptText().trim()).toBe('@Prototype Lab');
      expect(screen.getByTestId('home-hero-active-skill')).toBeTruthy();
    });

    await waitFor(() => expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '@Prototype Lab',
      skillId: SKILL.id,
      projectKind: 'prototype',
    }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginId');
  });

  it('blocks submit when referenced project context folder is missing', async () => {
    const referenceProject = {
      id: 'reference-a',
      name: 'Reference A',
      skillId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'prototype' },
    };
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // These cases render HomeView with an active Workspace context, so the
      // reference-project picker reads the workspace-scoped catalog. The
      // unscoped `/api/projects` route only ever serves unbound projects
      // (OPEND-2370), which is why it cannot stand in for this one.
      if (typeof url === 'string' && url.startsWith('/api/workspaces/workspace-a/projects')) {
        return new Response(JSON.stringify({
          projects: [
            { project: referenceProject,  visibility: 'personal' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/projects') {
        return new Response(JSON.stringify({ projects: [referenceProject] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && (url === '/api/projects/reference-a' || url.startsWith('/api/projects/reference-a?'))) {
        return new Response(JSON.stringify({
          project: referenceProject,
          resolvedDir: '/tmp/openpixo/missing-reference-a',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/dir-exists' && init?.method === 'POST') {
        return new Response(JSON.stringify({ exists: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    // 引用其它项目 lives in the "+" menu only (OPEND-3126); the pick still
    // lands on the working-directory trigger below.
    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    fireEvent.click(await screen.findByTestId('composer-plus-reference-project'));
    await screen.findByText('Reference A');
    fireEvent.click(screen.getByRole('button', { name: 'Reference project' }));

    // The TRIGGER takes the reference's name and the prompt is left alone (per
    // product: 工作目录会换成后边的文件名，不要在上边的输入框展示).
    await waitFor(() => {
      expect(screen.getByTestId('working-dir-trigger').textContent).toContain('Reference A');
    });
    expect(homeHeroPromptText().trim()).toBe('');
    // A reference on its own is not a request; type first, then submit.
    setHomeHeroPrompt('Describe this');
    await settle();
    await waitFor(() => expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('selected reference folder');
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(homeHeroPromptText().trim()).toBe('Describe this');
    expect(screen.getByTestId('working-dir-trigger').textContent).toContain('Reference A');
  });

  it('keeps referenced project context visible after its inline mention is deleted', async () => {
    const referenceProject = {
      id: 'reference-a',
      name: 'Reference A',
      skillId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'prototype' },
    };
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/mcp/servers') {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // These cases render HomeView with an active Workspace context, so the
      // reference-project picker reads the workspace-scoped catalog. The
      // unscoped `/api/projects` route only ever serves unbound projects
      // (OPEND-2370), which is why it cannot stand in for this one.
      if (typeof url === 'string' && url.startsWith('/api/workspaces/workspace-a/projects')) {
        return new Response(JSON.stringify({
          projects: [
            { project: referenceProject,  visibility: 'personal' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/projects') {
        return new Response(JSON.stringify({ projects: [referenceProject] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && (url === '/api/projects/reference-a' || url.startsWith('/api/projects/reference-a?'))) {
        return new Response(JSON.stringify({
          project: referenceProject,
          resolvedDir: '/tmp/openpixo/reference-a',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url === '/api/dir-exists' && init?.method === 'POST') {
        return new Response(JSON.stringify({ exists: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    // 引用其它项目 lives in the "+" menu only (OPEND-3126); the pick still
    // lands on the working-directory trigger below.
    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    fireEvent.click(await screen.findByTestId('composer-plus-reference-project'));
    await screen.findByText('Reference A');
    fireEvent.click(screen.getByRole('button', { name: 'Reference project' }));

    // Nothing lands in the prompt — the working-directory trigger is the only
    // place the reference shows, exactly like a picked folder.
    await waitFor(() => {
      expect(screen.getByTestId('working-dir-trigger').textContent).toContain('Reference A');
    });
    expect(homeHeroPromptText()).not.toContain('@Reference A');
    setHomeHeroPrompt('Describe this');
    await settle();

    expect(screen.getByTestId('working-dir-trigger').textContent).toContain('Reference A');
    await waitFor(() => expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Describe this',
      initialRunContext: {
        workspaceItems: [
          expect.objectContaining({
            id: 'project:reference-a',
            kind: 'project',
            label: 'Reference A',
            absolutePath: '/tmp/openpixo/reference-a',
          }),
        ],
      },
      linkedDirs: ['/tmp/openpixo/reference-a'],
    }));
  });
});
