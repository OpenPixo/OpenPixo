// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GameTemplateSummary, ProjectNextStepsResponse } from '@openpixo/contracts';
import type { Project } from '../../../src/types';
import { HomeContinue } from '../../../src/components/home/HomeContinue';
import { I18nProvider } from '../../../src/i18n';

const progress = vi.hoisted(() => ({ data: null as ProjectNextStepsResponse | null }));
vi.mock('../../../src/components/quest/useQuestProgress', () => ({ useQuestProgress: () => progress }));
vi.mock('../../../src/components/home/HomeTemplates', () => ({ templateCover: () => '/api/styles/pixel-16-bit/previews/0' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); progress.data = null; });
const flush = async () => { await act(async () => {}); };
const template: GameTemplateSummary = { id: 'sample', engine: 'phaser', name: 'Platformer', description: 'Jump into a game' };
function project(id: string, updatedAt: number): Project {
  return { id, name: id, createdAt: 1, updatedAt, skillId: null, metadata: { kind: 'prototype', templateId: template.id } };
}
function quest(done: number) {
  const ids = ['environment', 'run-game', 'agent-task', 'media-assets', 'verify'] as const;
  progress.data = { projectId: 'new game', engine: 'phaser', dismissed: false,
    steps: ids.map((id, i) => ({ id, status: i < done ? 'done' : 'todo', action: { kind: 'run-game', value: 'new game' } })) };
}
function home(projects: Project[] = [], onOpenProject = vi.fn(), loading = false) {
  return <I18nProvider initial="en"><HomeContinue projects={projects} templates={[template]} loading={loading}
    onOpenProject={onOpenProject} /></I18nProvider>;
}
function mockFacts() {
  return vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url.includes('/conversations')) return Response.json({ conversations: [{ id: '1' }, { id: '2' }, { id: '3' }] });
    if (url.includes('cursor=next')) return Response.json({ assets: [{ kind: 'audio' }], nextCursor: null });
    if (url.includes('/assets?')) return Response.json({ assets: [{ kind: 'image', relPath: 'cover.png', mtime: 1 }], nextCursor: 'next' });
    if (options?.method === 'POST') return new Response(null, { status: 404 });
    throw new Error(`Unexpected request: ${url}`);
  });
}

it('renders nothing and asks for nothing without a project', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(home([]));
  expect(container.textContent).toBe('');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('holds a placeholder while the projects load', () => {
  render(home([], vi.fn(), true));
  expect(screen.getByRole('status', { name: 'Loading your latest game' })).toBeTruthy();
});

it('shows only the latest project with its real image, and no counters', async () => {
  quest(2);
  const fetchMock = mockFacts();
  const open = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(home([project('older', 1), project('new game', Date.now())], open));
  await flush();
  expect(screen.getByRole('heading', { name: 'Pick up where you left off' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'new game' })).toBeTruthy();
  expect(screen.queryByText('older')).toBeNull();
  expect(screen.getByText('Platformer · just now')).toBeTruthy();
  expect(document.querySelector('dl')).toBeNull();
  expect(screen.queryByText('Verification passed')).toBeNull();
  expect(document.querySelector('img')?.getAttribute('src')).toContain('/api/projects/new%20game/assets/thumb?');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('new game');
});

it('shows verification only from completed facts and opens while attempting the run API', async () => {
  quest(5);
  const fetchMock = mockFacts();
  const open = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(home([project('new game', Date.now())], open));
  await flush();
  expect(screen.getByText('Verification passed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Run game' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('new game');
  await flush();
  expect(fetchMock).toHaveBeenCalledWith('/api/projects/new%20game/game/run', { method: 'POST' });
});

it('falls back when the project image cannot load', async () => {
  const fetchMock = mockFacts();
  vi.stubGlobal('fetch', fetchMock);
  render(home([project('new game', Date.now())]));
  await flush();
  const image = document.querySelector('img')!;
  fireEvent.error(image);
  expect(image.getAttribute('src')).toBe('/api/styles/pixel-16-bit/previews/0');
});

it('survives a malformed assets response without crashing the project row', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  render(home([project('new game', Date.now())]));
  await flush();
  expect(screen.getByRole('heading', { name: 'new game' })).toBeTruthy();
});

it('falls back through the project thumbnail, selected style and template cover when previews fail', async () => {
  vi.stubGlobal('fetch', mockFacts());
  const game = project('styled game', Date.now());
  game.metadata!.artStyleId = 'monochrome-1-bit';
  render(home([game]));
  await flush();
  const image = document.querySelector('img')!;
  expect(image.getAttribute('src')).toContain('/api/projects/styled%20game/assets/thumb?');
  fireEvent.error(image);
  expect(image.getAttribute('src')).toBe('/api/styles/monochrome-1-bit/previews/0');
  fireEvent.error(image);
  expect(image.getAttribute('src')).toBe('/api/styles/pixel-16-bit/previews/0');
  fireEvent.error(image);
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
});
