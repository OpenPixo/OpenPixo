// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppliedPluginSnapshot } from '@openpixo/contracts';

import { ChatComposer, type ChatComposerHandle } from '../../src/components/ChatComposer';
import { flushMounts, typeAndSettle } from '../helpers/lexical-composer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function snapshot(pluginId: string, pluginTitle: string): AppliedPluginSnapshot {
  return {
    snapshotId: `snap-${pluginId}`,
    pluginId,
    pluginVersion: '1.0.0',
    manifestSourceDigest: 'a'.repeat(64),
    inputs: {},
    resolvedContext: { items: [] },
    capabilitiesGranted: [],
    capabilitiesRequired: [],
    assetsStaged: [],
    taskKind: 'new-generation',
    appliedAt: 0,
    mcpServers: [],
    pluginTitle,
    status: 'fresh',
  } as unknown as AppliedPluginSnapshot;
}

async function renderWithAppliedPlugin(applied: AppliedPluginSnapshot) {
  const onSend = vi.fn();
  const composerRef = createRef<ChatComposerHandle>();
  render(
    <ChatComposer
      ref={composerRef}
      projectId="project-1"
      projectFiles={[]}
      streaming={false}
      onEnsureProject={async () => 'project-1'}
      onSend={onSend}
      onStop={vi.fn()}
    />,
  );
  await flushMounts();
  act(() => {
    composerRef.current?.restoreDraft({
      text: '把首屏文案改短一点',
      meta: {
        appliedPluginSnapshot: applied,
        appliedPluginSnapshotId: applied.snapshotId,
      },
    });
  });
  await flushMounts();
  return { onSend };
}

describe('selected plugin context', () => {
  it('shows the user-selected plugin chip', async () => {
    await renderWithAppliedPlugin(snapshot('my-export', 'My Export'));

    expect(screen.getByTestId('staged-contexts')).toBeTruthy();
    expect(document.querySelector('[data-staged-kind="plugin"]')).not.toBeNull();
    expect(screen.getByText('My Export')).toBeTruthy();
  });
});

describe('selected plugin persistence', () => {
  it('sends the selected plugin snapshot for persistence and retry', async () => {
    const { onSend } = await renderWithAppliedPlugin(
      snapshot('my-export', 'My Export'),
    );

    await typeAndSettle('把首屏文案改短一点');
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalled());

    const meta = onSend.mock.calls[0]?.[2] as
      | { appliedPluginSnapshot?: AppliedPluginSnapshot; appliedPluginSnapshotId?: string | null }
      | undefined;
    expect(meta?.appliedPluginSnapshot?.pluginId).toBe('my-export');
    expect(meta?.appliedPluginSnapshotId).toBe('snap-my-export');
  });
});
