// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, } from '@testing-library/react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';


import {
  FILES_TAB,
  FileWorkspace,
} from '../../src/components/FileWorkspace';
import { FilesPanel } from '../../src/components/FilesPanel';
import {
  defaultChatPanelWidthForSplit,
  projectSplitClassName,
  projectSplitStyle,
} from '../../src/components/ProjectView';
import {
  fetchProjectFileText,
  uploadProjectFiles,
  writeProjectTextFile,
  fetchProjectFolders,
} from '../../src/providers/registry';
import type { ChatMessage, OpenTabsState, ProjectFile, ProjectFolder } from '../../src/types';
import {
  ProjectPreviewProvider,
  type ProjectPreviewContextValue,
} from "../../src/components/project-preview-context";
import { IframeKeepAliveProvider } from '../../src/components/IframeKeepAlivePool';

// These cases exercise the 资源库 file browser and the viewers the panel
// stacks over it; the other views' contents have their own coverage.
vi.mock('../../src/components/tuning/tuning-api', async () => ({
  ...(await vi.importActual<typeof import('../../src/components/tuning/tuning-api')>('../../src/components/tuning/tuning-api')),
  listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })),
}));
vi.mock('../../src/components/GameAssetsPanel', () => ({ GameAssetsPanel: () => <div>Asset gallery</div> }));
vi.mock('../../src/components/studio/StudioPanel', () => ({ StudioPanel: () => <div>Studio</div> }));
vi.mock('../../src/components/ProjectExtensionsPanel', () => ({ ProjectExtensionsPanel: () => <div>Extensions</div> }));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    fetchProjectFileText: vi.fn(),
    uploadProjectFiles: vi.fn(),
    writeProjectBase64File: vi.fn(),
    writeProjectTextFile: vi.fn(),
    fetchProjectFolders: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../src/components/workspace/TerminalViewer', () => ({
  TerminalViewer: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal-viewer">{terminalId}</div>
  ),
}));

const { excalidrawWorkspaceMock } = vi.hoisted(() => ({
  excalidrawWorkspaceMock: {
    lastProps: null as Record<string, any> | null,
  },
}));

// Records the `folders` prop FilesPanel receives on EVERY render (still
// renders the real component). Lets a test observe the first render after a
// project switch — the pre-paint frame RTL's post-rerender DOM assertion can't
// see — to prove no stale folders ever reach the new panel.
const { designFilesPanelRenders } = vi.hoisted(() => ({
  designFilesPanelRenders: [] as { projectId: string; folderCount: number }[],
}));
vi.mock('../../src/components/FilesPanel', async () => {
  const actual = await vi.importActual<typeof import('../../src/components/FilesPanel')>(
    '../../src/components/FilesPanel',
  );
  const Real = actual.FilesPanel;
  return {
    ...actual,
    FilesPanel: (props: Parameters<typeof Real>[0]) => {
      designFilesPanelRenders.push({
        projectId: props.projectId,
        folderCount: props.folders?.length ?? 0,
      });
      return <Real {...props} />;
    },
  };
});

const mockedFetchProjectFileText = vi.mocked(fetchProjectFileText);
const mockedUploadProjectFiles = vi.mocked(uploadProjectFiles);
const chatCss = readFileSync(join(process.cwd(), 'src/styles/chat.css'), 'utf8');
const routinesCss = readFileSync(join(process.cwd(), 'src/styles/viewer/routines.css'), 'utf8');

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let composerCssStyle: HTMLStyleElement | null = null;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Needed else the ResizeObserver in SketchEditor crashes the test
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

beforeEach(() => {
  mockedFetchProjectFileText.mockResolvedValue('');
  // The panel opens on 游戏 by default; these suites start in 资源库, where
  // the file browser lives (the default itself is covered in
  // FileWorkspace.panel.test.tsx).
  const realGetItem = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(this: Storage, key: string) {
    return key.startsWith('pixo:project-panel-view:') ? 'library' : realGetItem.call(this, key);
  });
});

afterEach(() => {
  cleanup();
  excalidrawWorkspaceMock.lastProps = null;
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.classList.remove('pixo-quick-switcher-open');
  document.querySelectorAll('.chat-composer-fixed-layer').forEach((node) => node.remove());
  composerCssStyle?.remove();
  composerCssStyle = null;
  host?.remove();
  host = null;
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function baseFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'mock.png',
    path: 'mock.png',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'image',
    mime: 'image/png',
    ...overrides,
  };
}

function workspaceFile(name: string): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 100,
    mtime: 1700000000,
    kind: name.endsWith('.html') ? 'html' : 'text',
    mime: name.endsWith('.html') ? 'text/html' : 'text/plain',
  };
}



function collabValue(workspaceContext: null): ProjectPreviewContextValue {
  return { projectResourceAuthority: 'local' };
}

function cssDeclarations(css: string, selector: string): string {
  const blocks: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  if (blocks.length === 0) throw new Error(`Missing CSS block for ${selector}`);
  return blocks.join('\n');
}

function installComposerIsolationCss() {
  const rules = [
    ['.chat-composer-fixed-layer', chatCss],
    ['.chat-composer-fixed-layer .composer', chatCss],
    ['.composer-input-wrap', chatCss],
    ['.composer-input-wrap:focus-within', chatCss],
    ['.composer-input-editor .composer-editable', chatCss],
    ['.composer-input-placeholder', chatCss],
    ['.chat-composer-fixed-layer .composer-shell', routinesCss],
    ['.chat-composer-fixed-layer .composer.drag-active .composer-shell', routinesCss],
    ['.chat-composer-fixed-layer .composer-input-wrap', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-shell', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer.drag-active .composer-shell', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-input-wrap', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-input-wrap:focus-within', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-input-editor .composer-editable', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-input-placeholder', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-context-row', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-chip', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-context', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-name', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-context .staged-icon', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-chip .staged-icon', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .staged-chip .staged-remove', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-active-file', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-row .icon-btn', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-send', routinesCss],
    ['body.pixo-quick-switcher-open .chat-composer-fixed-layer .composer-send:disabled', routinesCss],
  ] as const;
  composerCssStyle = document.createElement('style');
  composerCssStyle.textContent = rules
    .map(([selector, css]) => `${selector} {${cssDeclarations(css, selector)}}`)
    .join('\n');
  document.head.appendChild(composerCssStyle);
}

function renderWorkspace(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
  return host;
}

// A file the user opens from the conversation: lands on 资源库's stack, the
// way switching to an already-open tab used to.
let chatOpenNonce = 0;
let setChatOpenRequest: ((name: string) => void) | null = null;
type ChatOpenRequest = { name: string; nonce: number; origin: 'conversation' };
function useChatOpenRequest(): ChatOpenRequest | null {
  const [request, setRequest] = useState<ChatOpenRequest | null>(null);
  setChatOpenRequest = (name) => setRequest({ name, nonce: ++chatOpenNonce, origin: 'conversation' });
  return request;
}
function openFromChat(name: string) {
  act(() => setChatOpenRequest?.(name));
}
function showView(name: 'Game' | 'Changes' | 'Files') {
  fireEvent.click(screen.getByRole('tab', { name }));
}

function renderFilesPanel(overrides: Partial<React.ComponentProps<typeof FilesPanel>> = {}) {
  const props: React.ComponentProps<typeof FilesPanel> = {
    projectId: 'project-1',
    projectKind: 'prototype',
    files: [],
    onRefreshFiles: vi.fn(),
    onOpenFile: vi.fn(),
    onRenameFile: vi.fn(),
    onDeleteFile: vi.fn(),
    onDeleteFiles: vi.fn(),
    onUpload: vi.fn(),
    onUploadFiles: vi.fn(),
    onPaste: vi.fn(),
    ...overrides,
  };
  return render(<FilesPanel {...props} />);
}

