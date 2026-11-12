// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOpenPixoHostAvailable, pickHostWorkingDir } from '@openpixo/host';
import {
  NewProjectPanel,
} from '../../src/components/NewProjectPanel';
import { openFolderDialog } from '../../src/providers/registry';
import { DEFAULT_IMAGE_MODEL } from '../../src/media/models';
import type { SkillSummary } from '../../src/types';

vi.mock('@openpixo/host', async () => {
  const actual = await vi.importActual<typeof import('@openpixo/host')>('@openpixo/host');
  return {
    ...actual,
    isOpenPixoHostAvailable: vi.fn(),
    pickHostWorkingDir: vi.fn(),
  };
});

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    openFolderDialog: vi.fn(),
  };
});

const mockedIsHostAvailable = vi.mocked(isOpenPixoHostAvailable);
const mockedPickHostWorkingDir = vi.mocked(pickHostWorkingDir);
const mockedOpenFolderDialog = vi.mocked(openFolderDialog);

const skills: SkillSummary[] = [
  {
    id: 'prototype-skill',
    name: 'Prototype',
    description: 'Build prototypes',
    mode: 'prototype',
    surface: 'web',
    previewType: 'html',
    defaultFor: ['prototype'],
    triggers: [],
    upstream: null,
    hasBody: true,
    examplePrompt: 'Build a prototype.',
    aggregatesExamples: false,
  },
];



afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
});

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  mockedIsHostAvailable.mockReturnValue(false);
  mockedOpenFolderDialog.mockResolvedValue(null);
});

describe('NewProjectPanel media metadata', () => {

  it('saves image creation with the selected aspect and trimmed style notes metadata', () => {
    const onCreate = vi.fn();
    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'Image payload metadata' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '3:4' }));
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Image payload metadata',
        metadata: expect.objectContaining({
          kind: 'image',
            imageModel: DEFAULT_IMAGE_MODEL,
          imageAspect: '3:4',
        }),
      }),
    );
  });

  it('saves video creation with the selected aspect and duration metadata', () => {
    const onCreate = vi.fn();
    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByTestId('new-project-media-surface-video'));
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'Video payload metadata' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '9:16' }));
    fireEvent.change(screen.getByLabelText('Length'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Video payload metadata',
        metadata: expect.objectContaining({
          kind: 'video',
          videoModel: 'doubao-seedance-2-0-260128',
          videoAspect: '9:16',
          videoLength: 10,
        }),
      }),
    );
  });

  it('saves audio creation with the selected duration and trimmed voice metadata', () => {
    const onCreate = vi.fn();
    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'Audio payload metadata' },
    });
    fireEvent.change(screen.getByLabelText('Duration'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByPlaceholderText('Provider voice id, optional'), {
      target: { value: '  soft contralto guide  ' },
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Audio payload metadata',
        metadata: expect.objectContaining({
          kind: 'audio',
          audioKind: 'speech',
          audioModel: 'minimax-tts',
          audioDuration: 30,
          voice: 'soft contralto guide',
        }),
      }),
    );
  });

  it('exposes sound effects audio projects and switches to the ElevenLabs SFX model', () => {
    const onCreate = vi.fn();
    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    expect(screen.getByRole('button', { name: 'SFX' })).toBeTruthy();
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'Impact sound payload' },
    });
    fireEvent.change(screen.getByLabelText('Duration'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SFX' }));
    expect(screen.getByTestId('model-picker-trigger').textContent).toContain('elevenlabs-sfx');
    expect(screen.queryByPlaceholderText('Provider voice id, optional')).toBeNull();
    const durationSelect = screen.getByLabelText('Duration') as HTMLSelectElement;
    expect(Array.from(durationSelect.options).map((option) => option.value)).toEqual(['5', '10', '15', '30']);
    expect(durationSelect.value).toBe('30');

    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Impact sound payload',
        metadata: expect.objectContaining({
          kind: 'audio',
          audioKind: 'sfx',
          audioModel: 'elevenlabs-sfx',
          audioDuration: 30,
        }),
      }),
    );
    expect(onCreate.mock.calls[0]?.[0].metadata).not.toHaveProperty('voice');
  });

  it('pins skillId to hyperframes when the video model is hyperframes-html, regardless of skill discovery order', () => {
    // Reproduces PR #866 mrcfps's reported regression: when daemon `readdir()`
    // returns video skills in an order that puts `video-shortform` ahead of
    // `hyperframes`, the previous `list[0]?.id` fallback would route the
    // HyperFrames-HTML model through `video-shortform`, dropping the
    // hyperframes SKILL body and the html-in-canvas preflight. The fix forces
    // the create-time skillId to `hyperframes` whenever `hyperframes-html` is
    // the chosen model.
    const onCreate = vi.fn();
    const videoSkills: SkillSummary[] = [
      {
        id: 'video-shortform',
        name: 'Video shortform',
        description: 'Shortform video skill',
        mode: 'video',
        surface: 'video',
        previewType: 'video',
        defaultFor: [],
        triggers: [],
        upstream: null,
        hasBody: true,
        examplePrompt: '',
        aggregatesExamples: false,
      },
      {
        id: 'hyperframes',
        name: 'HyperFrames',
        description: 'HTML-in-canvas video',
        mode: 'video',
        surface: 'video',
        previewType: 'video',
        defaultFor: [],
        triggers: [],
        upstream: null,
        hasBody: true,
        examplePrompt: '',
        aggregatesExamples: false,
      },
    ];

    render(
      <NewProjectPanel
        skills={videoSkills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByTestId('new-project-media-surface-video'));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    fireEvent.click(screen.getByTestId('model-picker-option-hyperframes-html'));
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'HyperFrames routing' },
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'HyperFrames routing',
        skillId: 'hyperframes',
        metadata: expect.objectContaining({
          kind: 'video',
          videoModel: 'hyperframes-html',
        }),
      }),
    );
  });
});

