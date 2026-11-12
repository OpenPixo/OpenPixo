import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseClient } from '../../src/account/supabase.js';

const CONFIG = { url: 'https://cloud.example', anonKey: 'anon', agentUrl: 'https://gateway.example' };

describe('where cloud requests go', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function recordFetch(): string[] {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      urls.push(String(input));
      return new Response('{}', { status: 200 });
    }));
    return urls;
  }

  it('sends the hosted agent to its gateway', async () => {
    const urls = recordFetch();
    const client = new SupabaseClient(CONFIG);
    await client.agent('models', 'GET', undefined, undefined, '?v=2');
    await client.agent('usage', 'GET', undefined, 'token', '?run=r');
    await client.agentStream('chat/completions', new Uint8Array(), 'token', {}, new AbortController().signal, 1000);
    expect(urls).toEqual([
      'https://gateway.example/agent-chat/models?v=2',
      'https://gateway.example/agent-chat/usage?run=r',
      'https://gateway.example/agent-chat/chat/completions',
    ]);
  });

  it('keeps credits and sign-in on the cloud', async () => {
    const urls = recordFetch();
    const client = new SupabaseClient(CONFIG);
    await client.edge('credits', 'GET', undefined, 'token');
    await client.auth('user', 'GET', undefined, 'token');
    expect(urls).toEqual(['https://cloud.example/functions/v1/credits', 'https://cloud.example/auth/v1/user']);
  });
});
