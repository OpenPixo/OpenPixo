// Agent setup embedded in the BYOK path of first-run onboarding.
//
// Verification is honest and optional where that is safe:
//   * Proving a runtime spends one real model call, so the cost is said up
//     front, the wait shows elapsed time, and it can be cancelled.
//   * A detected local agent may continue unverified: detection already proved
//     the binary exists, the check is the slow part (a full agent spawn, often
//     10 s+), and a broken sign-in surfaces on the first real run with the same
//     guidance the chat shows for any failed run.
//   * A BYOK key may only continue unverified after a check failed for a reason
//     that does not prove the key or model wrong (rate limit, timeout, provider
//     outage). Typed credentials are the common failure, and the check is a
//     single cheap request, so an unproven key never finishes onboarding by
//     default.

import { useEffect, useId, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import { Button } from '@openpixo/components';
import { agentInstallPrompt, nativeCodexProviderForConfig } from '@openpixo/contracts';
import type {
  TrackingCliProviderId,
  TrackingOnboardingArea,
  TrackingOnboardingClickAction,
  TrackingOnboardingClickElement,
  TrackingOnboardingCompletionResult,
  TrackingOnboardingCompletionType,
  TrackingOnboardingRuntimeType,
  TrackingOnboardingStepIndex,
  TrackingOnboardingStepName,
} from '@openpixo/contracts/analytics';
import { agentIdToTracking } from '@openpixo/contracts/analytics';
import { useAnalytics } from '../../analytics/provider';
import {
  trackOnboardingClick,
  trackOnboardingCompleteResult,
  trackOnboardingRuntimeScanResult,
  trackPageView,
} from '../../analytics/events';
import {
  clearOnboardingSessionId,
  getOrCreateOnboardingSessionId,
} from '../../analytics/onboarding-session';
import { useI18n, useT } from '../../i18n';
import { copyToClipboard } from '../../lib/copy-to-clipboard';
import { testAgent, testApiProvider } from '../../providers/connection-test';
import { fetchProviderModels } from '../../providers/provider-models';
import { openExternalUrl } from '../../providers/registry';
import {
  API_KEY_PLACEHOLDERS,
  API_PROTOCOL_TABS,
  SUGGESTED_MODELS_BY_PROTOCOL,
} from '../../state/apiProtocols';
import { defaultKnownProviderModel, KNOWN_PROVIDERS } from '../../state/config';
import type { KnownProvider } from '../../state/config';
import type {
  AgentInfo,
  ApiProtocol,
  ApiProtocolConfig,
  AppConfig,
  ConnectionTestResponse,
  ExecMode,
  ProviderModelOption,
  ProviderModelsResponse,
} from '../../types';
import { isVisibleLocalCliAgent } from '../../utils/visibleAgents';
import { AgentIcon } from '../AgentIcon';
import { defaultAgentModelId } from '../agentModelSelection';
import { resolveByokModelPreference } from '../byok/validation';
import { Icon } from '../Icon';
import { providerModelsCacheKey, type ProviderModelsCache } from '../providerModelsCache';
import { switchApiProtocolConfig } from '../api-protocol-config';
import { agentSetupGuide, missingAgentGuides } from './agentSetupGuide';
import { agentKeyConsole } from './key-guides';
import { OnboardingDropdown } from './OnboardingDropdown';
import styles from './Onboarding.module.css';
import setupStyles from './Setup.module.css';

// Agent and provider validation share one shape: idle until an attempt starts,
// then keyed by the inputs that attempt is proving, so a result that no longer
// describes the current selection can be told apart from one that does.
type OnboardingRuntimeTestState =
  | { status: 'idle' }
  | { status: 'running'; inputKey: string }
  | { status: 'done'; inputKey: string; result: ConnectionTestResponse };

const ONBOARDING_BYOK_AUTO_FETCH_DELAY_MS = 300;
// Window used by regression tests to prove that setup performs no implicit model validation.
export const ONBOARDING_LOCAL_AUTO_TEST_DELAY_MS = 500;
// After this long a waiting check says why agents can be slow, instead of
// leaving the user to wonder whether anything is happening.
const VERIFY_SLOW_HINT_AFTER_S = 12;

type OnboardingInlineTestRun = {
  inputKey: string;
  controller: AbortController;
  promise: Promise<ConnectionTestResponse | null>;
};

type Runtime = 'local' | 'byok';

/**
 * Start `run` for `inputKey`, or hand back the attempt already validating
 * exactly those inputs.
 *
 * A Continue click that lands while a check for the same inputs is in flight
 * joins it rather than spawning the agent a second time.
 *
 * An attempt whose inputs the user has already moved past can only produce a
 * result that gets discarded (see `continueAttemptStillCurrent`), so it is
 * aborted instead of being left to hold the runtime and race the replacement's
 * state writes. The daemon cancels the connection test with the request.
 */
function startOrJoinInlineTest(
  ref: MutableRefObject<OnboardingInlineTestRun | null>,
  inputKey: string,
  run: (signal: AbortSignal) => Promise<ConnectionTestResponse | null>,
): Promise<ConnectionTestResponse | null> {
  const current = ref.current;
  if (current?.inputKey === inputKey) return current.promise;
  current?.controller.abort();
  const controller = new AbortController();
  const promise = run(controller.signal).finally(() => {
    if (ref.current?.controller === controller) ref.current = null;
  });
  ref.current = { inputKey, controller, promise };
  return promise;
}

/** Whole seconds since `active` last became true; 0 while inactive. */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return seconds;
}

/**
 * Failures that say nothing about whether the key or model is wrong — the
 * provider was busy or slow. Only these let a BYOK setup finish unverified.
 */
function byokFailureAllowsSkip(result: ConnectionTestResponse | null): boolean {
  if (!result || result.ok) return false;
  return (
    result.kind === 'rate_limited'
    || result.kind === 'timeout'
    || result.kind === 'upstream_unavailable'
  );
}

export interface AgentSetupProps {
  config: AppConfig;
  providerModelsCache?: ProviderModelsCache;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<ProviderModelsCache>>;
  agents: AgentInfo[];
  agentsLoading?: boolean;
  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiProtocolChange: (protocol: ApiProtocol) => void;
  onApiModelChange: (model: string) => void;
  onConfigPersist: (cfg: AppConfig) => Promise<void> | void;
  onRefreshAgents: () => Promise<AgentInfo[]> | AgentInfo[];
  onFinish: (verified: boolean) => void;
}

