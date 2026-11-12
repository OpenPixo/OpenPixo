// @vitest-environment jsdom

import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));



import { HomeView } from '../../src/components/HomeView';
import { stashHomeComposerAttachments } from '../../src/state/home-composer-stash';

import {
  createPluginUseHandoff,
} from '../../src/components/home-hero/plugin-authoring';
// HomeHero's `home-hero-input` is now the project composer's Lexical
// contenteditable, not a <textarea>. These helpers drive/read it through the
// live editor instead of synthetic `fireEvent.change` / `.value` (which are
// no-ops on a contenteditable).
import {
  homeHeroPromptText,
  setHomeHeroPrompt,
} from '../helpers/home-hero-lexical';

const AUTHORING_PLUGIN = {
  id: 'pixo-plugin-authoring',
  title: 'Plugin authoring',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/plugin-authoring',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/plugin-authoring',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'pixo-plugin-authoring',
    title: 'Plugin authoring',
    version: '0.1.0',
    description: 'Create plugins',
    pixo: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: { query: 'Create an OpenPixo plugin for {{pluginGoal}}.' },
      inputs: [
        {
          name: 'pluginGoal',
          type: 'string',
          required: false,
          default: 'a game asset helper',
          label: 'Plugin goal',
        },
      ],
    },
  },
};

const DEFAULT_PLUGIN = {
  ...AUTHORING_PLUGIN,
  id: 'pixo-new-generation',
  title: 'New generation',
  source: '/tmp/new-generation',
  fsPath: '/tmp/new-generation',
  manifest: {
    ...AUTHORING_PLUGIN.manifest,
    name: 'pixo-new-generation',
    title: 'New generation',
    description: 'Create new design artifacts',
    pixo: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: { query: 'Create a plugin.' },
    },
  },
};

const DOCUMENT_NEW_GENERATION_PLUGIN = {
  ...DEFAULT_PLUGIN,
  manifest: {
    ...DEFAULT_PLUGIN.manifest,
    pixo: {
      ...DEFAULT_PLUGIN.manifest.pixo,
      useCase: {
        query: 'Generate a {{artifactKind}} for {{audience}} on {{topic}}.',
      },
      inputs: [
        {
          name: 'artifactKind',
          type: 'string',
          required: true,
          label: 'Artifact kind',
        },
        {
          name: 'audience',
          type: 'string',
          required: true,
          label: 'Audience',
        },
        {
          name: 'topic',
          type: 'string',
          required: true,
          label: 'Topic',
        },
      ],
    },
  },
};

// Independent fixture for explicit plugin use and query hydration.
const GAME_PROTOTYPE_PLUGIN = {
  ...DEFAULT_PLUGIN,
  id: 'fixture-game-prototype',
  title: 'Web Prototype',
  source: '/tmp/web-prototype',
  fsPath: '/tmp/web-prototype',
  manifest: {
    ...DEFAULT_PLUGIN.manifest,
    name: 'fixture-game-prototype',
    title: 'Web Prototype',
    description: 'General-purpose desktop web prototype.',
    pixo: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: {
        query: 'Build a {{fidelity}} {{artifactKind}} for {{audience}} using {{designSystem}} from {{template}}.',
      },
      inputs: [
        {
          name: 'artifactKind',
          type: 'string',
          required: true,
          default: 'web prototype',
          label: 'Artifact kind',
        },
        {
          name: 'fidelity',
          type: 'select',
          required: true,
          options: ['wireframe', 'high-fidelity'],
          default: 'high-fidelity',
          label: 'Fidelity',
        },
        {
          name: 'audience',
          type: 'string',
          required: true,
          default: 'product evaluators',
          label: 'Audience',
        },
        {
          name: 'designSystem',
          type: 'string',
          default: 'the active project design system',
          label: 'Design system',
        },
        {
          name: 'template',
          type: 'string',
          default: 'the bundled web prototype seed',
          label: 'Template',
        },
      ],
    },
  },
};

