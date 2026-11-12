// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { STAGE_ATTACHMENT_EVENT, type StageAttachmentEventDetail } from '../../src/runtime/chat/project-file-reference';
import { HomeHero } from '../../src/components/HomeHero';
import type { ProjectFile } from '../../src/types';
import { composerText, flushMounts, typeAndSettle } from '../helpers/lexical-composer';

const FILE: ProjectFile = {
  name: 'src/player.ts',
  path: 'src/player.ts',
  size: 12,
  mtime: 0,
  kind: 'code',
  mime: 'text/typescript',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  const props = {
    projectId: 'p1',
    projectFiles: [FILE],
    streaming: false,
    onEnsureProject: vi.fn(async () => 'p1'),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  return { ...render(<ChatComposer {...props} />), props };
}

function fileTransfer(payload: unknown) {
  const value = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    types: ['application/x-openpixo-project-file', 'text/plain'],
    files: [],
    items: [],
    getData: (type: string) => type === 'application/x-openpixo-project-file' ? value : FILE.name,
  };
}

describe('composer daily-use conveniences', () => {
  it('describes send/newline keys and updates the hint while the agent runs', async () => {
    const { rerender, props } = setup();
    await flushMounts();

    const hint = screen.getByTestId('chat-send-hint');
    expect(hint.textContent).toBe('Enter to send · Shift+Enter for a new line');
    expect(screen.getByTestId('chat-composer-input')).toHaveAttribute('aria-describedby', hint.id);

    rerender(<ChatComposer {...props} streaming />);
    expect(hint.textContent).toBe('Enter to queue · Esc to stop · Shift+Enter for a new line');
  });

  it.each([{ inputDisabled: true }, { sendDisabled: true }])('hides unavailable send hints for %j', async (overrides) => {
    setup(overrides);
    await flushMounts();
    expect(screen.queryByTestId('chat-send-hint')).toBeNull();
    expect(screen.getByTestId('chat-composer-input')).not.toHaveAttribute('aria-describedby');
  });

  it('adds a dropped project file as the same reference and attachment as the file picker', async () => {
    const { props } = setup({ projectFiles: [{ ...FILE, path: 'alternate/player.ts' }] });
    await flushMounts();
    await typeAndSettle('Inspect ');

    fireEvent.drop(screen.getByTestId('chat-composer-input'), {
      dataTransfer: fileTransfer({ projectId: 'p1', path: FILE.name }),
    });

    await waitFor(() => expect(composerText()).toBe('Inspect @src/player.ts '));
    expect(screen.getByTestId('staged-attachments')).toHaveTextContent('player');
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect(props.onSend).toHaveBeenCalledWith(
      'Inspect @src/player.ts',
      [expect.objectContaining({ path: FILE.name })],
      undefined,
    );
    expect(props.onEnsureProject).not.toHaveBeenCalled();
  });

  it.each([
    'not json',
    null,
    { projectId: 'other-project', path: FILE.name },
    { projectId: 'p1', path: 'missing.ts' },
    { projectId: 'p1', path: 123 },
  ])('ignores invalid or unavailable project references: %j', async (payload) => {
    setup();
    await flushMounts();
    await typeAndSettle('Keep this draft');
    fireEvent.drop(screen.getByTestId('chat-composer-input'), { dataTransfer: fileTransfer(payload) });
    expect(composerText()).toBe('Keep this draft');
    expect(screen.queryByTestId('staged-attachments')).toBeNull();
  });

  it('adds every file of a multi-file drag as a reference, images with a thumbnail', async () => {
    const sprite: ProjectFile = { name: 'art/hero.png', path: 'art/hero.png', size: 2048, mtime: 0, kind: 'image', mime: 'image/png' };
    const { props } = setup({ projectFiles: [FILE, sprite] });
    await flushMounts();
    fireEvent.drop(screen.getByTestId('chat-composer-input'), {
      dataTransfer: fileTransfer({ projectId: 'p1', path: sprite.name, paths: [sprite.name, FILE.name, 'missing.png'] }),
    });

    await waitFor(() => expect(composerText()).toBe('@art/hero.png @src/player.ts '));
    // Decorative thumbnail (alt=""), so it is read from the chip itself.
    const thumb = screen.getByTestId('staged-attachment-image').querySelector('img');
    expect(thumb?.getAttribute('src')).toContain('/api/projects/p1/raw/art/hero.png');
    expect(screen.getByRole('button', { name: 'Preview hero.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(props.onSend).toHaveBeenCalledWith(
      '@art/hero.png @src/player.ts',
      [expect.objectContaining({ path: sprite.name, kind: 'image' }), expect.objectContaining({ path: FILE.name, kind: 'file' })],
      undefined,
    );
  });

  it('acknowledges files staged from the File Browser and sends them as project references', async () => {
    const { props } = setup();
    await flushMounts();
    const event = new CustomEvent<StageAttachmentEventDetail>(STAGE_ATTACHMENT_EVENT, {
      cancelable: true,
      detail: { attachments: [{ path: 'art/hero.png', name: 'hero.png', kind: 'image', size: 2048 }] },
    });
    let delivered = true;
    act(() => { delivered = window.dispatchEvent(event); });
    // `false` = a composer took them, so the sender can say "added".
    expect(delivered).toBe(false);
    expect(await screen.findByTestId('staged-attachment-image')).toBeInTheDocument();
    await typeAndSettle('Use this sprite');
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(props.onSend).toHaveBeenCalledWith('Use this sprite',
      [expect.objectContaining({ path: 'art/hero.png', name: 'hero.png', kind: 'image' })], undefined);
  });

  it('leaves plain-text drops available to the editor', async () => {
    setup();
    await flushMounts();
    const allowed = fireEvent.drop(screen.getByTestId('chat-composer'), {
      dataTransfer: { types: ['text/plain'], files: [], items: [], getData: () => '' },
    });
    expect(allowed).toBe(true);
  });

  it('does not stage dropped references in a read-only composer', async () => {
    setup({ inputDisabled: true });
    await flushMounts();
    fireEvent.drop(screen.getByTestId('chat-composer-input'), {
      dataTransfer: fileTransfer({ projectId: 'p1', path: FILE.name }),
    });
    expect(composerText().trim()).toBe('');
    expect(screen.queryByTestId('staged-attachments')).toBeNull();
  });
});

describe('home composer keyboard hint', () => {
  it('shows the same send/newline keys and describes the home editor', async () => {
    render(
      <HomeHero
        prompt=""
        onPromptChange={vi.fn()}
        onSubmit={vi.fn()}
        activePluginTitle={null}
        onClearActivePlugin={vi.fn()}
        pluginOptions={[]}
        pluginsLoading={false}
        pendingPluginId={null}
        onPickPlugin={vi.fn()}
        contextItemCount={0}
        error={null}
      />,
    );
    await flushMounts();

    const hint = screen.getByTestId('home-hero-send-hint');
    expect(hint.textContent).toBe('Enter to send · Shift+Enter for a new line');
    expect(screen.getByTestId('home-hero-input')).toHaveAttribute('aria-describedby', hint.id);
  });
});
