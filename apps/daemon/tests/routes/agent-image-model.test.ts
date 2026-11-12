import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { agentImageModelChoices, registerAgentImageModelRoutes, type AgentImageModelFacts } from '../../src/routes/agent-image-model.js';

describe('the image models the user can pick for the agent', () => {
  it('lists runnable text-to-image models, Codex first and hosted last, with automatic', () => {
    const choices = agentImageModelChoices({ usableProviders: ['openai', 'codex-cli'], signedIn: true, selected: undefined });
    expect(choices.selected).toBeNull();
    expect(choices.automatic).toBe('codex-image');
    expect(choices.options.map((option) => option.id)).toEqual(['codex-image', 'gpt-image-2', 'dall-e-3', 'openpixo-image']);
    expect(choices.options.at(-1)).toMatchObject({ hosted: true, available: true });
    // Edits need a reference image, so they cannot be the default model.
    expect(choices.options.some((option) => option.id === 'openpixo-image-edit')).toBe(false);
  });

  it('offers hosted images only when signed in, and keeps automatic honest', () => {
    const signedOut = agentImageModelChoices({ usableProviders: [], signedIn: false, selected: undefined });
    expect(signedOut).toEqual({ selected: null, automatic: null, options: [] });
    expect(agentImageModelChoices({ usableProviders: [], signedIn: true, selected: undefined }).automatic).toBe('openpixo-image');
  });

  it('keeps a saved pick that cannot run in the list, marked, with the reason', () => {
    const choices = agentImageModelChoices({ usableProviders: ['codex-cli'], signedIn: false, selected: 'gpt-image-2' });
    expect(choices.selected).toBe('gpt-image-2');
    expect(choices.selectedUnavailable).toBe('not-connected');
    expect(choices.options.find((option) => option.id === 'gpt-image-2')).toMatchObject({ available: false });
    expect(agentImageModelChoices({ usableProviders: ['codex-cli'], signedIn: false, selected: 'openpixo-image' }).selectedUnavailable).toBe('needs-art-budget');
    expect(agentImageModelChoices({ usableProviders: ['codex-cli'], signedIn: false, selected: 'flux-dev-fal' }).selected).toBe('flux-dev-gateway');
  });

  it('names no hosted vendor', () => {
    const body = JSON.stringify(agentImageModelChoices({ usableProviders: ['media-gateway'], signedIn: true, selected: 'flux-dev-gateway' }));
    expect(body).not.toMatch(/\bfal\b|fal-ai|-fal\b|fal\.ai/i);
  });

  describe('GET /api/media/agent-image-models', () => {
    let server: http.Server | null = null;
    afterEach(async () => {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      server = null;
    });

    it('answers from the daemon facts', async () => {
      const app = express();
      const facts: AgentImageModelFacts = { usableProviders: ['codex-cli'], signedIn: false, selected: 'codex-image' };
      registerAgentImageModelRoutes(app, { http: { requireLocalDaemonRequest: (_req, _res, next) => next() }, readFacts: async () => facts });
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server!.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/media/agent-image-models`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ selected: 'codex-image', automatic: 'codex-image', options: [{ id: 'codex-image', available: true }] });
    });
  });
});
