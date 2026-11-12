import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';

import { GameView } from '../../../src/components/panel/GameView';
import { I18nProvider } from '../../../src/i18n';
import type { Locale } from '../../../src/i18n/types';

/**
 * Shared harness for the 游戏 view suites (specs/current/openpixo-game-panel.md §4).
 * Test files mock `tuning-api` themselves (vi.mock is hoisted per file).
 */
export type GameViewProps = ComponentProps<typeof GameView>;

export function gameViewElement(props: Partial<GameViewProps> = {}, locale: Locale = 'en') {
  return <I18nProvider initial={locale}>
    <GameView
      projectId="game"
      hidden={false}
      controls={{ verifyAvailable: true, startRequest: null }}
      onOpenFileAtLine={vi.fn()}
      onRefreshFiles={vi.fn(async () => {})}
      {...props}
    />
  </I18nProvider>;
}

export function renderGameView(props: Partial<GameViewProps> = {}, locale: Locale = 'en') {
  const view = render(gameViewElement(props, locale));
  return { ...view, rerenderGame: (next: Partial<GameViewProps> = {}) => view.rerender(gameViewElement({ ...props, ...next }, locale)) };
}

type Handler = (path: string, method: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/**
 * A fetch stub routed by path. Unhandled GET /game/run answers idle and
 * GET /game/verify/latest answers "no stored result"; anything else is 404.
 */
export function routeFetch(handler: Handler = () => undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const handled = await handler(path, method, init);
    if (handled) return handled;
    if (path.endsWith('/game/run') && method === 'GET') return Response.json({ status: 'idle' });
    if (path.endsWith('/game/verify/latest')) return Response.json(null);
    return new Response('not found', { status: 404 });
  });
}

export function callsTo(mock: { mock: { calls: unknown[][] } }, suffix: string, method = 'GET') {
  return mock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method);
}

export const gameToolbar = () => within(screen.getByRole('toolbar'));
export const gameStatus = () => screen.getByTestId('panel-game-status').textContent;
