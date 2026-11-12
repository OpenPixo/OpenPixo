// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GameTemplateSummary, Project } from '@openpixo/contracts';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({ PlaceholderCarousel: () => null }));
vi.mock('../../src/components/NewGameDialog', () => ({
  NewGameDialog: ({ initialTemplateId, onClose }: { initialTemplateId?: string; onClose: () => void }) =>
    <div role="dialog" aria-label="New game"><span data-testid="selected-template">{initialTemplateId ?? 'all'}</span><button onClick={onClose}>Close</button></div>,
}));

import { HomeView } from '../../src/components/HomeView';
import { templateCover } from '../../src/components/home/HomeTemplates';
import { I18nProvider } from '../../src/i18n';

const templates: GameTemplateSummary[] = [
  { id: 'phaser3-vite', name: 'Phaser blank', engine: 'phaser', description: 'Blank starter' },
  { id: 'threejs-vite', name: 'Three.js web', engine: 'threejs', description: 'Browser 3D' },
  { id: 'godot4-3d', name: 'Godot 3D', engine: 'godot', description: 'Third person' },
  { id: 'godot4-2d', name: 'Godot 2D', engine: 'godot', description: 'Scene starter' },
  { id: 'phaser3-sample-platformer', name: 'Pixel platformer', engine: 'phaser', description: 'Ready to play',
    coverUrl: '/api/game-templates/phaser3-sample-platformer/cover' },
];

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/game-templates')) return Response.json({ templates });
    if (url.endsWith('/next-steps')) return Response.json({ projectId: 'latest', engine: 'phaser', dismissed: false,
      steps: ['environment', 'run-game', 'agent-task', 'media-assets', 'verify'].map(id => ({ id, status: 'todo', action: { kind: 'run-game', value: 'latest' } })) });
    if (url.includes('/assets')) return Response.json({ assets: [] });
    if (url.includes('/conversations')) return Response.json({ conversations: [] });
    if (url.endsWith('/api/plugins')) return Response.json({ plugins: [] });
    if (url.endsWith('/api/recipes')) return Response.json([]);
    return Response.json({});
  }));
}

function renderHome(props: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  stubFetch();
  return render(<I18nProvider initial="en"><HomeView projects={[]} onSubmit={vi.fn()} onOpenProject={vi.fn()}
    onImportFolder={vi.fn()} onImportFolderResponse={vi.fn()} {...props} /></I18nProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('Home dashboard', () => {
  it('gives a new user one main action and the composer, with no template examples', async () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Make your first game');
    expect(screen.getByRole('button', { name: 'New game' }).className).toMatch(/primary/);
    expect(screen.getByRole('button', { name: 'Open folder' }).className).toMatch(/ghost/);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pixel platformer' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Example tasks' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Continue/ })).toBeNull();
  });

  it('opens the new game dialog from New game', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByTestId('selected-template').textContent).toBe('all');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'New game' })).toBeNull();
  });

  it('falls back to the template screenshot, else a matching art-style preview, for continue covers', () => {
    const byId = Object.fromEntries(templates.map(template => [template.id, template]));
    expect(templateCover(byId['phaser3-sample-platformer']!)).toBe('/api/game-templates/phaser3-sample-platformer/cover');
    expect(templateCover(byId['godot4-2d']!)).toBe('/api/styles/isometric-pixel/previews/0');
    expect(templateCover(byId['godot4-3d']!)).toBe('/api/styles/low-poly-3d/previews/0');
    expect(templateCover(byId['threejs-vite']!)).toBe('/api/styles/toon-3d/previews/0');
  });

  it('continues the most recent project', async () => {
    const onOpenProject = vi.fn();
    const projects: Project[] = [
      { id: 'older', name: 'Older game', createdAt: 1, updatedAt: 1, skillId: null },
      { id: 'latest', name: 'Latest game', createdAt: 2, updatedAt: 2, skillId: null },
    ];
    renderHome({ projects, onOpenProject });
    expect(await screen.findByText('Latest game')).toBeTruthy();
    expect(screen.queryByText('Older game')).toBeNull();
    // Continue is the main action now, and New game goes quiet.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back');
    expect(screen.getByRole('button', { name: 'New game' }).className).toMatch(/secondary/);
    expect(screen.getByRole('button', { name: 'Continue' }).className).toMatch(/primary/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onOpenProject).toHaveBeenCalledWith('latest');
  });

  it('does not flash the new-user screen while the projects are still loading', () => {
    renderHome({ projectsLoading: true });
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New game' })).toBeNull();
  });

  it('keeps environment checks reachable', () => {
    const onOpenDoctor = vi.fn();
    renderHome({ onOpenDoctor });
    fireEvent.click(screen.getByRole('button', { name: 'Environment check' }));
    expect(onOpenDoctor).toHaveBeenCalledOnce();
  });
});