describe('FileWorkspace quick switcher visual isolation', () => {
  it('moves focus into quick search and marks the document while the overlay is open', async () => {
    installComposerIsolationCss();

    const composerLayer = document.createElement('div');
    composerLayer.className = 'chat-composer-fixed-layer';
    composerLayer.innerHTML = `
      <div class="composer drag-active">
        <div class="composer-shell">
          <div class="staged-row staged-context-row">
            <div class="staged-chip staged-context staged-context--workspace">
              <span class="staged-icon">F</span>
              <span class="staged-name">
                <span class="staged-context-kind">Current</span>manual-edit.html
              </span>
              <button class="staged-remove" type="button">x</button>
            </div>
            <div class="staged-chip staged-file">
              <span class="staged-icon">F</span>
              <span class="staged-name">hero.png</span>
              <button class="staged-remove" type="button">x</button>
            </div>
          </div>
          <div class="composer-active-file">
            <span class="composer-active-file__label">Current</span>
            <span class="composer-active-file__name">manual-edit.html</span>
          </div>
          <div class="composer-input-wrap">
            <div class="composer-input-editor">
              <div class="composer-editable" contenteditable="true" tabindex="0">Mock focused composer control</div>
              <div class="composer-input-placeholder">Describe what you want to generate...</div>
            </div>
          </div>
          <div class="composer-row">
            <button class="icon-btn" type="button">+</button>
            <button class="composer-send" type="button" disabled>Send</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(composerLayer);

    const composer = composerLayer.querySelector<HTMLElement>('.composer');
    const composerShell = composerLayer.querySelector<HTMLElement>('.composer-shell');
    const composerInputWrap = composerLayer.querySelector<HTMLElement>('.composer-input-wrap');
    const composerControl = composerLayer.querySelector<HTMLElement>('.composer-editable');
    const composerPlaceholder = composerLayer.querySelector<HTMLElement>('.composer-input-placeholder');
    const stagedContext = composerLayer.querySelector<HTMLElement>('.staged-context');
    const stagedContextKind = composerLayer.querySelector<HTMLElement>('.staged-context-kind');
    const stagedIcon = composerLayer.querySelector<HTMLElement>('.staged-context .staged-icon');
    const stagedRemove = composerLayer.querySelector<HTMLElement>('.staged-context .staged-remove');
    const stagedFile = composerLayer.querySelector<HTMLElement>('.staged-file');
    const stagedFileIcon = composerLayer.querySelector<HTMLElement>('.staged-file > .staged-icon');
    const stagedFileRemove = composerLayer.querySelector<HTMLElement>('.staged-file > .staged-remove');
    const stagedFileName = composerLayer.querySelector<HTMLElement>('.staged-file .staged-name');
    const activeFileChip = composerLayer.querySelector<HTMLElement>('.composer-active-file');
    const toolbarIcon = composerLayer.querySelector<HTMLElement>('.icon-btn');
    const toolbarSend = composerLayer.querySelector<HTMLElement>('.composer-send');
    if (!composer) throw new Error('Missing mock composer');
    if (!composerShell) throw new Error('Missing mock composer shell');
    if (!composerInputWrap) throw new Error('Missing mock composer input wrapper');
    if (!composerControl) throw new Error('Missing mock composer control');
    if (!composerPlaceholder) throw new Error('Missing mock composer placeholder');
    if (!stagedContext) throw new Error('Missing mock staged context');
    if (!stagedContextKind) throw new Error('Missing mock staged context kind');
    if (!stagedIcon) throw new Error('Missing mock staged context icon');
    if (!stagedRemove) throw new Error('Missing mock staged context remove');
    if (!stagedFile) throw new Error('Missing mock staged file');
    if (!stagedFileIcon) throw new Error('Missing mock staged file icon');
    if (!stagedFileRemove) throw new Error('Missing mock staged file remove');
    if (!stagedFileName) throw new Error('Missing mock staged file name');
    if (!activeFileChip) throw new Error('Missing mock active file chip');
    if (!toolbarIcon) throw new Error('Missing mock toolbar icon');
    if (!toolbarSend) throw new Error('Missing mock toolbar send');

    expect(getComputedStyle(composerLayer).pointerEvents).toBe('none');
    expect(getComputedStyle(composer).pointerEvents).toBe('auto');
    expect(getComputedStyle(composerControl).pointerEvents).toBe('auto');

    composerControl.focus();
    expect(document.activeElement).toBe(composerControl);

    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('index.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });

    await waitFor(() => {
      expect(document.body.classList.contains('pixo-quick-switcher-open')).toBe(true);
    });
    const quickSearchInput = screen.getByRole('textbox');
    await waitFor(() => {
      expect(document.activeElement).toBe(quickSearchInput);
    });
    await waitFor(() => {
      expect(getComputedStyle(composer).pointerEvents).toBe('none');
    });
    expect(getComputedStyle(composerLayer).pointerEvents).toBe('none');
    expect(getComputedStyle(composerLayer).opacity).toBe('0.58');
    expect(getComputedStyle(composerControl).pointerEvents).toBe('none');
    expect(getComputedStyle(composerShell).boxShadow).toBe('none');
    expect(getComputedStyle(composerShell).borderColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(composerInputWrap).background).toBe('var(--bg-fill-tertiary)');
    expect(getComputedStyle(composerInputWrap).borderColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(composerInputWrap).boxShadow).toBe('none');
    expect(getComputedStyle(composerControl).color).toBe('var(--text-muted)');
    expect(getComputedStyle(composerControl).caretColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(composerPlaceholder).color).toBe('color-mix(in srgb, var(--text-muted) 72%, transparent)');
    for (const toolbarControl of [
      stagedContext,
      stagedIcon,
      stagedRemove,
      stagedFile,
      stagedFileIcon,
      stagedFileRemove,
      activeFileChip,
      toolbarIcon,
      toolbarSend,
    ]) {
      expect(getComputedStyle(toolbarControl).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(toolbarControl).borderColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(toolbarControl).boxShadow).toBe('none');
    }
    expect(getComputedStyle(stagedContextKind).color).toBe('var(--text-muted)');
    expect(getComputedStyle(stagedFileName).color).toBe('var(--text-muted)');

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(document.body.classList.contains('pixo-quick-switcher-open')).toBe(false);
    });
    await waitFor(() => {
      expect(getComputedStyle(composer).pointerEvents).toBe('auto');
    });
    expect(getComputedStyle(composerControl).pointerEvents).toBe('auto');
    expect(getComputedStyle(composerLayer).opacity).not.toBe('0.58');
    /*
     * 关掉快速切换之后,输入框要退回它自己的底色 —— 判据是「**不再是**那层
     * `--bg-fill-tertiary` 隔离罩」,而不是某个具体颜色值。
     *
     * 原来这里钉的是 `rgb(255, 255, 255)`,依据是 #5517 那次改版把静息底色做成
     * `--bg-panel`/`--bg-subtle` 的 `color-mix` 微调、"在测试主题里解析成白"。
     * 可 jsdom 解析不了 `color-mix`,那一格现在返回 `rgba(0, 0, 0, 0)` ——
     * 钉具体颜色等于钉住了 jsdom 的解析能力,不是钉住产品行为。
     */
    expect(getComputedStyle(composerInputWrap).background).not.toBe('var(--bg-fill-tertiary)');
  });
});

function unreadableDropDataTransfer(fallbackFiles: File[] = []) {
  return {
    files: fallbackFiles,
    items: [
      {
        webkitGetAsEntry: () => ({
          isFile: true,
          isDirectory: false,
          name: 'stale.png',
          file: (_done: (file: File) => void, fail?: (error: DOMException) => void) => {
            fail?.(new DOMException('missing', 'NotFoundError'));
          },
        }),
      },
    ],
  };
}

describe('FileWorkspace upload input', () => {
  it('keeps the Files picker aligned with drag-and-drop file support', () => {
    const markup = renderToStaticMarkup(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="file-list-upload-input"');
    expect(markup).not.toContain('accept=');
  });

  it('reports an upload failure until dismissed, and opens a file on a single card click', async () => {
    mockedUploadProjectFiles.mockRejectedValueOnce(new Error('storage offline'));
    const onTabsStateChange = vi.fn();

    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[baseFile()]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={onTabsStateChange}
      />,
    );

    fireEvent.change(screen.getByTestId('file-list-upload-input'), {
      target: { files: [new File(['mock'], 'mock.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-banner').textContent).toContain(
        "Couldn't upload 1 file(s).",
      );
    });

    fireEvent.click(screen.getByTestId('upload-error-dismiss'));
    expect(screen.queryByTestId('upload-error-banner')).toBeNull();

    // One click on the row's name opens the file (资源库 lists by default).
    const row = screen.getByTestId('design-file-row-mock.png');
    const openButton = row.querySelector<HTMLButtonElement>('.df-row-name-btn');
    if (!openButton) throw new Error('Could not find the row open button');
    fireEvent.click(openButton);

    await waitFor(() =>
      expect(onTabsStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ active: 'mock.png' }),
      ),
    );
  });

  it('keeps partial upload failures visible after a successful file opens', async () => {
    mockedUploadProjectFiles.mockResolvedValueOnce({
      uploaded: [
        {
          path: 'uploaded.png',
          name: 'uploaded.png',
          kind: 'image',
          size: 1024,
        },
      ],
      failed: [{ name: 'failed.png', error: 'permission denied' }],
      error: 'permission denied',
    });

    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[baseFile({ name: 'uploaded.png', path: 'uploaded.png' })]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('file-list-upload-input'), {
      target: {
        files: [
          new File(['uploaded'], 'uploaded.png', { type: 'image/png' }),
          new File(['failed'], 'failed.png', { type: 'image/png' }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-banner').textContent).toContain(
        'Uploaded 1 file(s), but 1 failed.',
      );
    });
  });

  it('starts Files navigation fresh when switching projects', () => {
    const baseProps: React.ComponentProps<typeof FileWorkspace> = {
      projectId: 'project-a',
      projectKind: 'prototype',
      files: [
        workspaceFile('assets/logo.png'),
        workspaceFile('top.html'),
      ],
      onRefreshFiles: vi.fn(),
      tabsState: { tabs: [], active: null },
      onTabsStateChange: vi.fn(),
    };

    const { container, rerender } = render(<FileWorkspace {...baseProps} />);

    fireEvent.click(container.querySelector('.df-dir-row .df-row-name-btn')!);
    expect(container.querySelector('.df-breadcrumb-current')?.textContent).toBe('assets');

    rerender(
      <FileWorkspace
        {...baseProps}
        projectId="project-b"
        files={[
          workspaceFile('beta-assets/logo.png'),
          workspaceFile('home.html'),
        ]}
      />,
    );

    // #5517: the breadcrumb root falls back to filesPanel.crumbs ("Project")
    // instead of the removed workspace.allProjectFiles label.
    expect(container.querySelector('.df-breadcrumb-current')?.textContent).toBe('Project');
    expect(screen.getByTestId('design-file-row-home.html')).toBeTruthy();
  });

  // The workspace's `streaming` prop is the composer's "actions disabled"
  // state: it is also true for a read-only viewer of a shared project with
  // nothing running. The building preview must key off a real run, or that
  // viewer sees their page under a cursor captioned "thinking".
  it('keys the building preview off a run in flight, not the disabled-actions state', () => {
    const baseProps: React.ComponentProps<typeof FileWorkspace> = {
      projectId: 'project-a',
      projectKind: 'prototype',
      files: [workspaceFile('index.html')],
      messages: [{ id: 'active-run', role: 'assistant', content: '', startedAt: 1699999999 }],
      onRefreshFiles: vi.fn(),
      tabsState: { tabs: [], active: null },
      onTabsStateChange: vi.fn(),
    };

    const { rerender } = render(<FileWorkspace {...baseProps} streaming />);
    expect(screen.queryByTestId('file-list-building')).toBeNull();
    expect(screen.getByTestId('design-file-row-index.html')).toBeTruthy();

    rerender(<FileWorkspace {...baseProps} streaming runInFlight />);
    expect(screen.getByTestId('file-list-building')).toBeTruthy();
    expect(screen.queryByTestId('design-file-row-index.html')).toBeNull();
  });

  it('keeps an existing page in the grid until the current run writes HTML', () => {
    const startedAt = 1_800_000_000_000;
    const oldPage = { ...workspaceFile('index.html'), mtime: startedAt - 10_000 };
    const props: React.ComponentProps<typeof FileWorkspace> = {
      projectId: 'project-a', projectKind: 'prototype',
      files: [oldPage], onRefreshFiles: vi.fn(),
      tabsState: { tabs: [], active: null }, onTabsStateChange: vi.fn(),
      runInFlight: true,
      messages: [{ id: 'run-1', role: 'assistant', content: '', startedAt, runStatus: 'running' }],
    };
    const { rerender } = render(<FileWorkspace {...props} />);
    expect(screen.queryByTestId('file-list-building')).toBeNull();
    expect(screen.queryByTestId('file-list-preview-toggle')).toBeNull();
    expect(screen.getByTestId('design-file-row-index.html')).toBeTruthy();

    rerender(<FileWorkspace {...props} files={[oldPage, {
      ...workspaceFile('notes.md'), kind: 'text', mtime: startedAt + 100,
    }]} />);
    expect(screen.queryByTestId('file-list-building')).toBeNull();

    const writtenPage = { ...oldPage, mtime: startedAt + 200 };
    rerender(<FileWorkspace {...props} files={[writtenPage]} />);
    expect(screen.getByTestId('file-list-building')).toBeTruthy();

    rerender(<FileWorkspace {...props} files={[writtenPage]} messages={[
      ...props.messages!, { id: 'next-user', role: 'user', content: 'Write notes' },
    ]} />);
    expect(screen.queryByTestId('file-list-building')).toBeNull();

    rerender(<FileWorkspace {...props} files={[writtenPage]} messages={[
      { id: 'run-2', role: 'assistant', content: '', startedAt: startedAt + 300, runStatus: 'running' },
    ]} />);
    expect(screen.queryByTestId('file-list-building')).toBeNull();
  });

  it('drops the previous project folders when switching, before the new fetch resolves', async () => {
    const folder = (path: string): ProjectFolder => ({
      name: path.split('/').pop() ?? path,
      path,
      type: 'dir',
      size: 0,
      mtime: 1700000000,
    });
    const mockedFolders = vi.mocked(fetchProjectFolders);
    // project-a has an empty persisted folder; project-b's fetch stays pending.
    // (One-time values take precedence over the factory default `[]`; no reset,
    // so later tests keep that default.)
    mockedFolders.mockResolvedValueOnce([folder('assets')]);
    mockedFolders.mockReturnValueOnce(new Promise<ProjectFolder[]>(() => {}));

    const baseProps: React.ComponentProps<typeof FileWorkspace> = {
      projectId: 'project-a',
      projectKind: 'prototype',
      files: [],
      onRefreshFiles: vi.fn(),
      tabsState: { tabs: [], active: null },
      onTabsStateChange: vi.fn(),
    };
    const { container, rerender } = render(<FileWorkspace {...baseProps} />);
    // project-a's empty folder shows once its fetch resolves.
    await waitFor(() => {
      expect(
        [...container.querySelectorAll('.df-dir-row .df-row-name')].some(
          (e) => e.textContent === 'assets',
        ),
      ).toBe(true);
    });

    // Switch to project-b; its folder fetch is still pending. The previous
    // project's 'assets' folder must be gone immediately (reset synchronously),
    // not linger and suppress the new project's empty state.
    designFilesPanelRenders.length = 0;
    rerender(<FileWorkspace {...baseProps} projectId="project-b" files={[]} />);
    expect(
      [...container.querySelectorAll('.df-dir-row .df-row-name')].some(
        (e) => e.textContent === 'assets',
      ),
    ).toBe(false);

    // The reset happens during render, not in an effect — so the new panel's
    // FIRST render (and every render thereafter) already sees zero folders.
    // An effect-based reset would let project-b's first render observe the
    // stale 'assets' folder before the effect cleared it; RTL's post-rerender
    // DOM check above can't catch that frame, this can.
    const projectBRenders = designFilesPanelRenders.filter((r) => r.projectId === 'project-b');
    expect(projectBRenders.length).toBeGreaterThan(0);
    expect(projectBRenders.every((r) => r.folderCount === 0)).toBe(true);
  });

  it('clears a prior upload failure after a later successful upload', async () => {
    mockedUploadProjectFiles
      .mockRejectedValueOnce(new Error('storage offline'))
      .mockResolvedValueOnce({
        uploaded: [
          {
            path: 'retry.png',
            name: 'retry.png',
            kind: 'image',
            size: 1024,
          },
        ],
        failed: [],
      });

    const onRefreshFiles = vi.fn();
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[baseFile({ name: 'retry.png', path: 'retry.png' })]}
        onRefreshFiles={onRefreshFiles}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
      />,
    );

    const input = screen.getByTestId('file-list-upload-input');
    fireEvent.change(input, {
      target: { files: [new File(['failed'], 'failed.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-banner').textContent).toContain("Couldn't upload 1 file(s).");
    });

    fireEvent.change(input, {
      target: { files: [new File(['retry'], 'retry.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(onRefreshFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('upload-error-banner')).toBeNull());
  });

  it('falls back to the browser file list when a dragged entry cannot be read', async () => {
    const fallbackFile = new File(['mock'], 'fallback.png', { type: 'image/png' });
    const onUploadFiles = vi.fn();
    const { container } = renderFilesPanel({ onUploadFiles });

    fireEvent.drop(container.querySelector('.df-body')!, {
      dataTransfer: unreadableDropDataTransfer([fallbackFile]),
    });

    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledWith([fallbackFile]));
    expect(screen.queryByTestId('upload-error-banner')).toBeNull();
  });

  it('uploads files pasted from the clipboard in Files', () => {
    const pastedFile = new File(['mock'], 'clipboard.png', { type: 'image/png' });
    const onUploadFiles = vi.fn();
    const onClearUploadError = vi.fn();
    renderFilesPanel({ onUploadFiles, onClearUploadError });

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [pastedFile],
        items: [],
      },
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onClearUploadError).toHaveBeenCalledTimes(1);
    expect(onUploadFiles).toHaveBeenCalledWith([pastedFile]);
  });

  it('does not steal clipboard files from text inputs', () => {
    const pastedFile = new File(['mock'], 'clipboard.png', { type: 'image/png' });
    const onUploadFiles = vi.fn();
    renderFilesPanel({ onUploadFiles });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    try {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [pastedFile],
          items: [],
        },
      });
      textarea.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(onUploadFiles).not.toHaveBeenCalled();
    } finally {
      textarea.remove();
    }
  });

  it('shows a recoverable read error when a dragged entry disappears before import', async () => {
    const onUploadFiles = vi.fn();
    const { container } = renderFilesPanel({ onUploadFiles });

    fireEvent.drop(container.querySelector('.df-body')!, {
      dataTransfer: unreadableDropDataTransfer(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-banner').textContent).toContain(
        "Couldn't read one or more dropped files or folders",
      );
    });
    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('hides the workspace focus control while the chat pane is open', () => {
    const markup = renderToStaticMarkup(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        focusMode={false}
        onFocusModeChange={vi.fn()}
      />,
    );

    // While chat is visible the collapse trigger lives in ChatPane.
    // FileWorkspace only renders an expand control once chat is hidden.
    expect(markup).not.toContain('data-testid="workspace-focus-toggle"');
  });

  it('ends the one header row with maximise / restore, after the view switcher and ⋯', () => {
    const markup = renderToStaticMarkup(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        focusMode
        onFocusModeChange={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="workspace-focus-toggle"');
    // Focus mode docks the project tab strip first; then the view switcher,
    // the ⋯ menu, and restore at the far end (specs/current/openpixo-game-panel.md §3).
    expect(markup).toMatch(
      /data-testid="workspace-tabs-dock-focus"[\s\S]*data-testid="panel-view-switcher"[\s\S]*data-testid="panel-more-menu"[\s\S]*data-testid="workspace-focus-toggle"/,
    );
  });

  it('shows the view switcher instead of file tabs and the + launcher', () => {
    const markup = renderToStaticMarkup(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('artifact.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: ['artifact.html'], active: 'artifact.html' }}
        onTabsStateChange={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="panel-view-switcher"');
    expect(markup).not.toContain('data-testid="file-list-tab"');
    expect(markup).not.toContain('data-testid="workspace-add-tab"');
    expect(markup).not.toContain('class="ws-tabs-bar');
    expect(markup).not.toMatch(/role="tab"[^>]*>[^<]*artifact\.html/);
  });

  it('labels the same workspace control as chat restore while focused', () => {
    const markup = renderToStaticMarkup(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        focusMode
        onFocusModeChange={vi.fn()}
      />,
    );

    expect(markup).toContain('Show chat');
  });
});

describe('FileWorkspace launcher tab creation', () => {
  it('keeps the active HTML preview full-sized and prewarms file revisions across Files round-trips', async () => {
    const file = workspaceFile('artifact.html');
    mockedFetchProjectFileText.mockResolvedValue('<html><body>artifact</body></html>');

    function Harness() {
      const [mtime, setMtime] = useState(file.mtime);
      const [tabsState, setTabsState] = useState<OpenTabsState>({
        tabs: [file.name],
        active: file.name,
      });
      return (
        <>
          <button type="button" data-testid="advance-artifact-revision" onClick={() => setMtime(2_000_000_000)}>
            advance revision
          </button>
          <IframeKeepAliveProvider>
            <ProjectPreviewProvider value={{ ...(collabValue(null)), projectResourceAuthority: 'local' }}>
              <FileWorkspace
                projectId="project-1"
                projectKind="prototype"
                files={[{ ...file, mtime }]}
                onRefreshFiles={vi.fn()}
                tabsState={tabsState}
                onTabsStateChange={setTabsState}
              />
            </ProjectPreviewProvider>
          </IframeKeepAliveProvider>
        </>
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => {
      expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(1);
    });
    const firstFrame = screen.getByTestId('artifact-preview-frame');
    const initialSrc = firstFrame.getAttribute('src');
    const retainedViewer = screen.getByTestId('retained-file-viewer');
    expect(retainedViewer.style.display).toBe('flex');

    for (let round = 0; round < 10; round += 1) {
      // Leaving 资源库 keeps its stack; the viewer goes inactive, not away.
      showView('Game');
      expect(screen.getByTestId('retained-file-viewer')).toBe(retainedViewer);
      expect(retainedViewer.getAttribute('aria-hidden')).toBe('true');
      expect(retainedViewer.hasAttribute('inert')).toBe(true);
      expect(retainedViewer.hasAttribute('hidden')).toBe(false);
      expect(retainedViewer.style.display).toBe('flex');
      expect(retainedViewer.style.position).toBe('absolute');
      expect(retainedViewer.style.inset).toBe('0px');
      expect(retainedViewer.style.width).toBe('100%');
      expect(retainedViewer.style.height).toBe('100%');
      expect(retainedViewer.style.opacity).toBe('0');
      expect(retainedViewer.style.visibility).toBe('');
      // Main keeps ordinary previews warm; only Motion audio follows host visibility.
      expect(firstFrame.getAttribute('data-pixo-active')).toBe('true');
      expect(firstFrame.getAttribute('data-pixo-motion-active')).toBe('false');
      expect(container.querySelector('.iframe-keep-alive-pool iframe')).toBeNull();

      if (round === 0) {
        fireEvent.click(screen.getByTestId('advance-artifact-revision'));
        await waitFor(() => expect(firstFrame.getAttribute('src')).toContain('v=2000000000'));
      }

      const prewarmedSrc = firstFrame.getAttribute('src');

      showView('Files');
      expect(screen.getByTestId('artifact-preview-frame')).toBe(firstFrame);
      expect(firstFrame.getAttribute('data-pixo-active')).toBe('true');
      expect(firstFrame.getAttribute('data-pixo-motion-active')).toBe('true');
      expect(screen.getByTestId('retained-file-viewer')).toBe(retainedViewer);
      expect(retainedViewer.style.display).toBe('flex');
      expect(retainedViewer.style.opacity).toBe('');
      expect(retainedViewer.style.visibility).toBe('');
      expect(retainedViewer.hasAttribute('inert')).toBe(false);
      expect(firstFrame.getAttribute('src')).toBe(prewarmedSrc);
    }

    expect(firstFrame.getAttribute('src')).not.toBe(initialSrc);
    expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(2);
  });

  it('keeps warmed HTML preview frames connected while switching between files', async () => {
    const alpha = workspaceFile('alpha.html');
    const beta = workspaceFile('beta.html');
    mockedFetchProjectFileText.mockImplementation(async (_projectId, fileName) => (
      `<html><body>${fileName}</body></html>`
    ));

    function Harness() {
      const openRequest = useChatOpenRequest();
      const [tabsState, setTabsState] = useState<OpenTabsState>({
        tabs: [alpha.name, beta.name],
        active: alpha.name,
      });
      return (
        <IframeKeepAliveProvider>
          <ProjectPreviewProvider value={{ ...(collabValue(null)), projectResourceAuthority: 'local' }}>
            <FileWorkspace
              openRequest={openRequest}
              projectId="project-1"
              projectKind="prototype"
              files={[alpha, beta]}
              onRefreshFiles={vi.fn()}
              tabsState={tabsState}
              onTabsStateChange={setTabsState}
            />
          </ProjectPreviewProvider>
        </IframeKeepAliveProvider>
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(1));
    const alphaFrame = screen.getByTestId('artifact-preview-frame');

    openFromChat('beta.html');
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(2));
    const betaFrame = screen.getByTestId('artifact-preview-frame');
    expect(betaFrame).not.toBe(alphaFrame);
    expect(container.querySelector('.iframe-keep-alive-pool iframe')).toBeNull();
    expect(document.body.contains(alphaFrame)).toBe(true);
    const retainedAfterBeta = screen.getAllByTestId('retained-file-viewer');
    expect(retainedAfterBeta.map((viewer) => viewer.getAttribute('data-file-name'))).toEqual([
      alpha.name,
      beta.name,
    ]);

    openFromChat('alpha.html');
    expect(screen.getByTestId('artifact-preview-frame')).toBe(alphaFrame);
    expect(container.querySelector('.iframe-keep-alive-pool iframe')).toBeNull();
    expect(document.body.contains(betaFrame)).toBe(true);
    expect(screen.getAllByTestId('retained-file-viewer')).toEqual(retainedAfterBeta);
    expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(2);
  });



  it('evicts the fourth HTML tab without reattaching the three surviving preview frames', async () => {
    const files = ['alpha.html', 'beta.html', 'gamma.html', 'delta.html'].map(workspaceFile);
    mockedFetchProjectFileText.mockImplementation(async (_projectId, fileName) => (
      `<html><body>${fileName}</body></html>`
    ));

    function Harness() {
      const openRequest = useChatOpenRequest();
      const [tabsState, setTabsState] = useState<OpenTabsState>({
        tabs: files.map((file) => file.name),
        active: 'alpha.html',
      });
      return (
        <IframeKeepAliveProvider>
          <ProjectPreviewProvider value={{ ...(collabValue(null)), projectResourceAuthority: 'local' }}>
            <FileWorkspace
              openRequest={openRequest}
              projectId="project-1"
              projectKind="prototype"
              files={files}
              onRefreshFiles={vi.fn()}
              tabsState={tabsState}
              onTabsStateChange={setTabsState}
            />
          </ProjectPreviewProvider>
        </IframeKeepAliveProvider>
      );
    }

    render(<Harness />);
    openFromChat('beta.html');
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(2));
    openFromChat('gamma.html');
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(3));
    const survivingFrames = ['beta.html', 'gamma.html'].map((name) => (
      document.querySelector(`iframe[title="${name}"][data-pixo-render-mode="url-load"]`)
    ));
    expect(survivingFrames.every(Boolean)).toBe(true);
    const appendSpy = vi.spyOn(Node.prototype, 'appendChild');

    openFromChat('delta.html');
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(document.querySelector('iframe[title="alpha.html"]')).toBeNull());

    for (const [index, name] of ['beta.html', 'gamma.html'].entries()) {
      const frame = survivingFrames[index];
      expect(document.querySelector(
        `iframe[title="${name}"][data-pixo-render-mode="url-load"]`,
      )).toBe(frame);
      expect(appendSpy.mock.calls.filter(([node]) => node === frame)).toHaveLength(0);
    }
  });

  it('deletes the active HTML viewer without reattaching a surviving warm iframe', async () => {
    const alpha = workspaceFile('alpha.html');
    const beta = workspaceFile('beta.html');
    mockedFetchProjectFileText.mockImplementation(async (_projectId, fileName) => (
      `<html><body>${fileName}</body></html>`
    ));

    function Harness({ files, generation }: { files: ProjectFile[]; generation: number }) {
      const openRequest = useChatOpenRequest();
      const [tabsState, setTabsState] = useState<OpenTabsState>({
        tabs: [alpha.name, beta.name],
        active: alpha.name,
      });
      return (
        <IframeKeepAliveProvider>
          <ProjectPreviewProvider value={{ ...(collabValue(null)), projectResourceAuthority: 'local' }}>
            <FileWorkspace
              openRequest={openRequest}
              projectId="project-1"
              projectKind="prototype"
              files={files}
              filesGeneration={generation}
              onRefreshFiles={vi.fn()}
              tabsState={tabsState}
              onTabsStateChange={setTabsState}
            />
          </ProjectPreviewProvider>
        </IframeKeepAliveProvider>
      );
    }

    const { rerender } = render(<Harness files={[alpha, beta]} generation={1} />);
    await waitFor(() => expect(document.querySelector(
      'iframe[title="alpha.html"][data-pixo-render-mode="url-load"]',
    )).not.toBeNull());
    openFromChat('beta.html');
    await waitFor(() => expect(document.querySelector(
      'iframe[title="alpha.html"][data-pixo-render-mode="url-load"]',
    )).not.toBeNull());
    const alphaFrame = document.querySelector(
      'iframe[title="alpha.html"][data-pixo-render-mode="url-load"]',
    );
    expect(alphaFrame).not.toBeNull();
    const readsBeforeDelete = mockedFetchProjectFileText.mock.calls.length;
    const appendSpy = vi.spyOn(Node.prototype, 'appendChild');

    rerender(<Harness files={[alpha]} generation={2} />);

    await waitFor(() => expect(document.querySelector('iframe[title="beta.html"]')).toBeNull());
    expect(document.querySelector(
      'iframe[title="alpha.html"][data-pixo-render-mode="url-load"]',
    )).toBe(alphaFrame);
    expect(appendSpy.mock.calls.filter(([node]) => node === alphaFrame)).toHaveLength(0);
    expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(readsBeforeDelete);
  });

  it('keeps warmed HTML preview frames through equivalent context refreshes and transient empty file snapshots', async () => {
    const alphaName = 'alpha.html';
    const betaName = 'beta.html';
    mockedFetchProjectFileText.mockImplementation(async (_projectId, fileName) => (
      `<html><body>${fileName}</body></html>`
    ));

    function Harness({
      active,
      files,
      tabs,

      filesRefreshKey = 0,
    }: {
      active: string;
      files: ProjectFile[];
      tabs: string[];

      filesRefreshKey?: number;
    }) {
      const openRequest = useChatOpenRequest();
      return (
        <IframeKeepAliveProvider>
          <ProjectPreviewProvider value={{ ...(collabValue(workspaceContext)), projectResourceAuthority: 'local' }}>
            <FileWorkspace
              openRequest={openRequest}
              projectId="project-1"
              projectKind="prototype"
              files={files}
              onRefreshFiles={vi.fn()}
              tabsState={{ tabs, active }}
              onTabsStateChange={vi.fn()}
              filesRefreshKey={filesRefreshKey}
            />
          </ProjectPreviewProvider>
        </IframeKeepAliveProvider>
      );
    }

    const workspaceContext = null;
    const { rerender } = render(
      <Harness
        active={alphaName}
        files={[workspaceFile(alphaName), workspaceFile(betaName)]}
        tabs={[alphaName, betaName]}

      />,
    );
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(1));
    const alphaFrame = screen.getByTestId('artifact-preview-frame');

    openFromChat(betaName);
    await waitFor(() => expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(2));
    const betaFrame = screen.getByTestId('artifact-preview-frame');

    // Ambient workspace refreshes can briefly publish an empty file snapshot.
    // Open items are the durable witness that these files were not closed or
    // deleted, so both warmed iframe nodes must stay connected through it.
    rerender(
      <Harness
        active={alphaName}
        files={[]}
        tabs={[alphaName, betaName]}
      />,
    );
    expect(document.body.contains(alphaFrame)).toBe(true);
    expect(document.body.contains(betaFrame)).toBe(true);
    expect(alphaFrame.closest('[data-testid="retained-file-viewer"]')).not.toBeNull();
    expect(betaFrame.closest('[data-testid="retained-file-viewer"]')).not.toBeNull();
    expect(document.querySelector('.iframe-keep-alive-pool iframe')).toBeNull();

    rerender(
      <Harness
        active={alphaName}
        files={[workspaceFile(alphaName), workspaceFile(betaName)]}
        tabs={[alphaName, betaName]}
      />,
    );
    openFromChat(alphaName);
    expect(screen.getByTestId('artifact-preview-frame')).toBe(alphaFrame);
    expect(document.body.contains(betaFrame)).toBe(true);
    expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(2);

    // Going back from a viewer is a permanent close: it leaves the stack and
    // must evict that viewer rather than retaining it forever.
    openFromChat(betaName);
    expect(screen.getByTestId('artifact-preview-frame')).toBe(betaFrame);
    fireEvent.click(screen.getByTestId('panel-stack-back'));
    await waitFor(() => expect(document.querySelector('iframe[title="beta.html"]')).toBeNull());
    expect(screen.getByTestId('artifact-preview-frame')).toBe(alphaFrame);
  });

  it('evicts a deleted HTML viewer after a committed file refresh even when its tab persists', async () => {
    const alphaName = 'alpha.html';
    const betaName = 'beta.html';
    const workspaceContext = null;
    const tabs = [alphaName, betaName];

    function Harness({ files, refreshKey }: { files: ProjectFile[]; refreshKey: number }) {
      const openRequest = useChatOpenRequest();
      return (
        <IframeKeepAliveProvider>
          <ProjectPreviewProvider value={{ ...(collabValue(workspaceContext)), projectResourceAuthority: 'local' }}>
            <FileWorkspace
              openRequest={openRequest}
              projectId="project-1"
              projectKind="prototype"
              files={files}
              filesRefreshKey={refreshKey}
              filesGeneration={refreshKey}
              onRefreshFiles={vi.fn()}
              tabsState={{ tabs, active: alphaName }}
              onTabsStateChange={vi.fn()}
            />
          </ProjectPreviewProvider>
        </IframeKeepAliveProvider>
      );
    }

    const initialFiles = [workspaceFile(alphaName), workspaceFile(betaName)];
    const { rerender } = render(
      <Harness files={initialFiles} refreshKey={0} />,
    );
    openFromChat('beta.html');
    await waitFor(() => expect(document.querySelector('iframe[title="beta.html"]')).not.toBeNull());
    const betaFrame = document.querySelector('iframe[title="beta.html"]');

    // Authorization-scoped keep-alive keys append metadata after `beta.html:`.
    // A committed refresh that still contains the file must retain that frame.
    rerender(<Harness files={initialFiles} refreshKey={1} />);
    await waitFor(() => expect(document.querySelector('iframe[title="beta.html"]')).toBe(betaFrame));
    openFromChat('alpha.html');

    rerender(<Harness files={[workspaceFile(alphaName)]} refreshKey={2} />);

    await waitFor(() => expect(document.querySelector('iframe[title="beta.html"]')).toBeNull());
    expect(screen.getByTestId('artifact-preview-frame').getAttribute('title')).toBe(alphaName);
  });



  it('evicts the least-recently-used HTML viewer after the fourth warm tab', async () => {
    const files = ['alpha.html', 'beta.html', 'gamma.html', 'delta.html'].map(workspaceFile);
    mockedFetchProjectFileText.mockImplementation(async (_projectId, fileName) => (
      `<html><body>${fileName}</body></html>`
    ));

    function Harness() {
      const openRequest = useChatOpenRequest();
      const [tabsState, setTabsState] = useState<OpenTabsState>({
        tabs: files.map((file) => file.name),
        active: files[0]!.name,
      });
      return (
        <IframeKeepAliveProvider>
          <ProjectPreviewProvider value={{ ...(collabValue(null)), projectResourceAuthority: 'local' }}>
            <FileWorkspace
              openRequest={openRequest}
              projectId="project-1"
              projectKind="prototype"
              files={files}
              onRefreshFiles={vi.fn()}
              tabsState={tabsState}
              onTabsStateChange={setTabsState}
            />
          </ProjectPreviewProvider>
        </IframeKeepAliveProvider>
      );
    }

    render(<Harness />);
    for (const name of files.slice(1).map((file) => file.name)) {
      openFromChat(name);
      await waitFor(() => expect(screen.getByTestId('artifact-preview-frame').getAttribute('title')).toBe(name));
    }
    await waitFor(() => {
      expect(screen.getAllByTestId('retained-file-viewer').map((viewer) => viewer.getAttribute('data-file-name')))
        .toEqual(['beta.html', 'gamma.html', 'delta.html']);
    });
    expect(document.querySelector('iframe[title="alpha.html"]')).toBeNull();
    expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(4);

    openFromChat('alpha.html');
    await waitFor(() => expect(screen.getByTestId('artifact-preview-frame').getAttribute('title')).toBe('alpha.html'));
    // The evicted frame remounts from its exact-version source snapshot. It
    // must not add a fifth raw read before the file revision changes.
    expect(mockedFetchProjectFileText).toHaveBeenCalledTimes(4);
    await waitFor(() => {
      expect(screen.getAllByTestId('retained-file-viewer').map((viewer) => viewer.getAttribute('data-file-name')))
        .toEqual(['alpha.html', 'gamma.html', 'delta.html']);
    });
  });

  it('does not report a Files context for an empty project', async () => {
    // A brand-new project has no files, live artifacts, or folders. The
    // composer must not auto-stage a "Design files" chip that points at
    // nothing, so the active workspace context stays null.
    const onActiveContextChange = vi.fn();
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        resolvedDir="/tmp/openpixo/project-1"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        onActiveContextChange={onActiveContextChange}
      />,
    );

    await waitFor(() => {
      expect(onActiveContextChange).toHaveBeenCalled();
    });
    expect(onActiveContextChange).toHaveBeenLastCalledWith(null);
  });

  it('reports the active Files tab as workspace context once files exist', async () => {
    const onActiveContextChange = vi.fn();
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        resolvedDir="/tmp/openpixo/project-1"
        files={[workspaceFile('cover.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        onActiveContextChange={onActiveContextChange}
      />,
    );

    await waitFor(() => {
      expect(onActiveContextChange).toHaveBeenLastCalledWith({
        id: 'workspace:design-files',
        kind: 'design-files',
        label: 'Files',
        tabId: '__design_files__',
        absolutePath: '/tmp/openpixo/project-1',
      });
    });
  });

  it('shows the 资源库 root when the persisted active file no longer exists', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: ['missing.png'], active: 'missing.png' }}
        onTabsStateChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('file-list-empty')).toBeTruthy();
    expect(screen.getByTestId('panel-stack-bar')).toHaveAttribute('hidden');
    expect(screen.queryByText(/Open a file from/i)).toBeNull();
  });

  it('leaves the browser-style tab shortcuts to the workspace tabs', () => {
    const onTabsStateChange = vi.fn();
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('analysis.html'), workspaceFile('notes.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: ['notes.html'], active: 'notes.html' }}
        onTabsStateChange={onTabsStateChange}
      />,
    );
    const callsBefore = onTabsStateChange.mock.calls.length;

    // The panel has no file tabs (spec §7): Ctrl/Cmd+T, Ctrl/Cmd+W and
    // Ctrl+Tab are not consumed here, so WorkspaceTabsBar answers them.
    expect(fireEvent.keyDown(window, { key: 't', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'w', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })).toBe(true);
    expect(onTabsStateChange.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId('panel-stack-label').textContent).toBe('notes.html');
  });

  it('re-opens an already-open file from the conversation without duplicating it', async () => {
    const onTabsStateChange = vi.fn();
    const file = workspaceFile('Web Prototype mutuals-v2.html');
    const props = {
      projectId: 'project-1',
      projectKind: 'prototype' as const,
      files: [file],
      onRefreshFiles: vi.fn(),
      tabsState: { tabs: [file.name], active: file.name },
      onTabsStateChange,
    };
    const { rerender } = render(<FileWorkspace {...props} />);
    showView('Game');
    rerender(<FileWorkspace {...props} openRequest={{ name: file.name, nonce: 1, origin: 'conversation' }} />);

    await waitFor(() => {
      expect(onTabsStateChange).toHaveBeenLastCalledWith({ tabs: [file.name], active: file.name });
    });
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('FilesPanel plugin folders', () => {
  it('surfaces generated plugin folders with agent-routed CLI actions', async () => {
    const onPluginFolderAgentAction = vi.fn();
    const container = renderWorkspace(
      <FilesPanel
        projectId="project-1"
        projectKind="prototype"
        files={[
          workspaceFile('generated-plugin/pixo.json'),
          workspaceFile('generated-plugin/SKILL.md'),
          workspaceFile('generated-plugin/examples/demo.md'),
        ]}
        onRefreshFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onDeleteFiles={vi.fn()}
        onRenameFile={vi.fn()}
        onUpload={vi.fn()}
        onUploadFiles={vi.fn()}
        onPaste={vi.fn()}
        onPluginFolderAgentAction={onPluginFolderAgentAction}
      />,
    );

    expect(container.querySelector('[data-testid="design-plugin-folder-generated-plugin"]')).toBeTruthy();
    const install = container.querySelector<HTMLButtonElement>(
      '[data-testid="design-plugin-folder-install-generated-plugin"]',
    );
    expect(install).toBeTruthy();
    await act(async () => {
      install?.click();
    });
    expect(onPluginFolderAgentAction).toHaveBeenCalledWith('generated-plugin', 'install');

    const publish = container.querySelector<HTMLButtonElement>(
      '[data-testid="design-plugin-folder-publish-generated-plugin"]',
    );
    const contribute = container.querySelector<HTMLButtonElement>(
      '[data-testid="design-plugin-folder-contribute-generated-plugin"]',
    );
    expect(publish).toBeTruthy();
    expect(contribute).toBeNull();
    await act(async () => {
      publish?.click();
    });
    expect(onPluginFolderAgentAction).toHaveBeenCalledWith('generated-plugin', 'publish');
    expect(container.textContent).not.toContain(
      'Sent to the agent. The CLI run will continue in chat.',
    );
  });
});

describe('projectSplitClassName', () => {
  it('marks the project split as focused so the chat pane can collapse globally', () => {
    expect(projectSplitClassName(false)).toBe('split');
    expect(projectSplitClassName(true)).toBe('split split-focus');
  });

  it('uses CSS variables for split widths so pointer resize can update layout without rerendering workspace content', () => {
    // `.split`'s grid-template-columns is always
    // `var(--project-chat-panel-width) var(--project-chat-handle-width) var(--project-workspace-panel-track)`
    // (see shell.css), so the style object only needs to carry the three
    // custom properties — no more concatenated `gridTemplateColumns` string.
    expect(projectSplitStyle(false, 512, 'minmax(420px, 1fr)')).toEqual({
      '--project-chat-panel-width': '512px',
      '--project-chat-handle-width': '4px',
      '--project-workspace-panel-track': 'minmax(420px, 1fr)',
    });
    expect(projectSplitStyle(true, 512, 'minmax(420px, 1fr)')).toBeUndefined();
  });

  it('starts an uncustomized wide project at an equal chat/preview split', () => {
    // 1600 total − the 4px handle (Demo, OPEND-2553 S6) = two 798px content
    // columns. This must not regress to the old fixed 460px default or its
    // former 720px ceiling.
    expect(defaultChatPanelWidthForSplit(1600)).toBe(798);
  });

  it('keeps the workspace minimum when the viewport is too narrow for 1:1', () => {
    // At this width an exact half would leave the preview below its existing
    // 400px minimum, so the established drag boundary wins (760 − 4 − 400).
    expect(defaultChatPanelWidthForSplit(760)).toBe(356);
  });
});

describe('FileWorkspace empty-project generation contract', () => {
  it('shows the first-materialization syncing surface instead of mounting a cached workspace tab', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('stale.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: ['terminal:stale'], active: 'terminal:stale' }}
        onTabsStateChange={vi.fn()}
        materializationPending
      />,
    );

    expect(screen.getByTestId('file-list-syncing')).toBeTruthy();
    expect(screen.queryByTestId('file-list-empty')).toBeNull();
  });

  // OPEND-2283. An empty list and a list that has not arrived read identically
  // here, and the CTAs below ("新建草图" / "上传") actively mislead someone whose
  // project does have files. The panel already draws this distinction for a
  // team mirror that is still downloading; a local list that has not returned
  // yet deserves the same treatment.
  it('does not offer the empty-project CTAs before an authoritative file list arrives', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        filesAuthoritative={false}
      />,
    );

    expect(screen.queryByTestId('file-list-empty')).toBeNull();
  });

  // Suppressing the empty-state CTAs removed a false claim but left the panel
  // blank, which reads as "stuck" rather than "loading" -- a worse first
  // impression than the wrong copy it replaced. Say we are working instead.
  it('shows a loading placeholder while the file list is still unknown', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        filesAuthoritative={false}
      />,
    );

    expect(screen.queryByTestId('file-list-empty')).toBeNull();
    expect(screen.getByTestId('file-list-loading')).toBeTruthy();
  });

  // OPEND-3334. A project the Home send just created keeps the empty state its
  // hand-off frame drew instead of detouring through "Loading…", but only as
  // a picture: the authority gate still holds, so nothing in it can act before
  // the first listing is accepted (Home attachments are still uploading then,
  // or the read may fail).
  it('draws an inert empty state, with no CTA on offer, before the first listing of a Home-created project', () => {
    const { rerender } = render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        filesAuthoritative={false}
        emptyLookBeforeFirstListing
      />,
    );

    const standIn = screen.getByTestId('file-list-empty-unconfirmed');
    expect(standIn.hasAttribute('inert')).toBe(true);
    expect(standIn.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('file-list-loading')).toBeNull();
    expect(screen.queryByTestId('file-list-empty')).toBeNull();
    expect(screen.queryByTestId('file-list-upload-trigger')).toBeNull();

    // The staged Home attachment lands in the first accepted listing: files,
    // not an empty-project offer.
    rerender(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('brief.png')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        filesAuthoritative
        emptyLookBeforeFirstListing
      />,
    );
    expect(screen.queryByTestId('file-list-empty-unconfirmed')).toBeNull();
    expect(screen.queryByTestId('file-list-empty')).toBeNull();
  });

  it('hands over to the live empty state once the first listing confirms the project is empty', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        filesAuthoritative
        emptyLookBeforeFirstListing
      />,
    );

    expect(screen.queryByTestId('file-list-empty-unconfirmed')).toBeNull();
    const empty = screen.getByTestId('file-list-empty');
    expect(empty.hasAttribute('inert')).toBe(false);
  });

  it('offers them once the list is known to be empty', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: null }}
        onTabsStateChange={vi.fn()}
        filesAuthoritative
      />,
    );

    expect(screen.getByTestId('file-list-empty')).toBeTruthy();
  });

  // OPEND-2283. Read-only is fail-closed while ownership is still unproven, and
  // that is correct — but the banner states a FACT ("this is a shared project"),
  // and during that window the fact is unknown. Entering your own personal
  // project cold showed it for seconds before the workspace context resolved.
  // Disable the controls, do not assert the reason.
  it('does not claim a project is shared while ownership is still unproven', () => {
    const file = workspaceFile('artifact.html');
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[file]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [file.name], active: file.name }}
        onTabsStateChange={vi.fn()}
        viewerOnly
      />,
    );

    expect(document.querySelector('.workspace-readonly-notice')).toBeNull();
  });

  it('states the reason once the project is confirmed shared', () => {
    const file = workspaceFile('artifact.html');
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[file]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [file.name], active: file.name }}
        onTabsStateChange={vi.fn()}
        viewerOnly
        readonlyNotice="这是 麻薯 创建的共享项目。"
      />,
    );

    const notice = document.querySelector('.workspace-readonly-notice');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('麻薯');
  });

  it('keeps an already-materialized viewer and header actions mounted during route revalidation', () => {
    const file = workspaceFile('artifact.html');
    const tabsState = { tabs: [file.name], active: file.name };
    const onTabsStateChange = vi.fn();
    const renderWorkspace = (materializationPending: boolean) => (
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[file]}
        onRefreshFiles={vi.fn()}
        tabsState={tabsState}
        onTabsStateChange={onTabsStateChange}
        materializationPending={materializationPending}
        fileActionsBefore={<button type="button">Reveal artifact</button>}
        headerActions={<button type="button">Project action</button>}
      />
    );
    const { rerender } = render(renderWorkspace(false));
    const retainedViewer = screen.getByTestId('retained-file-viewer');

    rerender(renderWorkspace(true));

    expect(screen.getByTestId('retained-file-viewer')).toBe(retainedViewer);
    expect(screen.queryByTestId('file-list-syncing')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reveal artifact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Project action' })).toBeTruthy();
  });

  function assistantMessage(runStatus: 'running' | 'failed'): ChatMessage {
    return {
      id: `msg-${runStatus}`,
      role: 'assistant',
      content: '',
      createdAt: 1700000000,
      startedAt: 1700000000,
      runId: `run-${runStatus}`,
      runStatus,
      agentId: 'claude',
      preTurnFileNames: [],
      events: [{ kind: 'status', label: runStatus === 'failed' ? 'error' : 'thinking' }],
    };
  }

  // The generation-preview card / transient `generating-tab` were removed: an
  // empty project keeps the plain `file-list-empty` placeholder for running
  // AND failed turns, with no card hijacking the surface.
  it.each(['running', 'failed'] as const)(
    'keeps the design-files empty placeholder and shows no generation card for a %s turn',
    (runStatus) => {
      render(
        <FileWorkspace
          projectId="project-1"
          projectKind="prototype"
          files={[]}
          onRefreshFiles={vi.fn()}
          streaming={runStatus === 'running'}
          tabsState={{ tabs: [], active: FILES_TAB }}
          onTabsStateChange={vi.fn()}
          messages={[assistantMessage(runStatus)]}
        />,
      );

      expect(screen.queryByTestId('generating-tab')).toBeNull();
      expect(screen.queryByTestId('generation-preview-stage')).toBeNull();
      expect(screen.queryByTestId('preview-run-status')).toBeNull();
      expect(screen.getByTestId('file-list-empty')).toBeTruthy();
    },
  );

  it('keeps delivery recovery in Chat without mounting status over existing preview files', () => {
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('previous-design.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: [], active: FILES_TAB }}
        onTabsStateChange={vi.fn()}
        messages={[
          {
            ...assistantMessage('failed'),
            id: 'delivery-failure',
            runStatus: 'succeeded',
            resultDeliveryState: 'no_result',
            sessionMode: 'design',
            endedAt: 1_700_000_012_000,
          },
        ]}
      />,
    );

    expect(screen.queryByTestId('preview-run-status')).toBeNull();
    expect(screen.queryByTestId('preview-run-status-retry')).toBeNull();
    expect(screen.queryByTestId('preview-run-status-view-details')).toBeNull();
  });

  it('does not mount a delivered confirmation over the preview canvas', () => {
    const now = 1_700_000_012_500;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileWorkspace
        projectId="project-1"
        projectKind="prototype"
        files={[workspaceFile('delivered-design.html')]}
        onRefreshFiles={vi.fn()}
        tabsState={{ tabs: ['delivered-design.html'], active: 'delivered-design.html' }}
        onTabsStateChange={vi.fn()}
        messages={[
          {
            ...assistantMessage('failed'),
            id: 'delivery-succeeded',
            runStatus: 'succeeded',
            resultDeliveryState: 'delivered',
            sessionMode: 'design',
            startedAt: now - 4_000,
            endedAt: now - 1_000,
          },
        ]}
      />,
    );

    expect(screen.queryByTestId('preview-run-status')).toBeNull();
  });
});
