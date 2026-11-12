import type { MediaProviderAvailability, OpenPixoCreditsSummary } from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';
import { findProvider, IMAGE_MODELS } from '../../media/models';
import { isStoredMediaProviderEntryPresent } from '../../state/config';
import type { AgentInfo, AppConfig, MediaProviderCredentials } from '../../types';
import { isVisibleLocalCliAgent } from '../../utils/visibleAgents';

/**
 * What first-run setup must end with: at least one way to make images and one
 * agent that can build the game. Everything here is a pure function over facts
 * the app already loads (account status, credits, daemon media config, agent
 * detection, app config), so the gate can be tested without rendering.
 */

/**
 * Agent id of the hosted, credit-paid agent (bundled OpenCode on the OpenPixo
 * gateway). Mirrors `OPENPIXO_AGENT_ID` from the hosted-agent contract, which
 * is not on every branch yet; switch to the contract export once it lands.
 */
export const HOSTED_AGENT_ID = 'openpixo-agent';

export type ImageSource =
  | { kind: 'cloud' }
  | { kind: 'codex' }
  | { kind: 'key'; providerId: string };

export type AgentSource =
  | { kind: 'hosted'; agentId: string }
  | { kind: 'local'; agentId: string }
  | { kind: 'api' };

export type SetupPiece = 'image' | 'agent';

/** Codex image generation as `/api/media/config` reports it; `null` while unknown. */
export type CodexImageStatus = MediaProviderAvailability | null;

export interface CloudFacts {
  signedIn: boolean;
  credits: Pick<OpenPixoCreditsSummary, 'available' | 'subscription'> | null;
}

/** Providers that can make images from a user's own key (not Codex, not OpenPixo). */
export const IMAGE_KEY_PROVIDER_IDS: readonly string[] = Array.from(new Set(
  IMAGE_MODELS.map((model) => model.provider)
    .filter((id) => id !== 'codex-cli' && id !== 'openpixo' && id !== 'stub')
    .filter((id) => {
      const provider = findProvider(id);
      return provider?.integrated === true && provider.credentialsRequired !== false;
    }),
));

/** A paid plan that is still granting credits, or credits left to spend. */
export function cloudCanSpend(cloud: CloudFacts): boolean {
  if (!cloud.signedIn || !cloud.credits) return false;
  const status = cloud.credits.subscription?.status;
  return cloud.credits.available > 0 || status === 'active' || status === 'past_due';
}

/**
 * The image path that works now. Own tools come first (they cost the user
 * nothing extra) unless the user is on the subscription path.
 */
export function readyImageSource(input: {
  cloud: CloudFacts;
  codexImage: CodexImageStatus;
  mediaProviders: Record<string, MediaProviderCredentials> | undefined;
  preferCloud?: boolean;
}): ImageSource | null {
  const cloud = cloudCanSpend(input.cloud);
  if (cloud && input.preferCloud) return { kind: 'cloud' };
  if (input.codexImage?.available === true) return { kind: 'codex' };
  const keyed = IMAGE_KEY_PROVIDER_IDS.find((id) => isStoredMediaProviderEntryPresent(input.mediaProviders?.[id]));
  if (keyed) return { kind: 'key', providerId: keyed };
  return cloud ? { kind: 'cloud' } : null;
}

/** An agent CLI that was found and is not waiting for its own sign-in. */
function usableLocalAgent(agent: AgentInfo): boolean {
  return agent.available && agent.authStatus !== 'missing'
    && isVisibleLocalCliAgent(agent) && agent.id !== HOSTED_AGENT_ID;
}

/** An API-key runtime with everything the connection test needs. */
export function apiRuntimeFilled(config: Pick<AppConfig, 'mode' | 'apiKey' | 'baseUrl' | 'model'>): boolean {
  return config.mode === 'api'
    && Boolean(config.apiKey.trim()) && Boolean(config.baseUrl.trim()) && Boolean(config.model.trim());
}

/**
 * The agent the app would run with. The saved choice wins when it is usable;
 * otherwise the hosted agent (signed in, able to pay), then a found CLI.
 */
