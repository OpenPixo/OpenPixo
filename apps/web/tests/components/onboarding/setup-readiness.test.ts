import { describe, expect, it } from 'vitest';
import {
  cloudCanSpend,
  HOSTED_AGENT_ID,
  IMAGE_KEY_PROVIDER_IDS,
  noAgentNotice,
  planTier,
  prepareOnboardingRerun,
  readyAgentSource,
  readyImageSource,
  returningSetupSatisfied,
  setupGate,
  type CloudFacts,
} from '../../../src/components/onboarding/setup-readiness';
import { IMAGE_KEY_PROVIDERS } from '../../../src/components/onboarding/key-guides';
import { DEFAULT_CONFIG } from '../../../src/state/config';
import type { AgentInfo, AppConfig } from '../../../src/types';

const SIGNED_OUT: CloudFacts = { signedIn: false, credits: null };
const BROKE: CloudFacts = { signedIn: true, credits: { available: 0, subscription: null } };
const FUNDED: CloudFacts = { signedIn: true, credits: { available: 120, subscription: null } };
function subscribed(status: 'active' | 'past_due' | 'canceled' | 'incomplete'): CloudFacts {
  return {
    signedIn: true,
    credits: {
      available: 0,
      subscription: {
        sku: 'plan_starter_monthly_v3', status, monthlyCredits: 600,
        currentPeriodEnd: '2026-12-01T00:00:00Z', cancelAtPeriodEnd: false,
      },
    },
  } as CloudFacts;
}

const codexAgent: AgentInfo = { id: 'codex', name: 'Codex', bin: 'codex', available: true, authStatus: 'ok' };
const claudeAgent: AgentInfo = { id: 'claude', name: 'Claude Code', bin: 'claude', available: true, authStatus: 'ok' };
const hostedAgent: AgentInfo = { id: HOSTED_AGENT_ID, name: 'OpenPixo (credits)', bin: 'opencode', available: true };

function config(patch: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, agentId: null, ...patch };
}

describe('cloud spending', () => {
  it('needs a session and either credits or a plan that still grants them', () => {
    expect(cloudCanSpend(SIGNED_OUT)).toBe(false);
    expect(cloudCanSpend(BROKE)).toBe(false);
    expect(cloudCanSpend(FUNDED)).toBe(true);
    expect(cloudCanSpend(subscribed('active'))).toBe(true);
    expect(cloudCanSpend(subscribed('past_due'))).toBe(true);
    expect(cloudCanSpend(subscribed('canceled'))).toBe(false);
    expect(cloudCanSpend(subscribed('incomplete'))).toBe(false);
    // Credits a signed-out snapshot still holds do not count.
    expect(cloudCanSpend({ signedIn: false, credits: { available: 50, subscription: null } })).toBe(false);
  });
});

describe('image readiness', () => {
  const none = { cloud: SIGNED_OUT, codexImage: null, mediaProviders: {} };

  it('is missing until something can actually make an image', () => {
    expect(readyImageSource(none)).toBeNull();
    expect(readyImageSource({ ...none, codexImage: { available: false, keyless: true, reasonCode: 'CODEX_CLI_AUTH_REQUIRED' } })).toBeNull();
    expect(readyImageSource({ ...none, cloud: BROKE })).toBeNull();
  });

  it('accepts Codex signed in with ChatGPT', () => {
    expect(readyImageSource({ ...none, codexImage: { available: true, keyless: true } })).toEqual({ kind: 'codex' });
  });

  it('offers the user\'s own fal key as one choice among the image key providers', () => {
    expect(IMAGE_KEY_PROVIDERS.map((provider) => provider.label)).toContain('fal.ai');
    expect(IMAGE_KEY_PROVIDERS.length).toBeGreaterThan(1);
  });

  it('accepts a saved key only for a provider that makes images', () => {
    expect(readyImageSource({ ...none, mediaProviders: { openai: { apiKey: 'sk-test', baseUrl: '' } } }))
      .toEqual({ kind: 'key', providerId: 'openai' });
    // A daemon-reported key is a marker, not the secret.
    expect(readyImageSource({ ...none, mediaProviders: { 'media-gateway': { apiKey: '', baseUrl: '', apiKeyConfigured: true, apiKeyTail: 'abcd' } } }))
      .toEqual({ kind: 'key', providerId: 'media-gateway' });
    expect(readyImageSource({ ...none, mediaProviders: { elevenlabs: { apiKey: 'xi-test', baseUrl: '' } } })).toBeNull();
    expect(readyImageSource({ ...none, mediaProviders: { openai: { apiKey: '  ', baseUrl: '' } } })).toBeNull();
  });

  it('accepts OpenPixo cloud when the account can pay, and prefers it on the subscription path', () => {
    const both = { ...none, cloud: FUNDED, codexImage: { available: true, keyless: true } as const };
    expect(readyImageSource({ ...none, cloud: FUNDED })).toEqual({ kind: 'cloud' });
    expect(readyImageSource(both)).toEqual({ kind: 'codex' });
    expect(readyImageSource({ ...both, preferCloud: true })).toEqual({ kind: 'cloud' });
  });

  it('offers only providers that are wired for images from a key', () => {
    expect(IMAGE_KEY_PROVIDER_IDS).not.toContain('codex-cli');
    expect(IMAGE_KEY_PROVIDER_IDS).not.toContain('openpixo');
    for (const provider of IMAGE_KEY_PROVIDERS) expect(IMAGE_KEY_PROVIDER_IDS).toContain(provider.id);
  });
});

