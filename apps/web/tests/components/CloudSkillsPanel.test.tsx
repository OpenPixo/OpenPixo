// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CloudSkillsResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillsPanel } from '../../src/components/CloudSkillsPanel';

const STATUS: CloudSkillsResponse = {
  skills: [
    { name: 'level-pacing', version: 'aaaaaaaaaaaa', title: 'Level pacing', description: 'Paces a level so it ramps up.', active: true },
    { name: 'game-feel-juice', version: 'bbbbbbbbbbbb', title: 'Cloud juice', description: 'Adds feedback.', active: false },
  ],
  tools: [{ id: 'balance-check', description: 'Checks a balance table for runaway numbers.', input: 'text' }],
  syncedAt: '2026-11-23T04:00:00.000Z',
  error: null,
  signedIn: true,
};

function mockDaemon(status: CloudSkillsResponse) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/cloud-skills' || url === '/api/cloud-skills/sync') return new Response(JSON.stringify(status), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  return calls;
}

describe('cloud skills in Settings', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('lists the cloud skills and tools read-only, marks a shadowed one, and checks for updates on request', async () => {
    const calls = mockDaemon(STATUS);
    render(<CloudSkillsPanel />);
    expect(await screen.findByText('Level pacing')).toBeTruthy();
    expect(screen.getByText('balance-check')).toBeTruthy();
    expect(screen.getByText(/one of your local skills has the same name/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete/iu })).toBeNull();
    fireEvent.click(screen.getByTestId('cloud-skills-sync'));
    await waitFor(() => expect(calls).toContain('POST /api/cloud-skills/sync'));
  });

  it('asks a signed-out user to sign in and does not offer a sync', async () => {
    mockDaemon({ ...STATUS, skills: [], tools: [], signedIn: false, syncedAt: null });
    render(<CloudSkillsPanel />);
    expect(await screen.findByText('Sign in to get cloud skills.')).toBeTruthy();
    expect((screen.getByTestId('cloud-skills-sync') as HTMLButtonElement).disabled).toBe(true);
  });
});