export function AgentSetup({
  config,
  providerModelsCache: sharedProviderModelsCache,
  onProviderModelsCacheChange,
  agents,
  agentsLoading = false,
  daemonLive,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onApiProtocolChange,
  onApiModelChange,
  onConfigPersist,
  onRefreshAgents,
  onFinish,
}: AgentSetupProps) {
  const t = useT();
  const analytics = useAnalytics();

  const [runtime, setRuntime] = useState<Runtime>(config.mode === 'api' ? 'byok' : 'local');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [cliScanStatus, setCliScanStatus] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [visibleAgentIds, setVisibleAgentIds] = useState<string[]>([]);
  const [providerTestState, setProviderTestState] =
    useState<OnboardingRuntimeTestState>({ status: 'idle' });
  const [agentTestState, setAgentTestState] = useState<OnboardingRuntimeTestState>({
    status: 'idle',
  });
  // True only while a Continue click is itself waiting on validation.
  const [continuePending, setContinuePending] = useState(false);
  const [providerModelsState, setProviderModelsState] = useState<
    | { status: 'idle' }
    | { status: 'running'; inputKey: string }
    | { status: 'done'; inputKey: string; result: ProviderModelsResponse }
  >({ status: 'idle' });
  const [localProviderModelsCache, setLocalProviderModelsCache] =
    useState<ProviderModelsCache>({});
  const hasSharedProviderModelsCache =
    Boolean(sharedProviderModelsCache) && Boolean(onProviderModelsCacheChange);
  const activeProviderModelsCache =
    hasSharedProviderModelsCache
      ? sharedProviderModelsCache!
      : localProviderModelsCache;
  const activeSetProviderModelsCache =
    hasSharedProviderModelsCache
      ? onProviderModelsCacheChange!
      : setLocalProviderModelsCache;
  const agentRevealTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const cliScanTokenRef = useRef(0);
  const cliScanTelemetryRef = useRef<{
    token: number;
    startedAt: number;
    onboardingSessionId: string;
  } | null>(null);
  const cliRefreshPendingTokenRef = useRef<number | null>(null);
  const providerModelsAutoFetchKeyRef = useRef<string | null>(null);
  const agentTestRunRef = useRef<OnboardingInlineTestRun | null>(null);
  const providerTestRunRef = useRef<OnboardingInlineTestRun | null>(null);
  // Whether the BYOK model on screen is one the USER chose. A model that only
  // arrived as a default (the app's initial config, or a provider preset) is
  // replaced by one the account actually lists once the list is fetched.
  const byokModelChosenByUserRef = useRef(false);
  const providerModelAutoSelectRef = useRef({
    model: config.model,
    providerModelsInputKey: '',
    runtime,
  });
  const apiProtocol = config.apiProtocol ?? 'anthropic';
  const providerTestInputKey = [
    apiProtocol,
    config.baseUrl.trim(),
    config.model.trim(),
    config.apiKey.trim(),
    config.apiVersion?.trim() ?? '',
  ].join('\n');
  const providerModelsInputKey = providerModelsCacheKey(
    apiProtocol,
    config.baseUrl,
    config.apiKey,
    config.apiVersion ?? '',
  );
  providerModelAutoSelectRef.current = {
    model: config.model,
    providerModelsInputKey,
    runtime,
  };
  const canTestProvider =
    Boolean(config.apiKey.trim()) &&
    Boolean(config.baseUrl.trim()) &&
    Boolean(config.model.trim());
  const canFetchProviderModels =
    apiProtocol !== 'azure' &&
    apiProtocol !== 'ollama' &&
    Boolean(config.apiKey.trim()) &&
    Boolean(config.baseUrl.trim()) &&
    isLikelyHttpUrl(config.baseUrl);
  const visibleProviderTestState =
    providerTestState.status !== 'idle' &&
    providerTestState.inputKey === providerTestInputKey
      ? providerTestState
      : { status: 'idle' as const };
  const visibleProviderModelsState =
    providerModelsState.status !== 'idle' &&
    providerModelsState.inputKey === providerModelsInputKey
      ? providerModelsState
      : { status: 'idle' as const };
  const selectedProvider = KNOWN_PROVIDERS.find(
    (provider) =>
      provider.protocol === apiProtocol &&
      (
        provider.baseUrl === (config.apiProviderBaseUrl ?? config.baseUrl) ||
        (apiProtocol === 'azure' && provider.baseUrl === '' && Boolean(config.baseUrl?.trim()))
      ),
  ) ?? null;
  const candidateCliAgents = agents.filter(
    (agent) => agent.available && isVisibleLocalCliAgent(agent),
  );
  const visibleAgents = candidateCliAgents.filter((agent) => visibleAgentIds.includes(agent.id));
  const selectedAgent = visibleAgents.find((agent) => agent.id === config.agentId) ?? null;
  const selectedAgentChoice = selectedAgent ? (config.agentModels?.[selectedAgent.id] ?? {}) : {};
  const selectedAgentTestModel = selectedAgentChoice.model ?? defaultAgentModelId(selectedAgent) ?? '';
  const selectedAgentTestReasoning = selectedAgentChoice.reasoning ?? '';
  const agentTestInputKey = [
    selectedAgent?.id ?? '',
    selectedAgentTestModel,
    selectedAgentTestReasoning,
    JSON.stringify(config.agentCliEnv ?? {}),
  ].join('\n');
  const visibleAgentTestState =
    agentTestState.status === 'running' ||
    (agentTestState.status !== 'idle' && agentTestState.inputKey === agentTestInputKey)
      ? agentTestState
      : { status: 'idle' as const };
  const canTestAgent = Boolean(selectedAgent) && daemonLive;
  const localRuntimeConfigured = selectedAgent?.available === true;
  const nativeByokProvider = nativeCodexProviderForConfig({ protocol: apiProtocol, baseUrl: config.baseUrl });
  const nativeByokCodexMissing = nativeByokProvider !== null
    && !agents.some((agent) => agent.id === 'codex' && agent.available);
  const byokRuntimeConfigured = canTestProvider && !nativeByokCodexMissing;
  const connectStepRuntimeReady =
    (runtime === 'local' && localRuntimeConfigured) ||
    (runtime === 'byok' && byokRuntimeConfigured);
  const connectStepBlocked = !connectStepRuntimeReady;
  const activeTestState = runtime === 'local' ? visibleAgentTestState : visibleProviderTestState;
  const verifying = activeTestState.status === 'running';
  const verifyElapsed = useElapsedSeconds(verifying);
  const lastFailure =
    activeTestState.status === 'done' && !activeTestState.result.ok
      ? activeTestState.result
      : null;
  const canContinueUnverified =
    !connectStepBlocked
    && (runtime === 'local' || byokFailureAllowsSkip(lastFailure));
  // What the user is looking at RIGHT NOW. `handlePrimaryAction` awaits a
  // validation round trip before it persists anything, and its closure is
  // frozen at click time — so the continuation cannot ask this question of its
  // own variables. See `continueAttemptStillCurrent`.
  const onboardingIntentRef = useRef({ runtime, agentTestInputKey, providerTestInputKey });
  onboardingIntentRef.current = { runtime, agentTestInputKey, providerTestInputKey };

  const connectGateTooltip = !connectStepBlocked
    ? null
    : runtime === 'local'
      ? t('settings.onboardingGateTooltipLocal')
      : t('settings.onboardingGateTooltipByok');

  useEffect(() => {
    return () => {
      agentRevealTimersRef.current.forEach((timer) => clearTimeout(timer));
      agentRevealTimersRef.current = [];
    };
  }, []);

  // Agents show in the one list whichever row is selected, so reveal them on
  // the API-key row too.
  useEffect(() => {
    const scanToken = cliScanTokenRef.current;
    if (cliRefreshPendingTokenRef.current === scanToken) return;
    const currentAvailableAgents = agents.filter(
      (agent) => agent.available && isVisibleLocalCliAgent(agent),
    );
    if (currentAvailableAgents.length > 0) {
      const selectedCliAgent = selectDefaultCliAgent(currentAvailableAgents);
      showCliAgents(scanToken, currentAvailableAgents, { stagger: false });
      setCliScanStatus('done');
      emitPendingCliScanResult(scanToken, {
        result: 'success',
        detected: agents.length,
        available: currentAvailableAgents.length,
        selectedCliId: selectedCliAgent ? agentIdToTracking(selectedCliAgent.id) : undefined,
      });
      return;
    }
    if (!agentsLoading && cliScanStatus !== 'done') {
      setCliScanStatus('done');
      emitPendingCliScanResult(scanToken, {
        result: 'failed',
        detected: agents.length,
        available: 0,
        errorCode: 'NO_AVAILABLE_CLI',
      });
    }
  }, [agents, agentsLoading, cliScanStatus, config.agentId, runtime]);

  // Onboarding step exposure. We do NOT clear the session on unmount: route
  // changes can remount the shell during first-run setup. Completion clears
  // inline; abandoned sessions clear on sessionStorage tab close.
  const onboardingSessionIdRef = useRef<string>('');
  if (!onboardingSessionIdRef.current && config.onboardingCompleted !== true) {
    onboardingSessionIdRef.current = getOrCreateOnboardingSessionId();
  }
  useEffect(() => {
    const onboardingSessionId = onboardingSessionIdRef.current;
    if (!onboardingSessionId) return;
    const info = stepInfo();
    trackPageView(analytics.track, {
      page_name: 'onboarding',
      area: info.area,
      step_index: info.stepIndex,
      step_name: info.stepName,
      onboarding_session_id: onboardingSessionId,
    });
  }, [analytics.track]);

  const onboardingStartedAtRef = useRef<number>(Date.now());
  const lifecycleReportedRef = useRef(false);
  function currentRuntimeType(): TrackingOnboardingRuntimeType {
    return runtime === 'local' ? 'local_cli' : 'byok';
  }
  function stepInfo(): {
    area: TrackingOnboardingArea;
    stepIndex: TrackingOnboardingStepIndex;
    stepName: TrackingOnboardingStepName;
  } {
    return { area: 'runtime_setup', stepIndex: '3', stepName: 'runtime_setup' };
  }
  function emitOnboardingClick(
    element: TrackingOnboardingClickElement,
    action: TrackingOnboardingClickAction,
    extra: Partial<Omit<
      Parameters<typeof trackOnboardingClick>[1],
      'page_name' | 'area' | 'element' | 'action' | 'step_index' | 'step_name' | 'onboarding_session_id'
    >> = {},
  ): void {
    const onboardingSessionId = onboardingSessionIdRef.current;
    if (!onboardingSessionId) return;
    const info = stepInfo();
    trackOnboardingClick(analytics.track, {
      page_name: 'onboarding',
      area: info.area,
      element,
      action,
      step_index: info.stepIndex,
      step_name: info.stepName,
      onboarding_session_id: onboardingSessionId,
      ...extra,
    });
  }
  function emitOnboardingComplete(
    result: TrackingOnboardingCompletionResult,
    completionType: TrackingOnboardingCompletionType,
    extra: { errorCode?: string; runtimeType?: TrackingOnboardingRuntimeType } = {},
  ): void {
    if (lifecycleReportedRef.current) return;
    const onboardingSessionId = onboardingSessionIdRef.current;
    if (!onboardingSessionId) return;
    lifecycleReportedRef.current = true;
    const info = stepInfo();
    trackOnboardingCompleteResult(analytics.track, {
      page_name: 'onboarding',
      area: 'onboarding',
      result,
      exit_step_name: info.stepName,
      completion_type: completionType,
      runtime_type: extra.runtimeType ?? currentRuntimeType(),
      has_about_you: false,
      has_design_system_request: false,
      source_count: 0,
      ...(extra.errorCode ? { error_code: extra.errorCode } : {}),
      duration_ms: Math.max(0, Date.now() - onboardingStartedAtRef.current),
      onboarding_session_id: onboardingSessionId,
    });
  }

  // One provider list across every protocol: choosing a provider picks its
  // protocol too, so a first-time user never has to know what a protocol is.
  const byokProviderOptions = [
    ...KNOWN_PROVIDERS.map((provider) => ({
      value: byokProviderValue(provider),
      label: provider.label,
    })),
    { value: CUSTOM_BYOK_PROVIDER, label: t('settings.customProvider') },
  ];
  const byokOpenCodeMissing = runtime === 'byok' && daemonLive && !agentsLoading
    && nativeByokProvider === null
    && !agents.some((agent) => agent.id === 'opencode' && agent.available);
  const agentModelOptions =
    selectedAgent?.models?.map((model) => ({
      value: model.id,
      label: model.label ?? model.id,
    })) ?? [];
  const fetchedProviderModels =
    activeProviderModelsCache[providerModelsInputKey] ?? [];
  const byokModelOptions = mergeOnboardingProviderModelOptions(
    fetchedProviderModels,
    selectedProvider?.preferredModels.length
      ? selectedProvider.preferredModels
      : SUGGESTED_MODELS_BY_PROTOCOL[apiProtocol],
    config.model,
  ).map((model) => ({
    value: model.id,
    label: onboardingProviderModelLabel(model),
  }));

  /** Patches the active protocol's settings; `base` lets a protocol switch and its preset land in one save. */
  function updateApiConfig(patch: Partial<ApiProtocolConfig>, base: AppConfig = config) {
    const protocol = base.apiProtocol ?? 'anthropic';
    const currentConfig: ApiProtocolConfig = {
      apiKey: base.apiKey,
      baseUrl: base.baseUrl,
      model: base.model,
      apiVersion: base.apiVersion ?? '',
      apiProviderBaseUrl: base.apiProviderBaseUrl ?? null,
    };
    const nextProtocolConfig: ApiProtocolConfig = { ...currentConfig, ...patch };
    const nextConfig: AppConfig = {
      ...base,
      mode: 'api',
      apiProtocol: protocol,
      apiKey: nextProtocolConfig.apiKey,
      baseUrl: nextProtocolConfig.baseUrl,
      model: nextProtocolConfig.model,
      apiVersion: protocol === 'azure' ? (nextProtocolConfig.apiVersion ?? '') : '',
      apiProviderBaseUrl: nextProtocolConfig.apiProviderBaseUrl ?? null,
      apiProtocolConfigs: {
        ...(base.apiProtocolConfigs ?? {}),
        [protocol]: nextProtocolConfig,
      },
    };
    void onConfigPersist(nextConfig);
  }

  function chooseByokProvider(value: string) {
    byokModelChosenByUserRef.current = false;
    if (value === CUSTOM_BYOK_PROVIDER) {
      updateApiConfig({ baseUrl: '', apiProviderBaseUrl: null });
      return;
    }
    const provider = KNOWN_PROVIDERS.find((item) => byokProviderValue(item) === value);
    if (!provider) return;
    const base = provider.protocol === apiProtocol ? config : switchApiProtocolConfig(config, provider.protocol);
    updateApiConfig({
      baseUrl: provider.baseUrl,
      model: defaultKnownProviderModel(provider),
      apiProviderBaseUrl: provider.baseUrl,
    }, base);
  }

  /**
   * Once the account's model list is known, make sure the model on screen is
   * one the account can actually use — unless the user picked it themselves.
   * A default that came from the app's initial config or a provider preset is
   * swapped for the provider's preferred model among those the account lists.
   */
  function reconcileProviderModelWithAccount(
    models: readonly ProviderModelOption[],
    expectedInputKey: string,
  ) {
    const current = providerModelAutoSelectRef.current;
    if (current.runtime !== 'byok' || current.providerModelsInputKey !== expectedInputKey) return;
    const currentModel = current.model.trim();
    if (currentModel && byokModelChosenByUserRef.current) return;
    if (
      currentModel
      && models.some((model) => model.enabled !== false && model.id.trim() === currentModel)
    ) {
      return;
    }
    const preference = resolveByokModelPreference({
      currentModel: '',
      accountModels: models,
      providerPreferredModels: selectedProvider?.preferredModels ?? [],
    });
    if (!preference.model || preference.model === currentModel) return;
    onApiModelChange(preference.model);
    updateApiConfig({ model: preference.model });
  }

  function clearAgentRevealTimers() {
    agentRevealTimersRef.current.forEach((timer) => clearTimeout(timer));
    agentRevealTimersRef.current = [];
  }

  /**
   * Undo whichever runtime validation is still in flight.
   *
   * Proving a local runtime spawns a real agent CLI, and left alone that child
   * occupies the daemon until its own timeout — so a check nobody will consume
   * (the user cancelled, switched runtime or left) is aborted, which hands the
   * child back immediately. An aborted run writes no result, so its `running`
   * state is reset here. A finished run is left alone: its result is still the
   * truth about the current selection.
   */
  function abortRuntimeValidations(): void {
    if (agentTestRunRef.current) {
      agentTestRunRef.current.controller.abort();
      agentTestRunRef.current = null;
      setAgentTestState((current) => (current.status === 'running' ? { status: 'idle' } : current));
    }
    if (providerTestRunRef.current) {
      providerTestRunRef.current.controller.abort();
      providerTestRunRef.current = null;
      setProviderTestState((current) => (
        current.status === 'running' ? { status: 'idle' } : current
      ));
    }
  }

  function selectDefaultCliAgent(availableAgents: AgentInfo[]): AgentInfo | null {
    const nextAgent =
      availableAgents.find((agent) => agent.id === config.agentId)
      ?? availableAgents.find((agent) => agent.id === 'codex')
      ?? availableAgents[0] ?? null;
    if (!nextAgent) return null;
    if (nextAgent.id !== config.agentId) {
      onAgentChange(nextAgent.id);
    }
    return nextAgent;
  }

  function emitPendingCliScanResult(
    token: number,
    args: {
      result: 'success' | 'failed';
      detected: number;
      available: number;
      selectedCliId?: TrackingCliProviderId;
      errorCode?: string;
    },
  ): void {
    const telemetry = cliScanTelemetryRef.current;
    if (!telemetry || telemetry.token !== token) return;
    cliScanTelemetryRef.current = null;
    trackOnboardingRuntimeScanResult(analytics.track, {
      page_name: 'onboarding',
      area: 'runtime',
      runtime_type: 'local_cli',
      result: args.result,
      detected_cli_count: args.detected,
      available_cli_count: args.available,
      ...(args.selectedCliId ? { selected_cli_id: args.selectedCliId } : {}),
      ...(args.errorCode ? { error_code: args.errorCode } : {}),
      duration_ms: Math.max(0, Date.now() - telemetry.startedAt),
      onboarding_session_id: telemetry.onboardingSessionId,
    });
  }

  function beginCliScan(): number {
    const scanToken = cliScanTokenRef.current + 1;
    cliScanTokenRef.current = scanToken;
    clearAgentRevealTimers();
    setRuntime('local');
    onModeChange('daemon');
    setCliScanStatus('scanning');
    setVisibleAgentIds([]);
    const onboardingSessionId = onboardingSessionIdRef.current;
    cliScanTelemetryRef.current = onboardingSessionId
      ? { token: scanToken, startedAt: Date.now(), onboardingSessionId }
      : null;
    return scanToken;
  }

  function showCliAgents(
    token: number,
    availableAgents: AgentInfo[],
    options: { stagger: boolean },
  ): void {
    if (!options.stagger) {
      const nextIds = availableAgents.map((agent) => agent.id);
      setVisibleAgentIds((current) =>
        current.length === nextIds.length && current.every((id, index) => id === nextIds[index])
          ? current
          : nextIds,
      );
      return;
    }
    availableAgents.forEach((agent, index) => {
      const timer = setTimeout(() => {
        if (cliScanTokenRef.current !== token) return;
        setVisibleAgentIds((current) =>
          current.includes(agent.id) ? current : [...current, agent.id],
        );
        if (index === availableAgents.length - 1) {
          setCliScanStatus('done');
        }
      }, 110 * (index + 1));
      agentRevealTimersRef.current.push(timer);
    });
  }

  function completeOnboarding(runtimeType: TrackingOnboardingRuntimeType, verified: boolean): void {
    emitOnboardingComplete('completed', 'completed_without_design_system', { runtimeType });
    clearOnboardingSessionId();
    onFinish(verified);
  }

  /**
   * Whether the Continue attempt that started against `startedInputKey` still
   * describes what the user is looking at.
   *
   * A validation round trip can outlive the intent that started it: the inputs
   * stay editable while the check is in flight. Persisting a late result
   * regardless would write a configuration the user already walked away from
   * and finish onboarding under them — so the attempt must still be on the
   * same runtime, against the same inputs it validated.
   */
  function continueAttemptStillCurrent(startedRuntime: Runtime, startedInputKey: string): boolean {
    const now = onboardingIntentRef.current;
    if (now.runtime !== startedRuntime) return false;
    return startedRuntime === 'local'
      ? now.agentTestInputKey === startedInputKey
      : now.providerTestInputKey === startedInputKey;
  }

  function settledRuntimeValidation(
    state: OnboardingRuntimeTestState,
  ): ConnectionTestResponse | null {
    return state.status === 'done' && state.result.ok ? state.result : null;
  }

  async function awaitRuntimeValidation(
    validate: () => Promise<ConnectionTestResponse | null>,
  ): Promise<ConnectionTestResponse | null> {
    setContinuePending(true);
    try {
      return await validate();
    } finally {
      setContinuePending(false);
    }
  }

  async function persistAndFinish(runtimeToFinish: Runtime, element: TrackingOnboardingClickElement) {
    if (runtimeToFinish === 'local' && selectedAgent) {
      await onConfigPersist({ ...config, mode: 'daemon', agentId: selectedAgent.id });
      emitOnboardingClick(element, 'continue', { runtime_type: 'local_cli' });
      completeOnboarding('local_cli', element === 'continue');
      return;
    }
    if (runtimeToFinish === 'byok') {
      await onConfigPersist({ ...config, mode: 'api' });
      emitOnboardingClick(element, 'continue', { runtime_type: 'byok' });
      completeOnboarding('byok', element === 'continue');
    }
  }

  async function handleVerifyAndContinue() {
    if (connectStepBlocked || continuePending) return;
    if (runtime === 'local' && selectedAgent) {
      const startedInputKey = agentTestInputKey;
      const testResult =
        settledRuntimeValidation(visibleAgentTestState)
        ?? (await awaitRuntimeValidation(testAgentInline));
      if (!testResult?.ok) return;
      if (!continueAttemptStillCurrent('local', startedInputKey)) return;
      await persistAndFinish('local', 'continue');
      return;
    }
    if (runtime === 'byok') {
      const startedInputKey = providerTestInputKey;
      const testResult =
        settledRuntimeValidation(visibleProviderTestState)
        ?? (await awaitRuntimeValidation(testProviderInline));
      if (!testResult?.ok) return;
      if (!continueAttemptStillCurrent('byok', startedInputKey)) return;
      await persistAndFinish('byok', 'continue');
    }
  }

  async function handleContinueUnverified() {
    if (!canContinueUnverified) return;
    // A check still in flight has no consumer once the user moves on.
    abortRuntimeValidations();
    await persistAndFinish(runtime, 'continue_unverified');
  }

  function chooseRuntime(next: Runtime) {
    if (next === runtime) return;
    emitOnboardingClick(next === 'local' ? 'local_coding_agent' : 'byok', 'select_runtime', {
      runtime_type: next === 'local' ? 'local_cli' : 'byok',
      is_recommended: next === 'local' && candidateCliAgents.length > 0,
    });
    setRuntime(next);
  }

  async function scanCliAgents() {
    const scanToken = beginCliScan();
    cliRefreshPendingTokenRef.current = scanToken;
    try {
      const nextAgents = await onRefreshAgents();
      if (cliScanTokenRef.current !== scanToken) return;
      cliRefreshPendingTokenRef.current = null;
      const availableAgents = nextAgents.filter(
        (agent) => agent.available && isVisibleLocalCliAgent(agent),
      );
      const selectedCliAgent = selectDefaultCliAgent(availableAgents);
      // Zero available CLIs is a `failed` scan: the runtime path is blocked,
      // even though detection itself returned. `detected_cli_count` keeps the
      // raw catalogue so "nothing installed" stays apart from "detect crashed".
      if (availableAgents.length === 0) {
        setCliScanStatus('done');
        emitPendingCliScanResult(scanToken, {
          result: 'failed',
          detected: nextAgents.length,
          available: 0,
          errorCode: 'NO_AVAILABLE_CLI',
        });
        return;
      }
      emitPendingCliScanResult(scanToken, {
        result: 'success',
        detected: nextAgents.length,
        available: availableAgents.length,
        ...(selectedCliAgent ? { selectedCliId: agentIdToTracking(selectedCliAgent.id) } : {}),
      });
      showCliAgents(scanToken, availableAgents, { stagger: true });
    } catch (err) {
      if (cliScanTokenRef.current === scanToken) {
        cliRefreshPendingTokenRef.current = null;
        setCliScanStatus('done');
        emitPendingCliScanResult(scanToken, {
          result: 'failed',
          detected: 0,
          available: 0,
          errorCode: err instanceof Error ? err.message : 'AGENT_REFRESH_THREW',
        });
      }
    }
  }

  function testProviderInline(): Promise<ConnectionTestResponse | null> {
    if (!canTestProvider) return Promise.resolve(null);
    const inputKey = providerTestInputKey;
    const protocol = apiProtocol;
    const baseUrl = config.baseUrl;
    const apiKey = config.apiKey;
    const model = config.model;
    const apiVersion =
      protocol === 'azure' ? config.apiVersion?.trim() || undefined : undefined;
    return startOrJoinInlineTest(providerTestRunRef, inputKey, async (signal) => {
      setProviderTestState({ status: 'running', inputKey });
      try {
        const result = await testApiProvider(
          { protocol, baseUrl, apiKey, model, apiVersion },
          signal,
        );
        if (signal.aborted) return null;
        setProviderTestState({ status: 'done', inputKey, result });
        return result;
      } catch (error) {
        // A superseded or cancelled attempt leaves the state to whoever ended it.
        if (signal.aborted) return null;
        const result: ConnectionTestResponse = {
          ok: false,
          kind: 'unknown',
          latencyMs: 0,
          model,
          detail: error instanceof Error ? error.message : 'Test request failed',
        };
        setProviderTestState({ status: 'done', inputKey, result });
        return result;
      }
    });
  }

  function testAgentInline(): Promise<ConnectionTestResponse | null> {
    if (!selectedAgent || !canTestAgent) return Promise.resolve(null);
    const inputKey = agentTestInputKey;
    const agent = selectedAgent;
    const model = selectedAgentTestModel;
    const reasoning = selectedAgentTestReasoning;
    const agentCliEnv = config.agentCliEnv ?? {};
    return startOrJoinInlineTest(agentTestRunRef, inputKey, async (signal) => {
      setAgentTestState({ status: 'running', inputKey });
      try {
        const result = await testAgent(
          {
            agentId: agent.id,
            model: model || undefined,
            reasoning: reasoning || undefined,
            agentCliEnv,
          },
          signal,
        );
        if (signal.aborted) return null;
        setAgentTestState({ status: 'done', inputKey, result });
        return result;
      } catch (error) {
        if (signal.aborted) return null;
        const result: ConnectionTestResponse = {
          ok: false,
          kind: 'unknown',
          latencyMs: 0,
          model: model || 'default',
          agentName: agent.name,
          detail: error instanceof Error ? error.message : 'Test request failed',
        };
        setAgentTestState({ status: 'done', inputKey, result });
        return result;
      }
    });
  }

  async function fetchProviderModelsInline() {
    if (!canFetchProviderModels || providerModelsState.status === 'running') return;
    const inputKey = providerModelsInputKey;
    providerModelsAutoFetchKeyRef.current = inputKey;
    const cachedModels = activeProviderModelsCache[inputKey];
    if (cachedModels) {
      reconcileProviderModelWithAccount(cachedModels, inputKey);
      setProviderModelsState({
        status: 'done',
        inputKey,
        result: { ok: true, kind: 'success', latencyMs: 0, models: cachedModels },
      });
      return;
    }
    setProviderModelsState({ status: 'running', inputKey });
    try {
      const result = await fetchProviderModels({
        protocol: apiProtocol,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      });
      if (result.ok && result.models?.length) {
        reconcileProviderModelWithAccount(result.models, inputKey);
        activeSetProviderModelsCache((current) => ({
          ...current,
          [inputKey]: result.models ?? [],
        }));
      }
      setProviderModelsState({ status: 'done', inputKey, result });
    } catch (error) {
      setProviderModelsState({
        status: 'done',
        inputKey,
        result: {
          ok: false,
          kind: 'unknown',
          latencyMs: 0,
          detail: error instanceof Error ? error.message : 'Model list request failed',
        },
      });
    }
  }

  useEffect(() => {
    if (runtime !== 'byok') return;
    if (!canFetchProviderModels) return;
    if (providerModelsState.status === 'running') return;
    if (providerModelsAutoFetchKeyRef.current === providerModelsInputKey) return;
    const timer = window.setTimeout(() => {
      void fetchProviderModelsInline();
    }, ONBOARDING_BYOK_AUTO_FETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [canFetchProviderModels, providerModelsInputKey, providerModelsState.status, runtime]);

  // Model validation runs only on an explicit "Verify and continue"; opening
  // setup must not spend provider credit.
  //
  // A validation only has a consumer while the setup can still act on its
  // verdict. Switching runtime, closing onboarding, or the inputs becoming
  // untestable (a cleared key, a daemon that went away) all end that, and all
  // release the runtime through this cleanup, which React also runs on unmount.
  const runtimeValidationConsumable =
    (runtime === 'local' && canTestAgent) || (runtime === 'byok' && canTestProvider);

  useEffect(() => {
    if (!runtimeValidationConsumable) return;
    return () => {
      abortRuntimeValidations();
    };
  }, [runtime, runtimeValidationConsumable]);

  const verifyTargetName =
    runtime === 'local'
      ? selectedAgent?.name ?? ''
      : config.model.trim() || selectedProvider?.label || t('settings.model');
  const scanning = cliScanStatus === 'scanning'
    || (agentsLoading && cliScanStatus !== 'done' && visibleAgents.length === 0);

  function chooseAgent(agentId: string) {
    chooseRuntime('local');
    onModeChange('daemon');
    onAgentChange(agentId);
  }

  // One list, like a device picker: every agent found on this computer, then
  // "API key" last. The selected row's details open underneath.
  return (
    <section className={styles.agentSetup} aria-label={t('onboarding.choiceAria')}>
        <div className={styles.aiList} role="radiogroup" aria-label={t('onboarding.choiceAria')}>
          {visibleAgents.map((agent, index) => (
            <AiRow
              key={agent.id}
              checked={runtime === 'local' && config.agentId === agent.id}
              icon={<AgentIcon id={agent.id} size={22} />}
              title={agent.name}
              detail={agent.version ?? t('common.installed')}
              tag={agent.authStatus === 'missing' ? t('onboarding.agentNeedsSignIn') : null}
              testId="onboarding-agent-card"
              delay={index * 45}
              onSelect={() => chooseAgent(agent.id)}
            />
          ))}
          {scanning && visibleAgents.length === 0 ? (
            <p className={styles.aiScanning} role="status">
              <Icon name="spinner" size={14} className="icon-spin" />
              {t('onboarding.scanHint')}
            </p>
          ) : null}
          <AiRow
            checked={runtime === 'byok'}
            icon={<span className={styles.aiKeyIcon}><Icon name="key" size={15} /></span>}
            title={t('onboarding.choiceByokTitle')}
            detail={t('onboarding.choiceByokBody')}
            tag={null}
            testId="onboarding-byok-choice"
            delay={0}
            onSelect={() => chooseRuntime('byok')}
          />
        </div>
        {!daemonLive ? <p className={styles.panelHint} role="alert">{t('onboarding.daemonOffline')}</p> : null}

        <div className={styles.details} key={runtime} data-testid={`onboarding-${runtime}-panel`}>
          {runtime === 'local' ? (
            <LocalAgentDetails
              allAgents={agents}
              found={visibleAgents.length}
              selectedAgent={selectedAgent}
              selectedModel={selectedAgentChoice.model ?? defaultAgentModelId(selectedAgent) ?? ''}
              modelOptions={agentModelOptions}
              scanning={scanning}
              scanDone={cliScanStatus === 'done'}
              onRescan={() => void scanCliAgents()}
              onSelectModel={(model) => {
                if (!selectedAgent) return;
                onAgentModelChange(selectedAgent.id, { model, serviceTier: undefined });
              }}
            />
          ) : (
            <ByokPanel
              apiProtocol={apiProtocol}
              apiKey={config.apiKey}
              baseUrl={config.baseUrl}
              model={config.model}
              selectedProvider={selectedProvider}
              providerOptions={byokProviderOptions}
              apiKeyVisible={apiKeyVisible}
              codexMissing={nativeByokCodexMissing}
              openCodeMissing={byokOpenCodeMissing}
              onToggleApiKey={() => setApiKeyVisible((current) => !current)}
              onProtocolChange={(protocol) => {
                byokModelChosenByUserRef.current = false;
                onApiProtocolChange(protocol);
              }}
              onProviderChange={chooseByokProvider}
              onApiKeyChange={(apiKey) => updateApiConfig({ apiKey })}
              onModelChange={(model) => {
                byokModelChosenByUserRef.current = true;
                onApiModelChange(model);
                updateApiConfig({ model });
              }}
              onBaseUrlChange={(baseUrl) =>
                updateApiConfig({
                  baseUrl,
                  apiProviderBaseUrl: apiProtocol === 'azure' ? '' : null,
                })
              }
              modelOptions={byokModelOptions}
              modelsState={visibleProviderModelsState}
              canFetchModels={canFetchProviderModels}
              onFetchModels={() => void fetchProviderModelsInline()}
            />
          )}
        </div>

        <footer className={styles.footer}>
          <VerifyStatus
            runtime={runtime}
            state={activeTestState}
            ready={!connectStepBlocked}
            targetName={verifyTargetName}
            elapsedSeconds={verifyElapsed}
            agentId={selectedAgent?.id ?? null}
            agentInstallUrl={selectedAgent?.installUrl}
            fallbackModel={config.model}
            onCancel={abortRuntimeValidations}
          />
          <div className={styles.actions}>
            {canContinueUnverified ? (
              <Button
                variant="ghost"
                className={styles.secondaryAction}
                data-testid="onboarding-continue-unverified"
                onClick={() => void handleContinueUnverified()}
                title={t('onboarding.continueWithoutVerifyHint')}
                aria-label={t('onboarding.continueWithoutVerify')}
              >
                {t('onboarding.continueWithoutVerify')}
              </Button>
            ) : null}
            <Button
              variant="primary"
              data-testid="onboarding-primary"
              className={`${styles.primaryAction}${connectGateTooltip ? ' pixo-tooltip' : ''}`}
              onClick={() => void handleVerifyAndContinue()}
              disabled={continuePending || verifying}
              aria-disabled={connectStepBlocked || undefined}
              aria-busy={continuePending || verifying || undefined}
              data-tooltip={connectGateTooltip ?? undefined}
              data-tooltip-placement="top"
            >
              {verifying ? <Icon name="spinner" size={15} className="icon-spin" /> : null}
              <span>{verifying ? t('onboarding.verifying') : t('onboarding.verifyAndContinue')}</span>
            </Button>
          </div>
        </footer>
    </section>
  );
}

export function AiRow({
  checked,
  icon,
  title,
  detail,
  tag,
  testId,
  delay,
  onSelect,
}: {
  checked: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  tag: string | null;
  testId: string;
  delay: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={title}
      className={styles.aiRow}
      data-testid={testId}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      onClick={onSelect}
    >
      {icon}
      <span className={styles.aiCopy}>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {tag ? <span className={styles.warnTag}>{tag}</span> : null}
      <span className={styles.aiRadio} aria-hidden />
    </button>
  );
}

export function CommandLine({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <span className={styles.command}>
      <code>{command}</code>
      <Button
        size="sm"
        variant="ghost"
        className={styles.copyButton}
        aria-label={`${t('onboarding.copyCommand')}: ${command}`}
        onClick={() => {
          void copyToClipboard(command).then((ok) => {
            if (ok) setCopied(true);
          });
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        <span>{copied ? t('onboarding.copied') : t('onboarding.copy')}</span>
      </Button>
    </span>
  );
}

/**
 * True when Codex is signed in on this computer (the desktop app or an editor
 * extension) but the `codex` command is missing, which OpenPixo needs.
 */
export function codexAppWithoutCli(agents: readonly AgentInfo[]): boolean {
  return agents.some((agent) => agent.id === 'codex' && !agent.available && agent.vendorSignInWithoutCli === true);
}

/**
 * Copies a message that asks an AI app the user already has (Codex, WorkBuddy
 * and the like) to install and sign in this CLI for them: the way in for
 * someone who has never opened a terminal. The command beside it stays for
 * everyone who has.
 */
export function AskAiToInstall({ agentId, withHint = false }: { agentId: string; withHint?: boolean }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const guide = agentSetupGuide(agentId);
  if (!guide) return null;
  const label = copied ? t('onboarding.askAiCopied') : t('onboarding.askAiCopy');
  const button = (
    <Button
      size="sm"
      variant="secondary"
      className={styles.askAiButton}
      data-testid={`onboarding-ask-ai-${guide.id}`}
      // The install list has one of these per tool, so each name says which.
      aria-label={`${label}: ${guide.name}`}
      onClick={() => {
        void copyToClipboard(agentInstallPrompt(guide, locale)).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      <span>{label}</span>
    </Button>
  );
  if (!withHint) return button;
  return (
    <span className={styles.askAi}>
      <span>{t('onboarding.askAiHint')}</span>
      {button}
    </span>
  );
}

export function ExternalLinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={styles.linkButton}
      onClick={() => void openExternalUrl(href)}
    >
      <span>{children}</span>
      <Icon name="external-link" size={12} />
    </Button>
  );
}

/** What sits under the agent list: a sign-in fix, the model, or how to install one. */
function LocalAgentDetails({
  allAgents,
  found,
  selectedAgent,
  selectedModel,
  modelOptions,
  scanning,
  scanDone,
  onRescan,
  onSelectModel,
}: {
  allAgents: AgentInfo[];
  found: number;
  selectedAgent: AgentInfo | null;
  selectedModel: string;
  modelOptions: Array<{ value: string; label: string }>;
  scanning: boolean;
  scanDone: boolean;
  onRescan: () => void;
  onSelectModel: (model: string) => void;
}) {
  const t = useT();
  const showMissing = scanDone && found === 0;
  const signInGuide =
    selectedAgent?.authStatus === 'missing' ? agentSetupGuide(selectedAgent.id) : null;
  return (
    <div className={styles.panelBody}>
      {signInGuide && selectedAgent ? (
        <div className={styles.callout} data-tone="warn">
          <p>{t('onboarding.signInHint', { agent: selectedAgent.name })}</p>
          <CommandLine command={signInGuide.signInCommand} />
          <AskAiToInstall agentId={signInGuide.id} withHint />
        </div>
      ) : null}

      {selectedAgent && modelOptions.length > 0 ? (
        <OnboardingDropdown
          label={t('settings.model')}
          placeholder={t('settings.modelSourceFallback')}
          value={selectedModel}
          options={modelOptions}
          onChange={onSelectModel}
          searchable
          searchPlaceholder={t('newproj.modelSearch')}
        />
      ) : null}

      {showMissing ? (
        <div className={styles.missing} data-testid="onboarding-missing-agents">
          <div>
            <h3 className={styles.missingTitle}>{t('onboarding.noAgentsTitle')}</h3>
            <p className={styles.panelHint}>{t('onboarding.noAgentsBody')}</p>
            <p className={styles.panelHint}>{t('onboarding.askAiListHint')}</p>
          </div>
          {codexAppWithoutCli(allAgents) ? (
            <p className={styles.callout} data-tone="warn" role="note" data-testid="onboarding-codex-app-without-cli">
              {t('onboarding.codexAppWithoutCli')}
            </p>
          ) : null}
          <ul className={styles.guideList}>
            {missingAgentGuides(allAgents).map((guide) => (
              <li key={guide.id} className={styles.guideRow}>
                <span className={styles.guideName}>
                  <AgentIcon id={guide.id} size={18} />
                  <strong>{guide.name}</strong>
                </span>
                <CommandLine command={guide.installCommand} />
                <AskAiToInstall agentId={guide.id} />
                {guide.installUrl ? (
                  <ExternalLinkButton href={guide.installUrl}>
                    {t('onboarding.installGuide')}
                  </ExternalLinkButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scanDone || found > 0 ? (
        <Button size="sm" variant="ghost" className={styles.rescan} onClick={onRescan}
          disabled={scanning} aria-busy={scanning || undefined}>
          <Icon name={scanning ? 'spinner' : 'refresh'} size={13} className={scanning ? 'icon-spin' : undefined} />
          <span>{scanning ? t('onboarding.scanning') : t('onboarding.rescanHint')}</span>
        </Button>
      ) : null}
    </div>
  );
}

function ByokPanel({
  apiProtocol,
  apiKey,
  baseUrl,
  model,
  selectedProvider,
  providerOptions,
  apiKeyVisible,
  codexMissing,
  openCodeMissing,
  onToggleApiKey,
  onProtocolChange,
  onProviderChange,
  onApiKeyChange,
  onModelChange,
  onBaseUrlChange,
  modelOptions,
  modelsState,
  canFetchModels,
  onFetchModels,
}: {
  apiProtocol: ApiProtocol;
  apiKey: string;
  baseUrl: string;
  model: string;
  selectedProvider: KnownProvider | null;
  providerOptions: Array<{ value: string; label: string }>;
  modelOptions: Array<{ value: string; label: string }>;
  apiKeyVisible: boolean;
  codexMissing: boolean;
  openCodeMissing: boolean;
  onToggleApiKey: () => void;
  onProtocolChange: (protocol: ApiProtocol) => void;
  /** Receives a `byokProviderValue` or `CUSTOM_BYOK_PROVIDER`. */
  onProviderChange: (value: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onModelChange: (model: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
  modelsState:
    | { status: 'idle' }
    | { status: 'running'; inputKey: string }
    | { status: 'done'; inputKey: string; result: ProviderModelsResponse };
  canFetchModels: boolean;
  onFetchModels: () => void;
}) {
  const t = useT();
  const fetchingModels = modelsState.status === 'running';
  const useDeploymentInput = apiProtocol === 'azure';
  // Protocol and address are only questions for a provider OpenPixo does not
  // know (or Azure, whose address is per-resource).
  const custom = selectedProvider === null;
  const showBaseUrl = custom || selectedProvider.baseUrl === '';
  const openCodeGuide = agentSetupGuide('opencode');
  const keyConsole = agentKeyConsole(selectedProvider);
  const keyHintId = useId();
  const modelPlaceholder =
    defaultKnownProviderModel(selectedProvider)
    || modelOptions[0]?.value
    || t('settings.model');
  return (
    <div className={styles.panelBody}>
      {codexMissing ? (
        <p className={styles.panelHint} data-tone="error" role="alert">
          {t('onboarding.byokCodexMissing')}
        </p>
      ) : null}
      {openCodeMissing && openCodeGuide ? (
        <div className={styles.callout} data-tone="warn" role="note">
          <p>{t('onboarding.byokOpenCodeMissing')}</p>
          <CommandLine command={openCodeGuide.installCommand} />
          <AskAiToInstall agentId={openCodeGuide.id} withHint />
        </div>
      ) : null}
      <OnboardingDropdown
        label={t('onboarding.byokProvider')}
        placeholder={t('settings.customProvider')}
        value={selectedProvider ? byokProviderValue(selectedProvider) : CUSTOM_BYOK_PROVIDER}
        options={providerOptions}
        onChange={onProviderChange}
        searchable
        searchPlaceholder={t('onboarding.byokProviderSearch')}
      />
      {custom ? (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('onboarding.byokProtocol')}</span>
          <div className={styles.protocolStrip} role="tablist" aria-label={t('settings.protocolAria')}>
            {API_PROTOCOL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={apiProtocol === tab.id}
                className={styles.protocolTab}
                onClick={() => onProtocolChange(tab.id)}
              >
                {tab.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {showBaseUrl ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settings.baseUrl')}</span>
          <input
            className={styles.input}
            type="url"
            inputMode="url"
            value={baseUrl}
            placeholder={selectedProvider?.baseUrl || 'https://'}
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
        </label>
      ) : null}
      {keyConsole ? (
        <ol className={setupStyles.howTo} aria-label={t('onboarding.whereKeyTitle')}>
          <li>
            <span>{t('onboarding.whereKeyOpen', { host: keyConsole.host })}</span>
            <ExternalLinkButton href={keyConsole.url}>{t('onboarding.openSite', { host: keyConsole.host })}</ExternalLinkButton>
          </li>
          <li><span>{t('onboarding.whereKeyCreate')}</span></li>
          <li><span>{t('onboarding.whereKeyPaste')}</span></li>
        </ol>
      ) : null}
      <div className={styles.field}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settings.apiKey')}</span>
          <span className={styles.fieldRow}>
            <input
              className={styles.input}
              type={apiKeyVisible ? 'text' : 'password'}
              placeholder={API_KEY_PLACEHOLDERS[apiProtocol]}
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={keyConsole ? undefined : keyHintId}
              onChange={(event) => onApiKeyChange(event.target.value)}
            />
            <Button size="sm" variant="ghost" onClick={onToggleApiKey}>
              {apiKeyVisible ? t('settings.hide') : t('settings.show')}
            </Button>
          </span>
        </label>
        {/* The numbered guide above already says where the key comes from. */}
        {keyConsole ? null : <span id={keyHintId} className={styles.fieldHint}>{t('onboarding.byokKeyHint')}</span>}
      </div>
      {modelOptions.length > 0 && !useDeploymentInput ? (
        <OnboardingDropdown
          label={t('settings.model')}
          placeholder={modelPlaceholder}
          value={model}
          options={modelOptions}
          onChange={onModelChange}
          placement="top"
          searchable
          searchPlaceholder={t('newproj.modelSearch')}
          allowCustomValue
        />
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            {useDeploymentInput ? t('settings.azureDeploymentModel') : t('settings.model')}
          </span>
          <input
            className={styles.input}
            type="text"
            value={model}
            placeholder={useDeploymentInput ? t('settings.azureDeploymentModel') : modelPlaceholder}
            onChange={(event) => onModelChange(event.target.value.trim())}
          />
        </label>
      )}
      <div className={styles.modelsRow}>
        <Button
          size="sm"
          variant="ghost"
          onClick={onFetchModels}
          disabled={fetchingModels || !canFetchModels}
          title={t('settings.fetchModelsTitle')}
          aria-busy={fetchingModels || undefined}
        >
          {fetchingModels ? t('settings.fetchModelsRunning') : t('onboarding.byokFetchModels')}
        </Button>
        {modelsState.status === 'done' ? (
          <p
            className={styles.inlineStatus}
            data-tone={onboardingProviderModelsVariant(modelsState.result)}
            role={modelsState.result.ok ? 'status' : 'alert'}
          >
            {renderOnboardingProviderModelsMessage(t, modelsState.result)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const CUSTOM_BYOK_PROVIDER = 'custom';

/** A provider's dropdown value; base URLs alone collide across protocols (Azure and custom are both empty). */
function byokProviderValue(provider: KnownProvider): string {
  return `${provider.protocol}|${provider.baseUrl}`;
}

/**
 * Everything the user needs to know about verification, in one place under
 * the panel: what it costs before it runs, that it is running (with elapsed
 * time and a way out), and — when it failed — what to do about it.
 */
function VerifyStatus({
  runtime,
  state,
  ready,
  targetName,
  elapsedSeconds,
  agentId,
  agentInstallUrl,
  fallbackModel,
  onCancel,
}: {
  runtime: Runtime;
  state: OnboardingRuntimeTestState;
  ready: boolean;
  targetName: string;
  elapsedSeconds: number;
  agentId: string | null;
  agentInstallUrl: string | undefined;
  fallbackModel: string;
  onCancel: () => void;
}) {
  const t = useT();
  if (state.status === 'running') {
    return (
      <div className={styles.verify} data-state="running" role="status">
        <Icon name="spinner" size={15} className="icon-spin" />
        <div className={styles.verifyCopy}>
          <p>
            {runtime === 'local'
              ? t('onboarding.verifyRunningLocal', { agent: targetName })
              : t('onboarding.verifyRunningByok', { model: targetName })}
            <span className={styles.elapsed}>{t('onboarding.elapsed', { n: elapsedSeconds })}</span>
          </p>
          {elapsedSeconds >= VERIFY_SLOW_HINT_AFTER_S ? (
            <p className={styles.verifySub}>{t('onboarding.verifySlow')}</p>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    );
  }
  if (state.status === 'done' && !state.result.ok) {
    const result = state.result;
    const message =
      runtime === 'local'
        ? renderOnboardingAgentTestMessage(t, result, targetName)
        : renderOnboardingProviderTestMessage(t, result, fallbackModel);
    return (
      <div
        className={styles.verify}
        data-state={onboardingTestVariant(result)}
        role="alert"
      >
        <Icon name="alert-triangle" size={15} />
        <div className={styles.verifyCopy}>
          <p className={styles.verifyTitle}>{t('onboarding.failTitle')}</p>
          <p>{message}</p>
          {runtime === 'local'
            ? <AgentFailureFix result={result} agentId={agentId} agentName={targetName} installUrl={agentInstallUrl} />
            : <ByokFailureFix result={result} />}
        </div>
      </div>
    );
  }
  if (state.status === 'done' && state.result.ok) {
    return (
      <div className={styles.verify} data-state="success" role="status">
        <Icon name="check" size={15} />
        <div className={styles.verifyCopy}>
          <p>
            {runtime === 'local'
              ? renderOnboardingAgentTestMessage(t, state.result, targetName)
              : renderOnboardingProviderTestMessage(t, state.result, fallbackModel)}
          </p>
        </div>
      </div>
    );
  }
  if (!ready) return null;
  return (
    <p className={styles.verifyNote}>
      <Icon name="info" size={13} />
      <span>
        {runtime === 'local'
          ? t('onboarding.verifyNoteLocal', { agent: targetName })
          : t('onboarding.verifyNoteByok', { model: targetName })}
      </span>
    </p>
  );
}

function AgentFailureFix({
  result,
  agentId,
  agentName,
  installUrl,
}: {
  result: ConnectionTestResponse;
  agentId: string | null;
  agentName: string;
  installUrl: string | undefined;
}) {
  const t = useT();
  const guide = agentSetupGuide(agentId);
  const href = installUrl && /^https:\/\//i.test(installUrl) ? installUrl : null;
  if (result.kind === 'agent_auth_required') {
    return guide ? (
      <div className={styles.fix}>
        <p>{t('onboarding.fixSignIn', { agent: agentName })}</p>
        <CommandLine command={guide.signInCommand} />
        <AskAiToInstall agentId={guide.id} withHint />
      </div>
    ) : null;
  }
  if (result.kind === 'agent_not_installed') {
    return (
      <div className={styles.fix}>
        <p>{t('onboarding.fixInstall', { agent: agentName })}</p>
        {guide ? <CommandLine command={guide.installCommand} /> : null}
        {guide ? <AskAiToInstall agentId={guide.id} withHint /> : null}
        {href ? <ExternalLinkButton href={href}>{t('onboarding.installGuide')}</ExternalLinkButton> : null}
      </div>
    );
  }
  if (result.kind === 'timeout' || result.kind === 'agent_spawn_failed') {
    return guide ? (
      <div className={styles.fix}>
        <p>{t('onboarding.fixRunOnce', { agent: agentName })}</p>
        <CommandLine command={guide.signInCommand} />
      </div>
    ) : null;
  }
  return null;
}

function ByokFailureFix({ result }: { result: ConnectionTestResponse }) {
  const t = useT();
  if (result.kind === 'auth_failed' || result.kind === 'forbidden') {
    return <p className={styles.fix}>{t('onboarding.fixByokKey')}</p>;
  }
  if (result.kind === 'not_found_model' || result.kind === 'invalid_model_id') {
    return <p className={styles.fix}>{t('onboarding.fixByokModel')}</p>;
  }
  if (byokFailureAllowsSkip(result)) {
    return <p className={styles.fix}>{t('onboarding.fixByokLater')}</p>;
  }
  return null;
}

function onboardingTestVariant(result: ConnectionTestResponse): 'success' | 'warn' | 'error' {
  if (result.ok) return 'success';
  if (result.kind === 'rate_limited') return 'warn';
  return 'error';
}

function onboardingProviderModelsVariant(
  result: ProviderModelsResponse,
): 'success' | 'warn' | 'error' {
  if (result.ok) return 'success';
  if (result.kind === 'rate_limited' || result.kind === 'no_models') return 'warn';
  return 'error';
}

function isLikelyHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function mergeOnboardingProviderModelOptions(
  fetchedModels: readonly ProviderModelOption[],
  suggestedModelIds: readonly string[],
  currentModel: string,
): ProviderModelOption[] {
  const seen = new Set<string>();
  const out: ProviderModelOption[] = [];
  const add = (model: ProviderModelOption) => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: model.label.trim() || id });
  };
  for (const model of fetchedModels) add(model);
  // Once the account has answered, its list IS the menu: the hand-curated
  // suggestions are only a stand-in for a provider that has not been asked.
  if (fetchedModels.length === 0) {
    for (const id of suggestedModelIds) add({ id, label: id });
  }
  if (currentModel.trim()) add({ id: currentModel.trim(), label: currentModel.trim() });
  return out;
}

function onboardingProviderModelLabel(model: ProviderModelOption): string {
  return model.label && model.label !== model.id
    ? `${model.label} (${model.id})`
    : model.id;
}

function renderOnboardingProviderTestMessage(
  t: ReturnType<typeof useT>,
  result: ConnectionTestResponse,
  fallbackModel: string,
): string {
  const ms = Math.max(0, Math.round(result.latencyMs));
  const sample = result.sample ?? '';
  const testedModel = result.model ?? fallbackModel;
  if (result.ok) {
    const baseMessage = t('settings.testSuccessApi', { ms, sample });
    return result.detail ? `${baseMessage} ${result.detail}` : baseMessage;
  }
  switch (result.kind) {
    case 'auth_failed':
      return t('settings.testAuthFailed');
    case 'forbidden':
      return t('settings.testForbidden');
    case 'not_found_model':
      return t('settings.testNotFoundModel', { model: testedModel });
    case 'invalid_model_id':
      return t('settings.testInvalidModelId', { model: testedModel });
    case 'invalid_base_url':
      return t('settings.testInvalidBaseUrl');
    case 'rate_limited':
      return t('settings.testRateLimited');
    case 'upstream_unavailable': {
      const baseMessage = t('settings.testUpstream', { status: result.status ?? 0 });
      return result.detail ? `${baseMessage} ${result.detail}` : baseMessage;
    }
    case 'timeout':
      return t('settings.testTimeout', { ms });
    default:
      return t('settings.testUnknown', { detail: result.detail ?? '' });
  }
}

function renderOnboardingAgentTestMessage(
  t: ReturnType<typeof useT>,
  result: ConnectionTestResponse,
  fallbackAgentName: string,
): string {
  const ms = Math.max(0, Math.round(result.latencyMs));
  const sample = result.sample ?? '';
  const agentName = result.agentName ?? fallbackAgentName;
  if (result.ok) {
    const baseMessage = t('settings.testSuccessCli', { agentName, ms, sample });
    return result.detail ? `${baseMessage} ${result.detail}` : baseMessage;
  }
  switch (result.kind) {
    case 'agent_not_installed':
      return t('settings.testAgentMissing', { agentName });
    case 'agent_auth_required':
      return result.detail || t('onboarding.authRequired', { agent: agentName });
    case 'agent_spawn_failed':
      return t('settings.testAgentSpawn', { agentName, detail: result.detail ?? '' });
    case 'rate_limited':
      return t('settings.testRateLimited');
    case 'timeout':
      return t('settings.testTimeout', { ms });
    default:
      return t('settings.testUnknown', { detail: result.detail ?? '' });
  }
}

function renderOnboardingProviderModelsMessage(
  t: ReturnType<typeof useT>,
  result: ProviderModelsResponse,
): string {
  if (result.ok) {
    return t('settings.fetchModelsSuccess', { count: result.models?.length ?? 0 });
  }
  switch (result.kind) {
    case 'auth_failed':
      return t('settings.testAuthFailed');
    case 'forbidden':
      return t('settings.testForbidden');
    case 'invalid_base_url':
      return t('settings.testInvalidBaseUrl');
    case 'rate_limited':
      return t('settings.testRateLimited');
    case 'upstream_unavailable': {
      const baseMessage = t('settings.testUpstream', { status: result.status ?? 0 });
      return result.detail ? `${baseMessage} ${result.detail}` : baseMessage;
    }
    case 'timeout':
      return t('settings.testTimeout', { ms: Math.max(0, Math.round(result.latencyMs)) });
    case 'no_models':
      return t('settings.fetchModelsEmpty');
    case 'unsupported_protocol':
      return t('settings.fetchModelsUnsupported');
    default:
      return t('settings.fetchModelsFailed', { detail: result.detail ?? '' });
  }
}