describe('NewProjectPanel working directory picker', () => {
  it('includes a browser-picked working directory in the create payload', async () => {
    const onCreate = vi.fn();
    mockedIsHostAvailable.mockReturnValue(false);
    mockedOpenFolderDialog.mockResolvedValue('/Users/me/product-designs');

    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Local storage' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /product-designs/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          userWorkingDir: '/Users/me/product-designs',
        }),
      }),
    );
    expect(mockedPickHostWorkingDir).not.toHaveBeenCalled();
  });

  it('threads the desktop host working-dir token into the create payload', async () => {
    const onCreate = vi.fn();
    mockedIsHostAvailable.mockReturnValue(true);
    mockedPickHostWorkingDir.mockResolvedValue({
      ok: true,
      baseDir: '/Users/me/host-designs',
      token: 'host-token',
    });

    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Local storage' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /host-designs/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userWorkingDirToken: 'host-token',
        metadata: expect.objectContaining({
          userWorkingDir: '/Users/me/host-designs',
        }),
      }),
    );
    expect(mockedOpenFolderDialog).not.toHaveBeenCalled();
  });

  it('surfaces host picker failures without falling back to an untokened browser path', async () => {
    mockedIsHostAvailable.mockReturnValue(true);
    mockedPickHostWorkingDir.mockResolvedValue({
      ok: false,
      reason: 'host build does not support pickWorkingDir',
    });

    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Local storage' }));

    expect(await screen.findByText(/Couldn't open the folder picker/i)).toBeTruthy();
    expect(mockedOpenFolderDialog).not.toHaveBeenCalled();
  });

  it('surfaces browser picker daemon failures with localized copy and native details', async () => {
    mockedIsHostAvailable.mockReturnValue(false);
    mockedOpenFolderDialog.mockRejectedValue(new Error('Could not open folder picker: zenity is not installed'));

    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Local storage' }));

    expect(await screen.findByText('Could not open folder picker')).toBeTruthy();
    expect(await screen.findByText('zenity is not installed')).toBeTruthy();
    expect(screen.queryByText('Could not open folder picker: zenity is not installed')).toBeNull();
    expect(mockedOpenFolderDialog).toHaveBeenCalledWith({ throwOnError: true });
  });
});

describe('NewProjectPanel folder import feedback', () => {

  it('shows an error when folder picker import rejects with a daemon message', async () => {
    const onImportFolder = vi.fn().mockRejectedValue(new Error('folder not found'));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url) => {
      if (typeof url === 'string' && url === '/api/dialog/open-folder') {
        return new Response(
          JSON.stringify({ path: '/missing/project' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(
      <NewProjectPanel
        skills={skills}

        promptTemplates={[]}
        onCreate={vi.fn()}
        onImportFolder={onImportFolder}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open game project' }));

    await waitFor(() => {
      expect(onImportFolder).toHaveBeenCalledWith('/missing/project');
    });
    expect(await screen.findByText('folder not found')).toBeTruthy();
  });
});
