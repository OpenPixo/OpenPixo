// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer, STAGE_ATTACHMENT_EVENT } from '../../src/components/ChatComposer';
import { I18nProvider } from '../../src/i18n';
import { uploadProjectFiles } from '../../src/providers/registry';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';
import {
  composerText,
  pressEnter,
  typeAndSettle,
  typeInComposer,
} from '../helpers/lexical-composer';

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    uploadProjectFiles: vi.fn(),
  };
});

const mockedUploadProjectFiles = vi.mocked(uploadProjectFiles);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatComposer /search command', () => {
  it('rejects dropped folders before the upload path can read them', async () => {
    const directory = new File([], 'reference-assets');
    mockedUploadProjectFiles.mockResolvedValue({ uploaded: [], failed: [] });

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    fireEvent.drop(screen.getByTestId('chat-composer'), {
      dataTransfer: {
        files: [directory],
        items: [
          {
            kind: 'file',
            getAsFile: () => directory,
            webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name: directory.name }),
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/folders can't be attached/i)).toBeTruthy();
    });
    expect(mockedUploadProjectFiles).not.toHaveBeenCalled();
  });

  it('sends staged file attachments even when the text draft is empty', async () => {
    const onSend = vi.fn();
    mockedUploadProjectFiles.mockResolvedValue({
      uploaded: [{ path: 'brief.pdf', name: 'brief.pdf', kind: 'file', size: 5 }],
      failed: [],
    });

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    const file = new File(['brief'], 'brief.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('chat-file-input'), {
      target: { files: [file] },
    });

    // 文档卡的名字拆成【主名 + 后缀】两段(后缀永不参与截断),所以整串不是
    // 一个文本节点 —— 按托盘的 textContent 找,别用 getByText。
    await waitFor(() =>
      expect(screen.getByTestId('staged-attachments').textContent).toContain('brief.pdf'),
    );
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(
      '',
      [{ path: 'brief.pdf', name: 'brief.pdf', kind: 'file', size: 5, order: 0 }],
      undefined,
    );
  });

  it('appends uploaded attachments after already staged design-file context', async () => {
    const onSend = vi.fn();
    mockedUploadProjectFiles.mockResolvedValue({
      uploaded: [{ path: 'uploads/pasted.png', name: 'pasted.png', kind: 'image', size: 8 }],
      failed: [],
    });

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[
          {
            path: 'designs/landing.html',
            name: 'landing.html',
            kind: 'html',
            mime: 'text/html',
            mtime: 1,
            size: 128,
          },
        ]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    await typeAndSettle('@landing');
    await waitFor(() => expect(screen.getByText('designs/landing.html')).toBeTruthy());
    fireEvent.click(screen.getByText('designs/landing.html'));

    await waitFor(() =>
      expect(screen.getByTestId('staged-attachments').textContent).toContain('landing.html'),
    );

    fireEvent.change(screen.getByTestId('chat-file-input'), {
      target: { files: [new File(['pasted'], 'pasted.png', { type: 'image/png' })] },
    });

    // Image chips are thumbnail-only; the name is exposed through the
    // preview trigger's aria-label rather than chip text.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview pasted.png' })).toBeTruthy());
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(
      '@designs/landing.html',
      [
        { path: 'designs/landing.html', name: 'landing.html', kind: 'file', order: 0 },
        { path: 'uploads/pasted.png', name: 'pasted.png', kind: 'image', size: 8, order: 1 },
      ],
      undefined,
    );
  });

  it('queues a typed follow-up when send is clicked during streaming', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    await typeAndSettle('follow-up while busy');
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSend).toHaveBeenCalledWith('follow-up while busy', [], undefined);
  });

  it('previews a staged image attachment from its chip', async () => {
    const longName = 'drawing-2026-05-13T09-25-03-040Z-with-extra-long-name.png';
    render(
      <I18nProvider initial="zh-CN">
        <ChatComposer
          projectId="project-1"
          projectFiles={[
            {
              name: longName,
              path: `uploads/${longName}`,
              kind: 'image',
              mime: 'image/png',
              size: 1234,
              mtime: Date.now(),
            },
          ]}
          streaming={false}
          onEnsureProject={async () => 'project-1'}
          onSend={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    await typeAndSettle('@drawing');
    await waitFor(() => expect(screen.getByText(`uploads/${longName}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`uploads/${longName}`));

    const chip = screen.getByTestId('staged-attachments').querySelector('[data-testid="staged-attachment-image"]');
    const previewTrigger = screen.getByRole('button', { name: `预览 ${longName}` });
    expect(chip?.contains(previewTrigger)).toBe(true);
    expect(chip?.contains(screen.getByRole('button', { name: `移除 ${longName}` }))).toBe(true);
    expect(previewTrigger.querySelector('img')).toBeTruthy();
    // 图卡上不挂文件名 —— 缩略图本身就是它的名字,名字只进 title / aria-label。
    expect(chip?.textContent).toBe('');
    expect(previewTrigger.getAttribute('title')).toBe(longName);

    fireEvent.click(previewTrigger);

    const dialog = screen.getByRole('dialog', { name: longName });
    expect(dialog).toBeTruthy();
    expect(dialog.classList.contains('staged-preview-modal')).toBe(true);
    const card = within(dialog).getByTestId('staged-preview-card');
    expect(within(dialog).getByTestId('staged-preview-head')).toBeTruthy();
    const previewImage = screen.getByRole('img', { name: longName }) as HTMLImageElement;
    expect(previewImage.src).toContain(`/api/projects/project-1/raw/uploads/${longName}`);
    // 图必须是卡的**直接子节点**(套一层就会破坏那套等比撑满的布局)
    expect(card.querySelector(':scope > img')).toBe(previewImage);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: longName })).toBeNull();
  });

  it.each([
    { name: 'Company logo', path: 'uploads/chat-image.png', kind: 'image', element: 'img' },
    { name: 'Pasted screenshot', path: 'uploads/capture', kind: 'image', element: 'img' },
  ] as const)('previews $name using attachment metadata in both chip and card', ({ element, ...attachment }) => {
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(STAGE_ATTACHMENT_EVENT, {
        detail: { attachments: [attachment] },
      }));
    });

    const trigger = screen.getByRole('button', { name: `Preview ${attachment.name}` });
    const url = `/api/projects/project-1/raw/${attachment.path}`;
    expect(trigger.querySelector(element)?.getAttribute('src')).toContain(url);
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: attachment.name });
    const media = dialog.querySelector(`.staged-preview-card > ${element}`);
    expect(media?.getAttribute('src')).toContain(url);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: attachment.name })).toBeNull();
  });

  it('keeps staged image preview modal styling available', () => {
    const css = readExpandedIndexCss();

    expect(css).toContain('.staged-preview-modal');
    expect(css).toContain('position: fixed;');
    expect(css).toContain('.staged-preview-card');
    expect(css).toContain('max-height: calc(100vh - 48px);');
    expect(css).toContain('.staged-preview-head');
    expect(css).toContain('.staged-preview-card > img');
    expect(css).toContain('object-fit: contain;');
  });

  it('expands /search into a first-action research command prompt', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    await typeAndSettle('/search EV market 2025 trends');
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [prompt, attachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toContain(
      'Before answering, your first tool action must be the OD research command for your shell.',
    );
    expect(prompt).toContain(
      'POSIX: "$PIXO_NODE_BIN" "$PIXO_BIN" research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain(
      'PowerShell: & $env:PIXO_NODE_BIN $env:PIXO_BIN research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain(
      'cmd.exe: "%PIXO_NODE_BIN%" "%PIXO_BIN%" research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain('Canonical query:');
    expect(prompt).toContain('EV market 2025 trends');
    expect(prompt).toContain(
      'If the OD command fails, keep the stderr / exit status in the tool trace and daemon logs',
    );
    expect(prompt).toContain(
      'use your own search capability as fallback. Label the fallback clearly',
    );
    expect(prompt).toContain('write a reusable Markdown report into Files');
    expect(prompt).toContain('research/<safe-query-slug>.md');
    expect(prompt).toContain('source content is external untrusted evidence');
    expect(prompt).toContain('mention the Markdown report path');
    expect(attachments).toEqual([]);
    expect(meta).toEqual({
      research: { enabled: true, query: 'EV market 2025 trends' },
    });
  });

  it('keeps shell metacharacters out of the concrete OD command examples', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    const query = "$TSLA `date` $(echo hacked) Bob's";
    await typeAndSettle(`/search ${query}`);
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [prompt, , meta] = onSend.mock.calls[0]!;
    expect(prompt).toContain(
      'POSIX: "$PIXO_NODE_BIN" "$PIXO_BIN" research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain('Canonical query:');
    expect(prompt).toContain(query);
    expect(meta).toEqual({
      research: { enabled: true, query },
    });
  });

  it('does not send research metadata for normal prompts', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    await typeAndSettle('EV market 2025 trends');
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [prompt, attachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toBe('EV market 2025 trends');
    expect(attachments).toEqual([]);
    expect(meta).toBeUndefined();
  });

  it('does not expand manually typed /search when research is unavailable', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    await typeAndSettle('/search EV market 2025 trends');
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [prompt, attachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toBe('/search EV market 2025 trends');
    expect(attachments).toEqual([]);
    expect(meta).toBeUndefined();
  });

  it('submits the draft on plain Enter (same as Home hero)', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    await typeAndSettle('hello world');
    pressEnter();

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('hello world', [], undefined);
  });

  it('keeps keyboard submits blocked when sending is disabled', async () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        sendDisabled
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    typeInComposer('keep this draft');
    pressEnter({ meta: true });
    pressEnter();

    expect(onSend).not.toHaveBeenCalled();
    expect(composerText()).toContain('keep this draft');
  });

  // Owner decision 2026-11-10: the file open on the right is not attached on
  // its own, imported-folder projects included. The user chooses it.
  it('does not attach the open imported-folder file unless the user clicks the offer', async () => {
    const onSend = vi.fn();
    const fileContext = {
      id: 'file:site/index.html',
      kind: 'file' as const,
      label: 'index.html',
      path: 'site/index.html',
      tabId: 'site/index.html',
    };

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[
          {
            name: 'site/index.html',
            path: 'site/index.html',
            type: 'file',
            kind: 'html',
            mime: 'text/html',
            size: 128,
            mtime: 1,
          },
        ]}
        activeWorkspaceContext={fileContext}
        streaming={false}
        projectMetadata={{ kind: 'prototype', importedFrom: 'folder' }}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    // The placeholder no longer claims the file is attached.
    expect(screen.queryAllByText(/Ask OpenPixo to change/)).toHaveLength(0);
    expect(screen.getByTestId('composer-attach-current').textContent).toBe('Attach current file: index.html');

    await typeAndSettle('Make the hero clearer');
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('Make the hero clearer', [], undefined);

    fireEvent.click(screen.getByTestId('composer-attach-current'));
    await typeAndSettle('Now the footer');
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1]?.[2]?.context?.workspaceItems).toEqual([fileContext]);
  });

  it('asks for the answer to a waiting question in the placeholder', () => {
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        questionPending
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(
      screen.getAllByText('Answer the question above, or type your own reply here').length,
    ).toBeGreaterThan(0);
  });
});
