import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '@openpixo/components';
import {
  formatCostMultiplier, hostedModelCostMultipliers, isOpenPixoAgentAutoModel, OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME, OPENPIXO_AGENT_ID,
} from '@openpixo/contracts';
import { agentIdToTracking, byokProtocolToTracking, modelIdForTracking } from '@openpixo/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import { trackExecutionSettingsPopoverClick } from '../analytics/events';
import { useT } from '../i18n';
import { isCloudAccountAvailable, useOpenPixoAccount } from '../hooks/useOpenPixoAccount';
import { KNOWN_PROVIDERS } from '../state/config';
import { SUGGESTED_MODELS_BY_PROTOCOL } from '../state/apiProtocols';
import { fetchProviderModels } from '../providers/provider-models';
import type { AgentInfo, ApiProtocol, AppConfig, ExecMode, ProviderModelOption } from '../types';
import { apiProtocolLabel } from '../utils/apiProtocol';
import { resolveAvailableAgentId } from '../utils/visibleAgents';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import { effectiveAgentModelId } from './agentModelSelection';
import { modelOptionLabel } from './modelOptions';
import { localAgentOffered, localModelView } from './localModelList';
import { EffortPicker } from './EffortPicker';
import { anchorSelectionInView } from './pickerSelectionAnchor';
import {
  mergeProviderModelOptions,
  providerModelsCacheKey,
  type ProviderModelsCache,
} from './providerModelsCache';
import styles from './InlineModelSwitcher.module.css';

interface Props {
  config: AppConfig;
  agents: AgentInfo[];
  providerModelsCache?: ProviderModelsCache;
  compact?: boolean;
  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiProtocolChange?: (protocol: ApiProtocol) => void;
  onApiModelChange?: (model: string) => void;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<ProviderModelsCache>>;
  onOpenSettings: (section?: 'execution') => void;
  onSignIn?: () => void;
  placement?: 'up' | 'down';
  onOpen?: () => void;
  openSignal?: number;
}

const LOCAL_CLIS = [{ id: 'codex' }, { id: 'claude' }, { id: 'opencode' }] as const;
const EMPTY_MODELS: ProviderModelOption[] = [];