// Same prototype scenario, carrying the facet fields (`pixo.mode`, `tags`) the
// Community taxonomy reads. 移动应用 narrows the example pool to the Apps facet
// (`filteredExamplePlugins` in HomeHero), so an example card only renders under
// that scene for a plugin the taxonomy can actually place there.


const SIMPLE_DECK_PLUGIN = {
  ...DEFAULT_PLUGIN,
  id: 'example-simple-deck',
  title: 'Simple Deck',
  source: '/tmp/simple-deck',
  fsPath: '/tmp/simple-deck',
  manifest: {
    ...DEFAULT_PLUGIN.manifest,
    name: 'example-simple-deck',
    title: 'Simple Deck',
    description: 'Single-file horizontal-swipe HTML deck.',
    pixo: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: {
        query: 'Create a {{deckType}} for {{audience}} about {{topic}} with {{slideCount}}. Speaker notes: {{speakerNotes}}. Use {{designSystem}}.',
      },
      inputs: [
        {
          name: 'deckType',
          type: 'select',
          required: true,
          options: ['pitch deck', 'product overview', 'study deck'],
          default: 'pitch deck',
          label: 'Deck type',
        },
        {
          name: 'topic',
          type: 'string',
          required: true,
          default: 'the user brief',
          label: 'Topic',
        },
        {
          name: 'audience',
          type: 'string',
          required: true,
          default: 'decision makers',
          label: 'Audience',
        },
        {
          name: 'slideCount',
          type: 'select',
          required: true,
          options: ['5-10 pages', '10-15 pages', '15-20 pages', '20-25 pages', '25-30 pages'],
          default: '10-15 pages',
          label: 'Pages',
        },
        {
          name: 'speakerNotes',
          type: 'select',
          options: ['include speaker notes', 'no speaker notes'],
          default: 'include speaker notes',
          label: 'Speaker notes',
        },
        {
          name: 'designSystem',
          type: 'string',
          default: 'the active project design system',
          label: 'Design system',
        },
      ],
    },
  },
};

const IMAGE_ASSET_PLUGIN = {
  ...DEFAULT_PLUGIN,
  id: 'pixo-media-generation',
  title: 'Image assets',
  source: '/tmp/image-assets',
  fsPath: '/tmp/image-assets',
  manifest: {
    ...DEFAULT_PLUGIN.manifest,
    name: 'pixo-media-generation',
    title: 'Image assets',
    description: 'Create image assets for a game.',
    pixo: {
      kind: 'scenario',
      taskKind: 'new-generation',
      mode: 'image',
      scenario: 'game-assets',
      useCase: {
        query: 'Create image assets for a game.',
      },
      context: {
        skills: [{ path: './SKILL.md' }],
      },
      pipeline: {
        stages: [{ id: 'generate', atoms: ['file-write', 'media-image'] }],
      },
    },
  },
};

const GAME_SPRITE_TEMPLATE_PLUGIN = {
  ...IMAGE_ASSET_PLUGIN,
  id: 'image-template-game-sprite',
  title: 'Game sprite',
  source: '/tmp/game-sprite',
  fsPath: '/tmp/game-sprite',
  manifest: {
    ...IMAGE_ASSET_PLUGIN.manifest,
    name: 'image-template-game-sprite',
    title: 'Game sprite',
    description: 'Create a transparent game sprite.',
    pixo: {
      ...IMAGE_ASSET_PLUGIN.manifest.pixo,
      mode: 'image',
      surface: 'image',
      useCase: {
        query: 'Create a transparent game sprite.',
      },
    },
  },
};

const AUTHORING_DEFAULT_SCENARIO_INPUTS = {
  artifactKind: 'OpenPixo plugin',
  audience: 'OpenPixo plugin authors',
  topic: 'packaging a reusable workflow as an OpenPixo plugin',
};



