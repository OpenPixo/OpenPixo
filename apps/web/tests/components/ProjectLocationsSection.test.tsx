// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/types';
import { ProjectLocationsSection } from '../../src/components/ProjectLocationsSection';
import { projectLocationRefusalFromBody } from '../../src/state/project-locations';
import { zhCN } from '../../src/i18n/locales/zh-CN';

function translate(key: keyof typeof zhCN, vars?: Record<string, string | number>) {
  return zhCN[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
}

vi.mock('../../src/i18n', () => ({
  useT: () => translate,
  useI18n: () => ({ t: translate, locale: 'zh-CN' }),
}));

const BUILT_IN = { id: 'default', name: 'OpenPixo projects', path: 'C:\\data\\projects', builtIn: true };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Serves the settings page's three calls; the PUT answers with `putResponse`. */
function stubDaemon(picked: string, putResponse: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/project-locations' && (init?.method ?? 'GET') === 'GET') return json(200, { locations: [BUILT_IN] });
    if (url === '/api/dialog/open-folder') return json(200, { path: picked });
    if (url === '/api/project-locations' && init?.method === 'PUT') return putResponse();
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function addFolder() {
  render(<ProjectLocationsSection cfg={{} as AppConfig} setCfg={vi.fn()} />);
  // Until the list loads, a disabled fallback button stands in for the one on the built-in row.
  await screen.findByText(BUILT_IN.path);
  const add = screen.getByRole('button', { name: /添加文件夹/ }) as HTMLButtonElement;
  await waitFor(() => expect(add.disabled).toBe(false));
  fireEvent.click(add);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectLocationsSection refusals', () => {
  it('names the refused folder and the system code when the daemon cannot open it', async () => {
    stubDaemon('D:\\MyGames', () => json(400, {
      error: {
        code: 'BAD_REQUEST',
        message: 'directory is not accessible (EPERM): D:\\MyGames',
        details: { reason: 'not-accessible', path: 'D:\\MyGames', systemCode: 'EPERM' },
      },
    }));
    await addFolder();
    expect(await screen.findByText('OpenPixo 无法打开“D:\\MyGames”（EPERM）。请确认这个文件夹存在，并且没有被安全软件拦截。'))
      .toBeTruthy();
    // The refused folder is not left in the list as if it were saved.
    expect(screen.queryByText('MyGames')).toBeNull();
  });

  it('names a whole drive as the reason', async () => {
    stubDaemon('D:\\', () => json(400, {
      error: { code: 'BAD_REQUEST', message: 'project location cannot be a drive root: D:\\', details: { reason: 'drive-root', path: 'D:\\' } },
    }));
    await addFolder();
    expect(await screen.findByText('“D:\\”是整个磁盘，请在里面选一个或新建一个文件夹。')).toBeTruthy();
  });

  it('keeps the general message when the daemon gives no reason', async () => {
    stubDaemon('D:\\MyGames', () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }));
    await addFolder();
    expect(await screen.findByText(zhCN['settings.projectLocationsSaveError'])).toBeTruthy();
  });
});

describe('projectLocationRefusalFromBody', () => {
  it('ignores an unknown reason', () => {
    expect(projectLocationRefusalFromBody({ error: { details: { reason: 'other', path: 'D:\\x' } } })).toBeNull();
  });
});