/** One model menu for composer surfaces; persistence stays with the caller. */
export function InlineModelSwitcher({
  config,
  agents,
  providerModelsCache,
  compact = false,
  daemonLive,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onApiModelChange,
  onProviderModelsCacheChange,
  onOpenSettings,
  onSignIn,
  placement,
  onOpen,
  openSignal,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const menuId = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<ProviderModelsCache>({});
  const [modelQueries, setModelQueries] = useState<Record<string, string>>({});
  const [position, setPosition] = useState<CSSProperties>({});
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectionAnchoredRef = useRef(false);
  const lastOpenSignalRef = useRef(openSignal);
  const fetchingRef = useRef(new Set<string>());
  const currentAgent = agents.find(
    (agent) => agent.id === resolveAvailableAgentId(config.agentId, agents),
  );
  const currentChoice = currentAgent ? config.agentModels?.[currentAgent.id] : undefined;
  const currentModelId = effectiveAgentModelId(currentAgent, currentChoice)
    ?? (currentAgent && !currentAgent.models?.length ? 'default' : null);
  const currentModel = currentAgent?.models?.find((model) => model.id === currentModelId);
  const apiProtocol = config.apiProtocol ?? 'anthropic';
  const { status: cloudAccount } = useOpenPixoAccount();
  const cloudAvailable = isCloudAccountAvailable(cloudAccount);
  const signedIn = cloudAvailable && cloudAccount?.signedIn === true;
  // The bundled OpenCode on the OpenPixo-credits model; it needs an account, not a key.
  const hostedAgent = agents.find((agent) => agent.id === OPENPIXO_AGENT_ID);
  const hostedCost = useMemo(() => hostedModelCostMultipliers(hostedAgent?.models ?? []), [hostedAgent?.models]);
  const modelName = config.mode === 'api'
    ? config.model.trim() || t('inlineSwitcher.modelDefault')
    : currentModelId && currentAgent?.id === OPENPIXO_AGENT_ID && isOpenPixoAgentAutoModel(currentModelId)
      ? t('homeModel.autoModel')
      : currentModelId
        ? modelOptionLabel(currentModelId, currentModel?.label ?? currentModelId, t('inlineSwitcher.modelDefault'))
        : t('inlineSwitcher.modelDefault');
  const sourceName = config.mode === 'api'
    ? apiProtocolLabel(apiProtocol) + ' · ' + t('homeModel.ownKey')
    : currentAgent?.name ?? t('inlineSwitcher.noAgent');
  const reasoningOptions = currentModel?.reasoningOptions ?? currentAgent?.reasoningOptions ?? [];
  const reasoning = reasoningOptions.find((option) => option.id === currentChoice?.reasoning)?.id
    ?? reasoningOptions.find((option) => option.default)?.id
    ?? reasoningOptions[0]?.id;
  const serviceTierOptions = currentModel?.serviceTierOptions ?? [];
  const serviceTier = serviceTierOptions.find((option) => option.id === currentChoice?.serviceTier)?.id
    ?? serviceTierOptions.find((option) => option.default)?.id
    ?? serviceTierOptions[0]?.id;

  const provider = KNOWN_PROVIDERS.find(
    (item) => item.protocol === apiProtocol && item.baseUrl === config.apiProviderBaseUrl,
  ) ?? KNOWN_PROVIDERS.find((item) => item.protocol === apiProtocol);
  const providerKey = providerModelsCacheKey(
    apiProtocol, config.baseUrl, config.apiKey, config.apiVersion ?? '',
  );
  const sharedModels = providerModelsCache?.[providerKey] ?? EMPTY_MODELS;
  const fetchedModels = sharedModels.length ? sharedModels : discoveredModels[providerKey] ?? EMPTY_MODELS;
  const apiModels = useMemo(() => mergeProviderModelOptions(
    fetchedModels,
    provider?.preferredModels.length
      ? provider.preferredModels
      : SUGGESTED_MODELS_BY_PROTOCOL[apiProtocol],
  ), [fetchedModels, provider, apiProtocol]);
  const ownKeyConfigured = apiProtocol === 'ollama' || Boolean(config.apiKey.trim());
  const showOwnKey = config.mode === 'api' || ownKeyConfigured;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (openSignal === undefined || openSignal === lastOpenSignalRef.current) return;
    lastOpenSignalRef.current = openSignal;
    setOpen(true);
    onOpen?.();
  }, [openSignal, onOpen]);

  // The menu is portalled so composer overflow and stacking cannot clip it.
  useLayoutEffect(() => {
    if (!open || !mounted) {
      selectionAnchoredRef.current = false;
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.width > 0 && rect.height > 0 && (
        rect.bottom <= 0 || rect.top >= window.innerHeight ||
        rect.right <= 0 || rect.left >= window.innerWidth
      )) {
        setOpen(false);
        return;
      }
      const margin = 8;
      const gap = 8;
      const width = Math.min(320, Math.max(0, window.innerWidth - margin * 2));
      const above = Math.max(0, rect.top - margin - gap);
      const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
      const up = placement === 'up' || (placement !== 'down' && below < 360 && above > below);
      setDirection(up ? 'up' : 'down');
      setPosition({
        position: 'fixed',
        width,
        left: Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin),
        top: up ? 'auto' : rect.bottom + gap,
        bottom: up ? window.innerHeight - rect.top + gap : 'auto',
        maxHeight: Math.min(560, up ? above : below),
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (triggerRef.current) {
      observer?.observe(triggerRef.current);
      const composer = triggerRef.current.closest('.composer-shell');
      if (composer) observer?.observe(composer);
    }
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, mounted, placement]);

  useLayoutEffect(() => {
    if (!open || !mounted || selectionAnchoredRef.current || !menuRef.current) return;
    selectionAnchoredRef.current = true;
    anchorSelectionInView(menuRef.current, '[aria-checked="true"]');
    const selected = menuRef.current.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (selected ?? menuRef.current.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
  }, [open, mounted, agents, apiModels]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !showOwnKey || fetchedModels.length) return;
    if (apiProtocol === 'azure' || apiProtocol === 'ollama') return;
    if (apiProtocol !== 'aihubmix' && !ownKeyConfigured) return;
    if (!/^https?:\/\//i.test(config.baseUrl.trim()) || fetchingRef.current.has(providerKey)) return;
    fetchingRef.current.add(providerKey);
    let active = true;
    void fetchProviderModels({ protocol: apiProtocol, baseUrl: config.baseUrl, apiKey: config.apiKey })
      .then((result) => {
        const models = result.models;
        if (active && result.ok && models?.length) {
          setDiscoveredModels((cache) => ({ ...cache, [providerKey]: models }));
          onProviderModelsCacheChange?.((cache) => ({ ...cache, [providerKey]: models }));
        }
      })
      .catch(() => { /* Keep the suggested catalogue when discovery is unavailable. */ })
      .finally(() => fetchingRef.current.delete(providerKey));
    return () => { active = false; };
  }, [open, showOwnKey, onProviderModelsCacheChange, fetchedModels.length, apiProtocol, ownKeyConfigured, config.baseUrl, config.apiKey, providerKey]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectLocal(agent: AgentInfo, model: string) {
    if (!daemonLive || !agent.available) return;
    if (config.mode !== 'daemon') onModeChange('daemon');
    if (config.agentId !== agent.id || config.mode !== 'daemon') onAgentChange(agent.id);
    // An old model's speed tier must not travel to the next model.
    onAgentModelChange(agent.id, { model, serviceTier: undefined });
    trackExecutionSettingsPopoverClick(analytics.track, {
      page_name: 'home', area: 'execution_settings_popover', element: 'model_dropdown',
      execution_mode: 'local_cli', cli_provider_id: agentIdToTracking(agent.id),
      model_id: modelIdForTracking(model),
    });
    close();
  }

  const modelControls = (
    <>
      {config.mode === 'daemon' && currentAgent && serviceTierOptions.length ? (
        <label className={styles.controls}>
          {t('avatar.serviceTierLabel')}
          <select aria-label={t('avatar.serviceTierLabel')} value={serviceTier} tabIndex={open ? 0 : -1}
            onChange={(event) => onAgentModelChange(currentAgent.id, { serviceTier: event.target.value })}>
            {serviceTierOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      ) : null}
    </>
  );
  // Beside the model they belong to, not at the far end of a long list.
  const hostedSelected = currentAgent?.id === OPENPIXO_AGENT_ID;

  // Only CLIs that are installed and reachable; installing one is a Settings task.
  const localRows = daemonLive ? LOCAL_CLIS.flatMap(({ id }) => {
    const agent = agents.find((item) => item.id === id);
    if (!localAgentOffered(agent, currentAgent?.id)) return [];
    // OpenCode with no provider connected has nothing of the user's to offer.
    if (id === 'opencode' && !agent.models?.some((model) => model.id && model.id !== 'default')) return [];
    const allModels: NonNullable<AgentInfo['models']> = agent.models?.length
      ? agent.models : [{ id: 'default', label: t('inlineSwitcher.modelDefault') }];
    const query = modelQueries[id] ?? '';
    const view = localModelView(allModels, currentAgent?.id === id ? currentModelId : null, query);
    return [(
      <div key={id} role="group" aria-label={agent.name}>
        <div className={styles.agentHeading}><AgentIcon id={id} size={14} />{agent.name}</div>
        {view.searchable ? (
          <Input type="search" className={styles.search} value={query} tabIndex={open ? 0 : -1}
            aria-label={t('inlineSwitcher.searchModels', { name: agent.name, n: allModels.length })}
            placeholder={t('inlineSwitcher.searchModels', { name: agent.name, n: allModels.length })}
            data-testid={'inline-model-switcher-search-' + id}
            onChange={(event) => { const value = event.target.value; setModelQueries((queries) => ({ ...queries, [id]: value })); }} />
        ) : null}
        {view.searchable && query.trim() && view.matches === 0 ? (
          <p className={styles.notice} role="status">{t('inlineSwitcher.noModelMatch')}</p>
        ) : null}
        {view.searchable && view.matches > view.rows.length ? (
          <p className={styles.notice} role="status">{t('inlineSwitcher.moreModelMatches', { n: view.matches - view.rows.length })}</p>
        ) : null}
        {view.rows.map((model) => {
          const selected = config.mode === 'daemon' && currentAgent?.id === id && currentModelId === model.id;
          return (
            <Button key={model.id} variant="ghost" className={styles.row} role="menuitemradio"
              aria-checked={selected} disabled={model.enabled === false || !model.id} tabIndex={open ? 0 : -1}
              title={model.label}
              data-testid={compact && currentAgent?.id === id
                ? 'inline-model-switcher-compact-model-' + model.id
                : 'inline-model-switcher-model-' + id + '-' + model.id}
              onClick={() => selectLocal(agent, model.id)}>
              <span className={styles.label}>{modelOptionLabel(model.id, model.label, t('inlineSwitcher.modelDefault'))}</span>
              {model.enabled === false ? <span className={styles.hint}>{t('homeModel.setUp')}</span> : null}
              {selected ? <Icon name="check" size={14} /> : null}
            </Button>
          );
        })}
      </div>
    )];
  }) : [];

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className={styles.menu}
      role="menu"
      aria-label={t('inlineSwitcher.modelLabel')}
      aria-hidden={!open}
      data-open={open}
      data-placement={direction}
      data-testid="inline-model-switcher-popover"
      style={position}
      onKeyDown={(event) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled)',
        ));
        const index = items.indexOf(document.activeElement as HTMLButtonElement | HTMLSelectElement | HTMLInputElement);
        if (event.key === 'Tab') {
          if ((event.shiftKey && index <= 0) || (!event.shiftKey && index >= items.length - 1)) {
            setOpen(false);
            triggerRef.current?.focus();
          }
          return;
        }
        if (event.target instanceof HTMLSelectElement) return;
        // Home and End move the caret inside the search box; the arrows still leave it for the results.
        if (event.target instanceof HTMLInputElement && (event.key === 'Home' || event.key === 'End')) return;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      {cloudAvailable ? <section className={styles.section} role="group" aria-label={t('homeModel.accountCredits')}>
        <h3 className={styles.heading}>{t('homeModel.accountCredits')}</h3>
        {signedIn ? (
          hostedAgent?.available && daemonLive ? (
            (hostedAgent.models ?? []).filter((model) => model.id && model.id !== 'default').map((model) => {
              const selected = config.mode === 'daemon' && currentAgent?.id === hostedAgent.id && currentModelId === model.id;
              const auto = isOpenPixoAgentAutoModel(model.id);
              const autoDetail = t('homeModel.autoModelDetail', { n: OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME });
              return (
                <Button key={model.id} variant="ghost" className={styles.row} role="menuitemradio"
                  aria-checked={selected} tabIndex={open ? 0 : -1} title={auto ? autoDetail : model.label}
                  data-testid={'inline-model-switcher-model-' + hostedAgent.id + '-' + model.id}
                  onClick={() => selectLocal(hostedAgent, model.id)}>
                  <span className={styles.label}>{auto ? t('homeModel.autoModel') : model.label ?? model.id}</span>
                  {auto ? (
                    <span className={styles.hint} title={autoDetail} data-testid="inline-model-switcher-auto-hint">
                      {t('homeModel.autoModelHint')}
                    </span>
                  ) : null}
                  {hostedCost.has(model.id) ? (
                    <span className={styles.hint} title={t('homeModel.costHint')}
                      data-testid={'inline-model-switcher-cost-' + model.id}>
                      {formatCostMultiplier(hostedCost.get(model.id)!)}
                    </span>
                  ) : null}
                  {selected ? <Icon name="check" size={14} /> : null}
                </Button>
              );
            })
          ) : (
            <p className={styles.notice} role="status">{t('homeModel.hostedUnavailable')}</p>
          )
        ) : (
          <Button variant="ghost" className={styles.row} role="menuitem" tabIndex={open ? 0 : -1}
            disabled={!onSignIn} onClick={() => { close(); onSignIn?.(); }}>
            <Icon name="log-in" size={16} />
            <span className={styles.label}>{t('homeModel.signIn')}</span>
          </Button>
        )}
        {hostedSelected ? modelControls : null}
      </section> : null}
      {localRows.length || showOwnKey ? <section className={styles.section} role="group" aria-label={t('homeModel.local')}>
        <h3 className={styles.heading}>{t('homeModel.local')}</h3>
        {localRows}
        {showOwnKey ? (
          <div role="group" aria-label={t('homeModel.ownKey')}>
            <div className={styles.agentHeading}><Icon name="key" size={14} />{apiProtocolLabel(apiProtocol)} · {t('homeModel.ownKey')}</div>
            {mergeProviderModelOptions(apiModels, config.model ? [config.model] : []).map((model) => (
              <Button key={model.id} variant="ghost" className={styles.row} role="menuitemradio"
                aria-checked={config.mode === 'api' && config.model === model.id}
                disabled={!ownKeyConfigured || !onApiModelChange} tabIndex={open ? 0 : -1} title={model.label}
                data-testid={'inline-model-switcher-api-model-' + model.id}
                onClick={() => {
                  if (config.mode !== 'api') onModeChange('api');
                  onApiModelChange?.(model.id);
                  trackExecutionSettingsPopoverClick(analytics.track, {
                    page_name: 'home', area: 'execution_settings_popover', element: 'model_dropdown',
                    execution_mode: 'byok', provider_id: byokProtocolToTracking(apiProtocol) ?? undefined,
                    model_id: modelIdForTracking(model.id),
                  });
                  close();
                }}>
                <span className={styles.label}>{model.label}</span>
                {!ownKeyConfigured ? <span className={styles.hint}>{t('homeModel.setUp')}</span> : null}
                {config.mode === 'api' && config.model === model.id ? <Icon name="check" size={14} /> : null}
              </Button>
            ))}
          </div>
        ) : null}
        {hostedSelected && cloudAvailable ? null : modelControls}
      </section> : null}
      <div className={styles.footer}>
        <Button variant="ghost" className={styles.row} role="menuitem" tabIndex={open ? 0 : -1}
          data-testid="inline-model-switcher-open-settings"
          onClick={() => {
            trackExecutionSettingsPopoverClick(analytics.track, {
              page_name: 'home', area: 'execution_settings_popover', element: 'open_execution_settings',
            });
            close();
            onOpenSettings('execution');
          }}>
          <Icon name="settings" size={14} />
          <span className={styles.label}>{t('inlineSwitcher.openFullSettings')}</span>
        </Button>
      </div>
    </div>
  );

  return (
    <div className={styles.root} data-testid="inline-model-switcher">
      <Button ref={triggerRef} variant="ghost" className={styles.chip}
        data-testid="inline-model-switcher-chip" aria-label={sourceName + ' · ' + modelName}
        aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (!open) onOpen?.();
          setOpen(true);
        }}>
        <span className={styles.source} aria-hidden="true">
          {config.mode === 'daemon' && currentAgent
            ? <AgentIcon id={currentAgent.id} size={16} /> : <Icon name="key" size={14} />}
        </span>
        <span className={styles.modelName}>{modelName}</span>
        <Icon name="chevron-down" size={12} />
      </Button>
      {config.mode === 'daemon' && currentAgent && reasoningOptions.length ? (
        <EffortPicker options={reasoningOptions} value={reasoning}
          onChange={(id) => onAgentModelChange(currentAgent.id, {
            reasoning: id,
            // Saved against the model in effect, even when that is its default.
            ...(currentModelId && currentModelId !== 'default' ? { model: currentModelId } : {}),
          })} />
      ) : null}
      {mounted ? createPortal(menu, document.body) : null}
    </div>
  );
}
