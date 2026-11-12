// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentImageModelsResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentImageModelChip, AgentImageModelSetting } from '../../src/components/agent-image-model/AgentImageModelPicker';

const LIST: AgentImageModelsResponse = {
  selected: null,
  automatic: 'codex-image',
  options: [
    { id: 'codex-image', label: 'codex-image', provider: 'codex-cli', providerLabel: 'Codex (ChatGPT sign-in)', hosted: false, available: true },
    { id: 'gpt-image-2', label: 'gpt-image-2', provider: 'openai', providerLabel: 'OpenAI', hosted: false, available: true },
    { id: 'openpixo-image', label: 'OpenPixo image', provider: 'openpixo', providerLabel: 'OpenPixo cloud (credits)', hosted: true, available: true },
  ],
};

function mockDaemon(list: AgentImageModelsResponse) {
  let current = list;
  const writes: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/app-config' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      current = { ...current, selected: body.agentImageModel === 'auto' ? null : body.agentImageModel };
      return new Response(JSON.stringify({ config: body }), { status: 200 });
    }
    if (url === '/api/media/agent-image-models') return new Response(JSON.stringify(current), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { writes };
}

describe('the image model the AI uses', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Settings lists automatic and the connected models, and saves a pick at once', async () => {
    const { writes } = mockDaemon(LIST);
    render(<AgentImageModelSetting />);
    const select = await screen.findByTestId('agent-image-model-select') as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(screen.getByText('Image model the AI uses')).toBeTruthy();
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Automatic (now Codex (ChatGPT sign-in))', 'Codex (ChatGPT sign-in)', 'gpt-image-2 · OpenAI', 'OpenPixo credits (uses the art budget)',
    ]);
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'gpt-image-2' } });
    await waitFor(() => expect(writes).toEqual([{ agentImageModel: 'gpt-image-2' }]));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(writes).toEqual([{ agentImageModel: 'gpt-image-2' }, { agentImageModel: 'auto' }]));
  });

  it('says why a saved pick cannot run now', async () => {
    mockDaemon({
      ...LIST,
      selected: 'grok-imagine-image',
      selectedUnavailable: 'not-connected',
      options: [...LIST.options, { id: 'grok-imagine-image', label: 'grok-imagine-image', provider: 'grok', providerLabel: 'xAI Grok Imagine', hosted: false, available: false }],
    });
    render(<AgentImageModelSetting />);
    expect(await screen.findByText(/isn't connected right now/)).toBeTruthy();
    expect((screen.getByTestId('agent-image-model-select') as HTMLSelectElement).value).toBe('grok-imagine-image');
  });

  it('the composer chip shows the current choice and writes the same pref', async () => {
    const { writes } = mockDaemon({ ...LIST, selected: 'gpt-image-2' });
    render(<AgentImageModelChip />);
    const chip = await screen.findByTestId('agent-image-model-chip');
    expect(chip.textContent).toContain('Images:');
    const select = screen.getByLabelText('Image model the AI uses') as HTMLSelectElement;
    expect(select.value).toBe('gpt-image-2');
    fireEvent.change(select, { target: { value: 'codex-image' } });
    await waitFor(() => expect(writes).toEqual([{ agentImageModel: 'codex-image' }]));
    await waitFor(() => expect(select.value).toBe('codex-image'));
  });
});
