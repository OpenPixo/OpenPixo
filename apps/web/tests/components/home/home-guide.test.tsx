// @vitest-environment jsdom
// The ways into the walkthrough from Home and the help menu: they go on in the
// sample game it was in, and make a sample only when there is none.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@openpixo/contracts';
import { RailHelpMenu } from '../../../src/components/entry-nav-rail/RailHelpMenu';
import { requestEntryGuide, takeEntryGuideRequest } from '../../../src/components/entryRailBridge';
import { HomeDashboard } from '../../../src/components/home/HomeDashboard';
import { I18nProvider } from '../../../src/i18n';
import { navigate } from '../../../src/router';
import { publishFirstRunGuide, readFirstRunGuide, resetFirstRunGuideForTests } from '../../../src/state/first-run-guide';
import { takeProjectGameStart } from '../../../src/state/game-start-request';

vi.mock('../../../src/router', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/router')>(), navigate: vi.fn(),
}));
vi.mock('../../../src/components/useOpenFolderImport', () => ({
  useOpenFolderImport: () => ({ available: false, importing: false, error: null, openFolder: vi.fn() }),
}));
const dialogs = vi.hoisted(() => ({ last: null as null | Record<string, any> }));
vi.mock('../../../src/components/NewGameDialog', () => ({ NewGameDialog: (props: Record<string, any>) => { dialogs.last = props; return null; } }));

const template = { id: 'phaser3-sample-platformer', name: 'Sample: pixel platformer', engine: 'phaser', description: 'Ready to play' };
const project = (id: string, templateId?: string): Project => ({ id, name: id, createdAt: 1, updatedAt: 1, skillId: null,
  metadata: { kind: 'prototype', ...(templateId ? { templateId } : {}) } as Project['metadata'] });
const made = { project: project('made', template.id), conversationId: 'c', entryFile: 'index.html', git: { status: 'skipped' } };

let creations = 0;
let failCreate = false;
function dashboard(projects: Project[], projectsLoading = false) {
  const onOpenProject = vi.fn();
  const onImportFolderResponse = vi.fn();
  const element = (list: Project[], loading: boolean) => <I18nProvider initial="en"><HomeDashboard projects={list} projectsLoading={loading}
    onOpenProject={onOpenProject} onImportFolderResponse={onImportFolderResponse}>{null}</HomeDashboard></I18nProvider>;
  const view = render(element(projects, projectsLoading));
  return { onOpenProject, onImportFolderResponse, rerender: (list: Project[], loading = false) => view.rerender(element(list, loading)) };
}

beforeEach(() => {
  creations = 0;
  failCreate = false;
  dialogs.last = null;
  localStorage.clear();
  resetFirstRunGuideForTests();
  takeEntryGuideRequest();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/game-templates') return Response.json({ templates: [template], defaultParentDir: 'C:\\Games' });
    if (url.endsWith('/game-from-template/check')) return Response.json({ status: 'available' });
    if (url.endsWith('/game-from-template')) {
      creations += 1;
      return failCreate ? Response.json({ error: { code: 'TARGET_REJECTED', message: 'no' } }, { status: 403 }) : Response.json(made);
    }
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); resetFirstRunGuideForTests(); takeProjectGameStart('made'); takeProjectGameStart('sample'); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('the walkthrough from Home', () => {
  it('takes the sample tile\u2019s place for someone with no games, and starts in a new sample', async () => {
    publishFirstRunGuide(null);
    const { onImportFolderResponse } = dashboard([]);
    expect(screen.queryByRole('button', { name: /Play the sample game/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show me around/ }));
    await waitFor(() => expect(onImportFolderResponse).toHaveBeenCalledOnce());
    expect(readFirstRunGuide()).toEqual({ status: 'active', step: 'play', projectId: 'made' });
  });

  it('goes on in its own sample instead of making another, with the game running', () => {
    publishFirstRunGuide({ status: 'skipped', step: 'tune', projectId: 'sample' });
    const { onOpenProject } = dashboard([project('sample', template.id)]);
    fireEvent.click(document.querySelector('[data-step="guide"] button')!);
    expect(onOpenProject).toHaveBeenLastCalledWith('sample');
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', step: 'tune' });
    expect(takeProjectGameStart('sample')).toBe(true);
    expect(creations).toBe(0);
  });

  it('makes a new sample when its own was deleted', async () => {
    publishFirstRunGuide({ status: 'skipped', step: 'ask', projectId: 'deleted' });
    const { onImportFolderResponse } = dashboard([project('own')]);
    fireEvent.click(document.querySelector('[data-step="guide"] button')!);
    await waitFor(() => expect(onImportFolderResponse).toHaveBeenCalledOnce());
    expect(readFirstRunGuide()).toEqual({ status: 'active', step: 'play', projectId: 'made' });
  });
});

describe('when the sample cannot be made by itself', () => {
  async function openFallback() {
    failCreate = true;
    publishFirstRunGuide(null);
    const view = dashboard([]);
    fireEvent.click(screen.getByRole('button', { name: /Show me around/ }));
    await waitFor(() => expect(dialogs.last?.initialTemplateId).toBe(template.id));
    return view;
  }

  it('starts the walkthrough in the sample made in the game dialog instead', async () => {
    const { onImportFolderResponse } = await openFallback();
    const response = { ok: true, projectId: 'by-hand', conversationId: 'c', entryFile: 'index.html' };
    await act(async () => { dialogs.last!.onMade?.({ projectId: 'by-hand', templateId: template.id }); await dialogs.last!.onCreated(response); });
    expect(readFirstRunGuide()).toEqual({ status: 'active', step: 'play', projectId: 'by-hand' });
    expect(onImportFolderResponse).toHaveBeenCalledWith(response);
    // Like the sample made in one click, it opens running.
    expect(takeProjectGameStart('by-hand')).toBe(true);
  });

  it('leaves the walkthrough alone when another kind of game is made there', async () => {
    await openFallback();
    await act(async () => { dialogs.last!.onMade?.({ projectId: 'other', templateId: 'godot-blank' }); await dialogs.last!.onCreated({ ok: true, projectId: 'other' }); });
    expect(readFirstRunGuide()).toBeNull();
    expect(takeProjectGameStart('other')).toBe(false);
  });
});

describe('the walkthrough from the help menu', () => {
  it('asks Home for it from any page', () => {
    render(<I18nProvider initial="en"><RailHelpMenu page="home" /></I18nProvider>);
    fireEvent.click(screen.getByTestId('entry-nav-help'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Walkthrough' }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'home' });
    expect(takeEntryGuideRequest()).toBe(true);
  });

  it('waits for the games to load, then reopens the one sample once', async () => {
    publishFirstRunGuide({ status: 'done', step: 'make', projectId: 'sample' });
    requestEntryGuide();
    const view = dashboard([], true);
    expect(view.onOpenProject).not.toHaveBeenCalled();
    view.rerender([project('sample', template.id)]);
    await waitFor(() => expect(view.onOpenProject).toHaveBeenCalledWith('sample'));
    expect(readFirstRunGuide()).toMatchObject({ status: 'active', step: 'play' });
    expect(creations).toBe(0);
    // With Home already open, the next request is taken at once.
    act(() => requestEntryGuide());
    expect(view.onOpenProject).toHaveBeenCalledTimes(2);
  });
});