export function readyAgentSource(input: {
  cloud: CloudFacts;
  agents: readonly AgentInfo[];
  config: Pick<AppConfig, 'mode' | 'agentId' | 'apiKey' | 'baseUrl' | 'model'>;
}): AgentSource | null {
  if (apiRuntimeFilled(input.config)) return { kind: 'api' };
  const hosted = cloudCanSpend(input.cloud)
    ? input.agents.find((agent) => agent.id === HOSTED_AGENT_ID && agent.available)
    : undefined;
  const local = input.agents.filter(usableLocalAgent);
  const saved = input.config.agentId;
  if (saved && hosted?.id === saved) return { kind: 'hosted', agentId: saved };
  const savedLocal = local.find((agent) => agent.id === saved);
  if (savedLocal) return { kind: 'local', agentId: savedLocal.id };
  if (hosted) return { kind: 'hosted', agentId: hosted.id };
  const preferred = local.find((agent) => agent.id === 'codex') ?? local[0];
  return preferred ? { kind: 'local', agentId: preferred.id } : null;
}

export interface SetupGate {
  image: ImageSource | null;
  agent: AgentSource | null;
  /** What still blocks finishing, in the order the guide asks for it. */
  missing: SetupPiece[];
  complete: boolean;
}

export function setupGate(image: ImageSource | null, agent: AgentSource | null): SetupGate {
  const missing: SetupPiece[] = [];
  if (!image) missing.push('image');
  if (!agent) missing.push('agent');
  return { image, agent, missing, complete: missing.length === 0 };
}

/**
 * Whether first run may finish itself without showing anything: the user
 * already chose a path on an earlier run (the saved `account` preference,
 * cleared by an explicit re-run) and that path still has both pieces ready.
 * A brand-new install always sees the welcome, so the subscription offer is
 * never skipped just because a developer machine happens to have Codex.
 */
export function returningSetupSatisfied(
  config: Pick<AppConfig, 'account'>,
  gate: SetupGate,
): boolean {
  const path = config.account?.mode;
  if (path !== 'cloud' && path !== 'byok') return false;
  if (!gate.complete) return false;
  // A cloud user who is signed out must sign in again before going on.
  return path === 'byok' || gate.image?.kind === 'cloud' || gate.agent?.kind === 'hosted';
}

/** Config for an explicit "run setup again": forget the chosen path so nothing auto-finishes. */
export function prepareOnboardingRerun<T extends Pick<AppConfig, 'onboardingCompleted' | 'account'>>(config: T): T {
  return { ...config, onboardingCompleted: false, account: null };
}

/** Plan tier names come from the SKU (`plan_starter_monthly_v3` → `starter`). */
export type PlanTier = 'starter' | 'pro' | 'studio';

/** Display name of each tier; onboarding and Settings must read the same. */
export const PLAN_TIER_NAMES: Record<PlanTier, keyof Dict> = {
  starter: 'onboarding.planStarter',
  pro: 'onboarding.planPro',
  studio: 'onboarding.planStudio',
};

export function planTier(sku: string): PlanTier | null {
  const match = /^plan_(starter|pro|studio)(?:_|$)/.exec(sku);
  return match ? (match[1] as PlanTier) : null;
}

/** What the Home page says when nothing can build a game yet. */
export type NoAgentNotice =
  /** The cloud account is offered and the user is signed out. */
  | { kind: 'sign-in' }
  /** Signed in, but no credits and no active plan. */
  | { kind: 'buy-credits' }
  /** No cloud account in this build: only the user's own tools can work. */
  | { kind: 'own-tools-only' };

/**
 * Whether Home must say that no AI can build a game yet, and which way out to
 * put first. A first-time tester skipped every setup step, reached Home, and
 * found an empty model picker with no word on why or what to do.
 *
 * Stays silent while any fact is still loading, so it never flashes during
 * detection, and whenever `readyAgentSource` finds an agent.
 */
export function noAgentNotice(input: {
  loading: boolean;
  cloudAvailable: boolean;
  cloud: CloudFacts;
  agents: readonly AgentInfo[];
  config: Pick<AppConfig, 'mode' | 'agentId' | 'apiKey' | 'baseUrl' | 'model'>;
}): NoAgentNotice | null {
  if (input.loading) return null;
  if (readyAgentSource({ cloud: input.cloud, agents: input.agents, config: input.config })) return null;
  // Credits are there but the hosted agent is not: that is a broken install, not
  // a setup step the user skipped, and buying or signing in would not fix it.
  if (cloudCanSpend(input.cloud)) return null;
  if (!input.cloudAvailable) return { kind: 'own-tools-only' };
  return input.cloud.signedIn ? { kind: 'buy-credits' } : { kind: 'sign-in' };
}