describe('agent readiness', () => {
  it('uses a found CLI, preferring the saved one, then Codex', () => {
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [claudeAgent, codexAgent], config: config() }))
      .toEqual({ kind: 'local', agentId: 'codex' });
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [claudeAgent, codexAgent], config: config({ agentId: 'claude' }) }))
      .toEqual({ kind: 'local', agentId: 'claude' });
  });

  it('does not count a CLI that is missing, waiting for sign-in, or internal', () => {
    const agents: AgentInfo[] = [
      { ...codexAgent, available: false },
      { ...claudeAgent, authStatus: 'missing' },
      { id: 'byok-opencode', name: 'BYOK OpenCode', bin: 'opencode', available: true },
    ];
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents, config: config() })).toBeNull();
  });

  it('accepts an API-key runtime only when key, address and model are all filled', () => {
    const api = config({ mode: 'api', apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [], config: api })).toEqual({ kind: 'api' });
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [], config: { ...api, apiKey: '' } })).toBeNull();
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [], config: { ...api, mode: 'daemon' } })).toBeNull();
  });

  it('uses the hosted agent only for an account that can pay for it', () => {
    expect(readyAgentSource({ cloud: BROKE, agents: [hostedAgent], config: config() })).toBeNull();
    expect(readyAgentSource({ cloud: FUNDED, agents: [hostedAgent], config: config() }))
      .toEqual({ kind: 'hosted', agentId: HOSTED_AGENT_ID });
    // A saved local choice still wins over the hosted default.
    expect(readyAgentSource({ cloud: FUNDED, agents: [hostedAgent, claudeAgent], config: config({ agentId: 'claude' }) }))
      .toEqual({ kind: 'local', agentId: 'claude' });
    // A brand-new install has no saved agent, so the hosted model wins over an installed Codex.
    expect(readyAgentSource({ cloud: FUNDED, agents: [codexAgent, hostedAgent], config: { ...DEFAULT_CONFIG } }))
      .toEqual({ kind: 'hosted', agentId: HOSTED_AGENT_ID });
    // Without an account that can pay, the installed Codex is used.
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [codexAgent, hostedAgent], config: { ...DEFAULT_CONFIG } }))
      .toEqual({ kind: 'local', agentId: 'codex' });
    // The hosted agent is never mistaken for a local CLI.
    expect(readyAgentSource({ cloud: SIGNED_OUT, agents: [hostedAgent], config: config({ agentId: HOSTED_AGENT_ID }) })).toBeNull();
  });
});

