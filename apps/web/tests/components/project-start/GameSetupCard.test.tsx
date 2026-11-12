// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameProjectSetupResponse } from '@openpixo/contracts';
import { GameSetupCard } from '../../../src/components/project-start/GameSetupCard';
import { I18nProvider, tForLanguageTag } from '../../../src/i18n';

vi.mock('../../../src/providers/styles', () => ({ listArtStyles: vi.fn(async () => []) }));

const t = tForLanguageTag('en')!;
let stored: GameProjectSetupResponse;
let puts: unknown[];

beforeEach(() => {
  sessionStorage.clear();
  puts = [];
  stored = { setup: { genre: 'puzzle', platforms: ['web'] }, missingSteps: ['art', 'setup'] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/game-setup') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { setup: GameProjectSetupResponse['setup'] };
      puts.push(body.setup);
      stored = { setup: body.setup, missingSteps: [] };
      return Response.json(stored);
    }
    if (String(url).endsWith('/game-setup')) return Response.json(stored);
    return Response.json({ error: { message: 'unexpected' } }, { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const card = () => render(<I18nProvider initial="en"><GameSetupCard projectId="imported" /></I18nProvider>);

it('shows the missing steps of an imported game and finishes them in the setup dialog', async () => {
  card();
  expect(await screen.findByTestId('game-setup-card')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('game.setup.card.action') }));
  // Basics is already answered, so the dialog opens on the first unfinished step.
  await screen.findByTestId('wizard-step-art');
  const next = () => screen.getByTestId('wizard-next') as HTMLButtonElement;
  expect(next().disabled).toBe(true);
  fireEvent.click(await screen.findByRole('radio', { name: t('game.wizard.styleCustom') }));
  fireEvent.change(screen.getByLabelText(new RegExp(`^${t('game.wizard.direction')}`)), { target: { value: 'Paper cut-outs' } });
  fireEvent.click(next());
  await screen.findByTestId('wizard-step-setup');
  fireEvent.click(next());
  await screen.findByTestId('wizard-step-review');
  fireEvent.click(screen.getByRole('button', { name: t('game.setup.save') }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toEqual({
    genre: 'puzzle', players: ['single'], release: { languages: ['en'] }, platforms: ['web'], art: { direction: 'Paper cut-outs' },
    display: { width: 1920, height: 1080, scaling: 'fit' }, controls: ['keyboard'],
  });
  await waitFor(() => expect(screen.queryByTestId('game-setup-card')).toBeNull());
});

it('stays hidden for a complete setup and after Later', async () => {
  stored = { setup: null, missingSteps: ['basics', 'art', 'setup'] };
  const view = card();
  fireEvent.click(await screen.findByRole('button', { name: t('game.setup.card.later') }));
  expect(screen.queryByTestId('game-setup-card')).toBeNull();
  view.unmount();
  card();
  await act(async () => {});
  expect(screen.queryByTestId('game-setup-card')).toBeNull();

  cleanup();
  sessionStorage.clear();
  stored = { setup: { genre: 'x' }, missingSteps: [] };
  card();
  await act(async () => {});
  expect(screen.queryByTestId('game-setup-card')).toBeNull();
});