const AUTHORING_APPLY_RESULT = {
  query: 'Create a plugin.',
  contextItems: [],
  inputs: AUTHORING_PLUGIN.manifest.pixo.inputs,
  assets: [],
  mcpServers: [],
  trust: 'trusted',
  capabilitiesGranted: ['prompt:inject'],
  capabilitiesRequired: ['prompt:inject'],
  appliedPlugin: {
    snapshotId: 'snap-authoring',
    pluginId: 'pixo-plugin-authoring',
    pluginVersion: '0.1.0',
    manifestSourceDigest: 'a'.repeat(64),
    inputs: { pluginGoal: 'a game asset helper' },
    resolvedContext: { items: [] },
    capabilitiesGranted: ['prompt:inject'],
    capabilitiesRequired: ['prompt:inject'],
    assetsStaged: [],
    taskKind: 'new-generation',
    appliedAt: 0,
    mcpServers: [],
    status: 'fresh',
  },
  projectMetadata: {},
};

const DEFAULT_APPLY_RESULT = {
  ...AUTHORING_APPLY_RESULT,
  inputs: [],
  appliedPlugin: {
    ...AUTHORING_APPLY_RESULT.appliedPlugin,
    snapshotId: 'snap-default',
    pluginId: 'pixo-new-generation',
    inputs: AUTHORING_DEFAULT_SCENARIO_INPUTS,
  },
};

const DOCUMENT_NEW_GENERATION_APPLY_RESULT = {
  ...AUTHORING_APPLY_RESULT,
  query: DOCUMENT_NEW_GENERATION_PLUGIN.manifest.pixo.useCase.query,
  inputs: DOCUMENT_NEW_GENERATION_PLUGIN.manifest.pixo.inputs,
  appliedPlugin: {
    ...AUTHORING_APPLY_RESULT.appliedPlugin,
    snapshotId: 'snap-document-new-generation',
    pluginId: 'pixo-new-generation',
    inputs: {
      artifactKind: 'document',
      audience: 'readers',
      topic: 'the user brief',
    },
  },
};

const GAME_PROTOTYPE_APPLY_RESULT = {
  ...AUTHORING_APPLY_RESULT,
  query: GAME_PROTOTYPE_PLUGIN.manifest.pixo.useCase.query,
  inputs: GAME_PROTOTYPE_PLUGIN.manifest.pixo.inputs,
  appliedPlugin: {
    ...AUTHORING_APPLY_RESULT.appliedPlugin,
    snapshotId: 'snap-web-prototype',
    pluginId: 'fixture-game-prototype',
    inputs: {
      artifactKind: 'web prototype',
      fidelity: 'high-fidelity',
      audience: 'product evaluators',
      template: 'the bundled web prototype seed',
    },
  },
};

// A plugin whose useCase.query is a generator-facing meta-instruction (not a
// human-readable brief). use-with-query must surface the description instead,
// matching the Home example-prompt cards.
const META_INSTRUCTION_PLUGIN = {
  ...DEFAULT_PLUGIN,
  id: 'example-meta-landing',
  title: 'Meta Landing',
  source: '/tmp/meta-landing',
  fsPath: '/tmp/meta-landing',
  manifest: {
    ...DEFAULT_PLUGIN.manifest,
    name: 'example-meta-landing',
    title: 'Meta Landing',
    description: 'Cinematic parallax landing page.',
    pixo: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: {
        query: 'Follow the en field verbatim; start from the bundled example.html.',
      },
    },
  },
};

const META_INSTRUCTION_APPLY_RESULT = {
  ...GAME_PROTOTYPE_APPLY_RESULT,
  query: META_INSTRUCTION_PLUGIN.manifest.pixo.useCase.query,
  inputs: [],
  appliedPlugin: {
    ...GAME_PROTOTYPE_APPLY_RESULT.appliedPlugin,
    snapshotId: 'snap-meta-landing',
    pluginId: 'example-meta-landing',
    inputs: {},
  },
};

const GAME_SPRITE_APPLY_RESULT = {
  ...AUTHORING_APPLY_RESULT,
  query: IMAGE_ASSET_PLUGIN.manifest.pixo.useCase.query,
  inputs: [],
  appliedPlugin: {
    ...AUTHORING_APPLY_RESULT.appliedPlugin,
    snapshotId: 'snap-game-sprite',
    pluginId: 'pixo-media-generation',
    inputs: {},
  },
  projectMetadata: {
    kind: 'image',
  },
};

