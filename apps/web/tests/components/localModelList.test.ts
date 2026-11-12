import { describe, expect, it } from 'vitest';
import { LOCAL_MODEL_SEARCH_RESULTS, localAgentOffered, localModelView } from '../../src/components/localModelList';
import type { AgentInfo } from '../../src/types';

const models = (count: number) => [{ id: 'default', label: 'Default' },
  ...Array.from({ length: count }, (_, index) => ({ id: `provider/model-${index}`, label: `Model ${index}` }))];

describe('local model list', () => {
  it('shows a short list whole', () => {
    expect(localModelView(models(5), null, '')).toEqual({ rows: models(5), searchable: false, matches: 6 });
  });

  it('keeps a long list to the default and the chosen model until searched, and caps a search', () => {
    expect(localModelView(models(400), 'provider/model-7', '').rows.map((model) => model.id)).toEqual(['default', 'provider/model-7']);
    const broad = localModelView(models(400), null, 'model');
    expect(broad).toMatchObject({ searchable: true, matches: 400 });
    expect(broad.rows).toHaveLength(LOCAL_MODEL_SEARCH_RESULTS);
    expect(localModelView(models(100), null, ' MODEL 12 ').rows.map((model) => model.id)).toEqual(['provider/model-12']);
    // Words match apart, so a space finds a dashed id.
    const named = [...models(20), { id: 'openrouter/anthropic/claude-sonnet-5.5', label: 'openrouter/anthropic/claude-sonnet-5.5' }];
    expect(localModelView(named, null, 'sonnet 5.5').rows.map((model) => model.id)).toEqual(['openrouter/anthropic/claude-sonnet-5.5']);
    expect(localModelView(named, null, 'sonnet 4').rows).toEqual([]);
  });

  it('offers a found CLI unless it says it is signed out and is not the chosen one', () => {
    const agent = (authStatus?: AgentInfo['authStatus'], available = true) => ({ id: 'codex', name: 'Codex', available, authStatus }) as AgentInfo;
    expect(localAgentOffered(agent('ok'), 'claude')).toBe(true);
    expect(localAgentOffered(agent('unknown'), 'claude')).toBe(true);
    expect(localAgentOffered(agent(undefined), 'claude')).toBe(true);
    expect(localAgentOffered(agent('missing'), 'claude')).toBe(false);
    expect(localAgentOffered(agent('missing'), 'codex')).toBe(true);
    expect(localAgentOffered(agent('ok', false), 'codex')).toBe(false);
    expect(localAgentOffered(undefined, 'codex')).toBe(false);
  });
});
