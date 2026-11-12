// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openpixo/host', () => ({
  isOpenPixoHostAvailable: () => true,
  pickAndImportHostProject: vi.fn(),
}));



import { pickAndImportHostProject } from '@openpixo/host';
import { NewProjectModal } from '../../src/components/NewProjectModal';
import { I18nProvider } from '../../src/i18n';
import type {
  SkillSummary,
} from '../../src/types';

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
  vi.mocked(pickAndImportHostProject).mockReset();
});

describe('NewProjectModal layout', () => {
  it('keeps the project form inside a scrollable body region', () => {
    const { container } = render(
      <NewProjectModal
        open
        skills={skills}

        promptTemplates={[]}
        onCreate={() => {}}
        onClose={() => {}}
      />,
    );

    const modalBody = container.querySelector('.new-project-modal__body');
    const panelBody = container.querySelector('.new-project-modal__body .newproj-body');
    expect(modalBody).toBeTruthy();
    expect(panelBody).toBeTruthy();
    expect(screen.getByTestId('new-project-panel')).toBeTruthy();
    expect(screen.getByTestId('create-project')).toBeTruthy();
  });

  it('keeps the modal open with a waiting state until project creation finishes', async () => {
    let resolveCreate!: (value: boolean) => void;
    const onCreate = vi.fn(
      () => new Promise<boolean>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const onClose = vi.fn();

    render(
      <NewProjectModal
        open
        skills={skills}

        promptTemplates={[]}
        onCreate={onCreate}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Creating project…');
    expect((screen.getByTestId('create-project') as HTMLButtonElement).disabled).toBe(true);

    resolveCreate(true);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('forwards the desktop folder import response handler to the inner panel', async () => {
    const importResult = {
      conversationId: 'conversation-host',
      entryFile: 'src/App.tsx',
      ok: true,
      projectId: 'project-host',
    } as const;
    let resolveImport!: (value: typeof importResult) => void;
    vi.mocked(pickAndImportHostProject).mockImplementation(
      () => new Promise<typeof importResult>((resolve) => {
        resolveImport = resolve;
      }),
    );
    const onImportFolderResponse = vi.fn();

    render(
      <NewProjectModal
        open
        skills={skills}

        promptTemplates={[]}
        onCreate={() => {}}
        onImportFolderResponse={onImportFolderResponse}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open game project' }));

    await waitFor(() => {
      expect(pickAndImportHostProject).toHaveBeenCalledWith({
        skillId: null,
        
      });
    });
    expect(screen.getByRole('button', { name: 'Opening…' })).toBeTruthy();

    resolveImport(importResult);

    await waitFor(() => {
      expect(onImportFolderResponse).toHaveBeenCalledWith(importResult);
    });
  });

  it('localizes the modal title and folder action in zh-CN', () => {
    render(
      <I18nProvider initial="zh-CN">
        <NewProjectModal
          open
          skills={skills}

          promptTemplates={[]}
          onCreate={() => {}}
          onImportFolderResponse={() => {}}
          onClose={() => {}}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('dialog', { name: '媒体' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '媒体' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开游戏项目' })).toBeTruthy();
    expect(screen.queryByText('New project')).toBeNull();
    expect(screen.queryByText('Open folder')).toBeNull();
  });
});