function stubAnimationFrame() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = window.setTimeout(() => cb(window.performance.now()), 0);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    window.clearTimeout(id);
  });
}

describe('HomeView prompt handoff', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps the existing sending state visible and preserves the draft when submit fails', async () => {
    let resolveSubmit: (accepted: boolean) => void = () => undefined;
    const submitResult = new Promise<boolean>((resolve) => {
      resolveSubmit = resolve;
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    stubAnimationFrame();

    render(
      <HomeView
        projects={[]}
        onSubmit={() => submitResult}
        onOpenProject={() => undefined}
      />,
    );

    await setPromptAndSettle('Create an image of a quiet reading room.');
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => {
      expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(true);
    });
    // The arrow never flashes a busy treatment; the disabled lock is the whole
    // in-flight state.
    expect(screen.getByTestId('home-hero-submit').getAttribute('aria-busy')).toBe('false');
    expect(homeHeroPromptValue()).toBe('Create an image of a quiet reading room.');

    await act(async () => {
      resolveSubmit(false);
      await submitResult;
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to start the run. Try again.',
    );
    expect(homeHeroPromptValue()).toBe('Create an image of a quiet reading room.');
    expect(screen.getByTestId('home-hero-submit').getAttribute('aria-busy')).toBe('false');
  });

  it('leaves a fresh Home unselected without applying a plugin or changing the draft', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (url === '/api/plugins') return new Response(JSON.stringify({ plugins: [GAME_PROTOTYPE_PLUGIN, SIMPLE_DECK_PLUGIN] }));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();
    window.localStorage.setItem('pixo:home-composer:prompt', 'Keep my draft');
    const onSubmit = vi.fn();
    render(<HomeView projects={[]} onSubmit={onSubmit} onOpenProject={() => undefined} />);
    expect(screen.queryByTestId('home-hero-type-pills-more')).toBeNull();
    expect(screen.queryByTestId('home-hero-template-picker')).toBeNull();
    expect(homeHeroPromptValue()).toBe('Keep my draft');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/apply'))).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('home-hero-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Keep my draft', projectKind: 'other',
    })));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('automaticStrategyTaskProfile');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginId');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginSelectionProvenance');
  });

  it('routes a plugin-use handoff from the Store as the active driver and submits it as the run driver', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [GAME_PROTOTYPE_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/api/plugins/fixture-game-prototype/apply-local')) {
        return new Response(JSON.stringify(GAME_PROTOTYPE_APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        promptHandoff={createPluginUseHandoff(1, 'fixture-game-prototype')}
      />,
    );

    // "Use" now routes the picked plugin as the active driver (so its own
    // pipeline + context apply on submit), not merely as background context.
    // The active-plugin badge surfaces and the plugin is applied; a plain
    // `use` leaves the draft empty (suppressPromptUpdate).
    await waitFor(() => {
      expect(screen.getByTestId('home-hero-active-plugin')).toBeTruthy();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/fixture-game-prototype/apply-local',
      expect.anything(),
    ));
    await screen.findByTestId('home-hero-input');
    expect(homeHeroPromptValue()).toBe('');

    // The user types their own brief over the empty draft, then submits — the
    // routed plugin (not pixo-default) must drive the created run. Mirrors the
    // P0 e2e "direct Use ... keeps the prompt freeform" flow.
    await setPromptAndSettle('Use the selected starter as the driver');
    await waitFor(() => {
      expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Use the selected starter as the driver',
      pluginId: 'fixture-game-prototype',
      appliedPluginSnapshotId: 'snap-web-prototype',
    })));
  });

  it('submits free-form prompts without applying a plugin', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [DEFAULT_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    await setPromptAndSettle('Make a launch page for a robotics studio');
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    expect(screen.queryByTestId('home-hero-active-plugin')).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Make a launch page for a robotics studio',
      appliedPluginSnapshotId: null,
      pluginInputs: { prompt: 'Make a launch page for a robotics studio' },
      projectKind: 'other',
    }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('pluginId');
  });

  it('appends a plugin-use query handoff without replacing an existing prompt', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [GAME_PROTOTYPE_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/api/plugins/fixture-game-prototype/apply-local')) {
        return new Response(JSON.stringify(GAME_PROTOTYPE_APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();

    const { rerender } = render(
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    await setPromptAndSettle('Keep my current brief');

    rerender(
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        promptHandoff={createPluginUseHandoff(2, 'fixture-game-prototype', {
          action: 'use-with-query',
        })}
      />,
    );

    const expectedPrompt = [
      'Keep my current brief',
      '',
      'Build a high-fidelity web prototype for product evaluators using the active project design system from the bundled web prototype seed.',
    ].join('\n');
    // `use-with-query` must APPEND the plugin query to the user's existing
    // draft, never replace it — this is the regression the reviewer flagged.
    await waitFor(() => {
      expect(homeHeroPromptText()).toBe(expectedPrompt);
    });
    expect(screen.queryByRole('dialog', { name: /replace current prompt/i })).toBeNull();
    // The plugin is now routed as the active driver (active-plugin badge),
    // and applied so its pipeline/context bind on submit.
    await waitFor(() => {
      expect(screen.getByTestId('home-hero-active-plugin')).toBeTruthy();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/fixture-game-prototype/apply-local',
      expect.anything(),
    ));
  });

  it('seeds the rendered query on use-with-query and writes placeholder edits back into inputs', async () => {
    // For a plugin whose query is already human-readable, use-with-query seeds
    // the rendered query itself. Because the seed came from the query (not a
    // description/meta-instruction fallback), the raw `{{...}}` template is kept
    // so editing a hydrated value in the composer flows back into pluginInputs
    // and submit resolves the snapshot from what the user sees.
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [GAME_PROTOTYPE_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/api/plugins/fixture-game-prototype/apply-local')) {
        return new Response(JSON.stringify(GAME_PROTOTYPE_APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    const { rerender } = render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    // Empty draft + use-with-query seeds the example-preset text into the editor.
    rerender(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        promptHandoff={createPluginUseHandoff(3, 'fixture-game-prototype', {
          action: 'use-with-query',
        })}
      />,
    );

    const seed =
      'Build a high-fidelity web prototype for product evaluators using the active project design system from the bundled web prototype seed.';
    await waitFor(() => expect(homeHeroPromptText()).toBe(seed));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/fixture-game-prototype/apply-local',
      expect.anything(),
    ));

    // The user edits the seeded audience; the placeholder edit flows back into
    // the submitted pluginInputs (not the stale applied default).
    const edited = seed.replace('product evaluators', 'enterprise architects');
    await setPromptAndSettle(edited);
    await waitFor(() => {
      expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'fixture-game-prototype',
      pluginInputs: expect.objectContaining({ audience: 'enterprise architects' }),
    })));
  });

  it('extracts a placeholder edit even after the use-with-query draft prefix is also edited', async () => {
    // The "tweak a preset before running" case: with an existing draft,
    // use-with-query appends the rendered query; the user then edits BOTH the
    // prefix and a hydrated placeholder. `queryTemplateAllowsPrefix` matches the
    // query as a suffix after any prefix, so the placeholder edit still reaches
    // pluginInputs and submit resolves the snapshot from the visible prompt.
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [GAME_PROTOTYPE_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/api/plugins/fixture-game-prototype/apply-local')) {
        return new Response(JSON.stringify(GAME_PROTOTYPE_APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    const { rerender } = render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    await setPromptAndSettle('Keep my current brief');

    rerender(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        promptHandoff={createPluginUseHandoff(4, 'fixture-game-prototype', {
          action: 'use-with-query',
        })}
      />,
    );

    const query =
      'Build a high-fidelity web prototype for product evaluators using the active project design system from the bundled web prototype seed.';
    const appended = `Keep my current brief\n\n${query}`;
    await waitFor(() => expect(homeHeroPromptText()).toBe(appended));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/fixture-game-prototype/apply-local',
      expect.anything(),
    ));

    const edited = appended
      .replace('Keep my current brief', 'Rewritten brief for the board')
      .replace('product evaluators', 'enterprise architects');
    await setPromptAndSettle(edited);
    await waitFor(() => {
      expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'fixture-game-prototype',
      pluginInputs: expect.objectContaining({ audience: 'enterprise architects' }),
    })));
  });

  it('extracts a placeholder edit after the user prepends an intro to an empty-draft use-with-query seed', async () => {
    // The empty-draft → add-prefix → edit-placeholder case: the seed lands in an
    // empty composer, then the user prepends an intro AND edits a hydrated value.
    // queryTemplateAllowsPrefix must stay on (we have a query template) so the
    // extractor matches the query as a suffix after the freshly-added prefix and
    // the placeholder edit still flows into pluginInputs.
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [GAME_PROTOTYPE_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/api/plugins/fixture-game-prototype/apply-local')) {
        return new Response(JSON.stringify(GAME_PROTOTYPE_APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    const { rerender } = render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    // Empty draft + use-with-query seeds the rendered query into the editor.
    rerender(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        promptHandoff={createPluginUseHandoff(6, 'fixture-game-prototype', {
          action: 'use-with-query',
        })}
      />,
    );

    const seed =
      'Build a high-fidelity web prototype for product evaluators using the active project design system from the bundled web prototype seed.';
    await waitFor(() => expect(homeHeroPromptText()).toBe(seed));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/fixture-game-prototype/apply-local',
      expect.anything(),
    ));

    // The user now PREPENDS an intro above the seed and edits the audience.
    const edited = `My intro for the board\n\n${seed.replace('product evaluators', 'enterprise architects')}`;
    await setPromptAndSettle(edited);
    await waitFor(() => {
      expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('home-hero-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'fixture-game-prototype',
      pluginInputs: expect.objectContaining({ audience: 'enterprise architects' }),
    })));
  });

  it('seeds the plugin description, not the raw meta-instruction query, on use-with-query', async () => {
    // The plugin's useCase.query is a generator-facing meta-instruction
    // ("follow the en field verbatim; start from example.html"). The Home
    // example-prompt cards surface the description instead; the detail modal's
    // prompt-loading "Use" (use-with-query) must do the same rather than
    // dumping the meta-instruction into the composer.
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [META_INSTRUCTION_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (typeof url === 'string' && url.includes('/api/plugins/example-meta-landing/apply-local')) {
        return new Response(JSON.stringify(META_INSTRUCTION_APPLY_RESULT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    const { rerender } = render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
      />,
    );

    await screen.findByTestId('home-hero-input');
    rerender(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        promptHandoff={createPluginUseHandoff(5, 'example-meta-landing', {
          action: 'use-with-query',
        })}
      />,
    );

    await waitFor(() => expect(homeHeroPromptText()).toBe('Cinematic parallax landing page.'));
    expect(homeHeroPromptText()).not.toContain('verbatim');
    expect(homeHeroPromptText()).not.toContain('example.html');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/plugins/example-meta-landing/apply-local',
      expect.anything(),
    ));
  });
});

// An empty Lexical editor renders `<p><br></p>` (a placeholder break node), so
// the DOM serializer in `homeHeroPromptText()` reads that lone `<br>` back as
// `'\n'`. The editor's real text is empty — `.textContent` is `''` — so this
// reads the empty case precisely without weakening the genuine-content path.
function homeHeroPromptValue(): string {
  const text = homeHeroPromptText();
  if (text === '\n' && (screen.getByTestId('home-hero-input').textContent ?? '') === '') {
    return '';
  }
  return text;
}

// Replace the Lexical editor's text the way a user edit would, then let the
// editor's OnChange → host `onPromptChange` React state update flush a
// microtask (mirrors lexical-composer's `typeAndSettle`) so flows that submit
// right after editing read the latest draft.
async function setPromptAndSettle(value: string): Promise<void> {
  setHomeHeroPrompt(value);
  await act(async () => {
    await Promise.resolve();
  });
}
