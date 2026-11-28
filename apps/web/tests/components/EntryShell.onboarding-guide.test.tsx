// @vitest-environment jsdom
// The last answer of first run ("Have you made a game before?") leaves for Home
// while the sample game is still being made. Home must say so, and must not let
// a second click make a second sample.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import { readFirstRunGuide, resetFirstRunGuideForTests } from '../../src/state/first-run-guide';
import { takeProjectGameStart } from '../../src/state/game-start-request';
import type { AppConfig } from '../../src/types';

vi.mock('../../src/analytics/provider', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/analytics/provider')>(),
  useAnalytics: () => ({ newRequestId: vi.fn(() => 'request-1'), setConfigureGlobals: vi.fn(), setConsent: vi.fn(), setIdentity: vi.fn(), track: vi.fn() }),
  useAppVersion: () => null,
}));
// First run itself is tested on its own; here it only finishes the way the
// experience question does: leave, then start the walkthrough.
vi.mock('../../src/components/onboarding/OnboardingView', () => ({
  OnboardingView: (props: { onFinish: () => void; onStartGuide?: () => void; offerGuide?: boolean }) => (
    <button type="button" onClick={() => { props.onFinish(); props.onStartGuide?.(); }}>
      {props.offerGuide ? 'First game' : 'No walkthrough offered'}
    </button>
  ),
}));

const template = { id: 'phaser3-sample-platformer', name: 'Sample: pixel platformer', engine: 'phaser', description: 'Ready to play' };
let releaseCreate!: () => void;
let creations = 0;

beforeEach(() => {
  creations = 0;
  localStorage.clear();
  resetFirstRunGuideForTests();
  const created = new Promise<void>(resolve => { releaseCreate = resolve; });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/game-templates') return Response.json({ templates: [template], defaultParentDir: 'C:\\Games' });
    if (url.endsWith('/game-from-template/check')) return Response.json({ status: 'available' });
    if (url.endsWith('/game-from-template')) {
      creations += 1;
      await created;
      return Response.json({ project: { id: 'made', name: 'made', createdAt: 1, updatedAt: 1, skillId: null, metadata: { kind: 'prototype', templateId: template.id } },
        conversationId: 'c', entryFile: 'index.html', git: { status: 'skipped' } });
    }
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); resetFirstRunGuideForTests(); takeProjectGameStart('made'); vi.unstubAllGlobals(); });

it('shows the walkthrough getting ready on Home until its sample game opens', async () => {
  window.history.replaceState(null, '', '/onboarding');
  const onImportFolderResponse = vi.fn(async () => {});
  render(<I18nProvider initial="en"><EntryShell skills={[]} projects={[]} agents={[]} daemonLive
    config={{ mode: 'daemon', agentId: null, agentModels: {}, apiProtocol: 'anthropic', apiProtocolConfigs: {}, apiKey: '', baseUrl: '', model: '' } as AppConfig}
    onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()} onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()}
    onConfigPersist={vi.fn()} onRefreshAgents={vi.fn(() => [])} onCreateProject={vi.fn()}
    onBeginProjectCreation={() => ({ projectId: 'optimistic-project', rollback: () => undefined })}
    onCreatePluginShareProject={vi.fn()} onOpenProject={vi.fn()} onDeleteProject={vi.fn()} onRenameProject={vi.fn()}
    onOpenSettings={vi.fn()} onCompleteOnboarding={vi.fn()} onImportFolderResponse={onImportFolderResponse} /></I18nProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'First game' }));
  const tile = await screen.findByRole('button', { name: /Getting it ready/ });
  expect((tile as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(creations).toBe(1));

  await act(async () => { releaseCreate(); });
  await waitFor(() => expect(onImportFolderResponse).toHaveBeenCalledOnce());
  expect(readFirstRunGuide()).toEqual({ status: 'active', step: 'play', projectId: 'made' });
  expect(creations).toBe(1);
});