describe('setup gate', () => {
  it('finishes only with both an image path and an agent', () => {
    expect(setupGate(null, null)).toMatchObject({ complete: false, missing: ['image', 'agent'] });
    expect(setupGate({ kind: 'codex' }, null)).toMatchObject({ complete: false, missing: ['agent'] });
    expect(setupGate(null, { kind: 'api' })).toMatchObject({ complete: false, missing: ['image'] });
    expect(setupGate({ kind: 'cloud' }, { kind: 'local', agentId: 'codex' })).toMatchObject({ complete: true, missing: [] });
  });
});

describe('returning users', () => {
  const done = setupGate({ kind: 'codex' }, { kind: 'local', agentId: 'codex' });

  it('never auto-finishes a first run, so the subscription is always offered once', () => {
    expect(returningSetupSatisfied({ account: null }, done)).toBe(false);
    expect(returningSetupSatisfied({}, done)).toBe(false);
  });

  it('auto-finishes an own-tools user whose tools still work', () => {
    expect(returningSetupSatisfied({ account: { mode: 'byok' } }, done)).toBe(true);
    expect(returningSetupSatisfied({ account: { mode: 'byok' } }, setupGate({ kind: 'codex' }, null))).toBe(false);
  });

  it('sends a subscriber who is signed out back through sign-in', () => {
    expect(returningSetupSatisfied({ account: { mode: 'cloud' } }, done)).toBe(false);
    expect(returningSetupSatisfied({ account: { mode: 'cloud' } }, setupGate({ kind: 'cloud' }, { kind: 'local', agentId: 'codex' }))).toBe(true);
    expect(returningSetupSatisfied({ account: { mode: 'cloud' } }, setupGate({ kind: 'codex' }, { kind: 'hosted', agentId: HOSTED_AGENT_ID }))).toBe(true);
  });

  it('an explicit re-run forgets the chosen path', () => {
    const rerun = prepareOnboardingRerun(config({ onboardingCompleted: true, account: { mode: 'byok' } }));
    expect(rerun).toMatchObject({ onboardingCompleted: false, account: null });
    expect(returningSetupSatisfied(rerun, done)).toBe(false);
  });
});

describe('plan tiers', () => {
  it('reads the tier from the SKU', () => {
    expect(planTier('plan_starter_monthly_v3')).toBe('starter');
    expect(planTier('plan_pro_monthly')).toBe('pro');
    expect(planTier('plan_studio_monthly')).toBe('studio');
    expect(planTier('topup_1000')).toBeNull();
    expect(planTier('plan_promo')).toBeNull();
  });
});

describe('home notice when no AI can build a game', () => {
  const missingCodex: AgentInfo = { ...codexAgent, available: false, authStatus: undefined };
  const base = { loading: false, cloudAvailable: true, agents: [missingCodex], config: config() };

  it('says nothing while facts load or once any agent is usable', () => {
    expect(noAgentNotice({ ...base, loading: true, cloud: SIGNED_OUT })).toBeNull();
    expect(noAgentNotice({ ...base, cloud: SIGNED_OUT, agents: [codexAgent] })).toBeNull();
    expect(noAgentNotice({ ...base, cloud: FUNDED, agents: [hostedAgent] })).toBeNull();
    expect(noAgentNotice({
      ...base,
      cloud: SIGNED_OUT,
      config: config({ mode: 'api', apiKey: 'sk-test', baseUrl: 'https://api.example.com', model: 'm' }),
    })).toBeNull();
  });

  it('puts the way out first: sign in, then buy credits, else own tools', () => {
    expect(noAgentNotice({ ...base, cloud: SIGNED_OUT })).toEqual({ kind: 'sign-in' });
    expect(noAgentNotice({ ...base, cloud: BROKE, agents: [missingCodex, hostedAgent] })).toEqual({ kind: 'buy-credits' });
    expect(noAgentNotice({ ...base, cloudAvailable: false, cloud: SIGNED_OUT })).toEqual({ kind: 'own-tools-only' });
    // A CLI that still needs its own sign-in cannot build anything yet.
    expect(noAgentNotice({ ...base, cloud: SIGNED_OUT, agents: [{ ...codexAgent, authStatus: 'missing' }] }))
      .toEqual({ kind: 'sign-in' });
  });

  it('stays quiet when credits are there but the hosted agent is not, since buying would not help', () => {
    expect(noAgentNotice({ ...base, cloud: FUNDED })).toBeNull();
  });
});
