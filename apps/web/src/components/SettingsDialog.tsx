import dialogStyles from './SettingsDialog.module.css';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { Button, Dialog, ConfirmDialog, VisuallyHidden } from '@openpixo/components';
import { GameEnginesSettings } from './game/GameEnginesSettings';
import { DoctorSection } from './doctor/DoctorSection';

import { validateBaseUrl } from '@openpixo/contracts/api/connectionTest';
import { GAME_EXPERIENCE_LEVELS, isGameExperience, localizedProductPage, nativeCodexProviderForConfig, PRODUCT_RELEASES_URL } from '@openpixo/contracts';
import {
  agentIdToTracking,
  byokProtocolToTracking,
  executionModeToTracking,
  settingsSectionToTracking,
} from '@openpixo/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import { byokErrorCode } from '../analytics/byok-error-code';


import { trackByokPreflightBlocked, trackSettingsByokModelsFetchResult, trackSettingsByokTestResult, trackSettingsCliTestResult, trackSettingsByokFieldClick, trackSettingsByokProviderOptionClick, trackSettingsLanguageClick, trackSettingsLocalCliClick, trackSettingsExecutionModeTabClick, trackSettingsMediaProvidersClick, trackSettingsNotificationsClick, trackSettingsView } from '../analytics/events';
import { LOCALE_LABEL, LOCALES, useI18n } from '../i18n';
import type { Locale } from '../i18n';
import type { Dict } from '../i18n/types';
import { AgentIcon } from './AgentIcon';
import { AgentDiagnosticRow } from './AgentDiagnosticRow';
import { AgentCapabilityMatrix } from './AgentCapabilityMatrix';
import { AgentApprovalSettings } from './AgentApprovalSettings';



import {
  availableVisibleAgentCount,
  isVisibleLocalCliAgent,
} from '../utils/visibleAgents';
import { ExportDiagnosticsRow } from './ExportDiagnosticsButton';
import { Icon } from './Icon';
import { AgentImageModelSetting } from './agent-image-model/AgentImageModelPicker';
import { LabsSection } from './LabsSection';
import { defaultAgentModelId } from './agentModelSelection';
import { CUSTOM_MODEL_SENTINEL, effortOptionLabel, SearchableModelSelect } from './modelOptions';
import {
  applyApiProtocolConfig,
  currentApiProtocolConfig,
  defaultApiProtocolConfig,
  nextApiProtocolConfig,
  switchApiProtocolConfig,
  updateCurrentApiProtocolConfig,
} from './api-protocol-config';
import { BYOK_PROVIDER_PRESETS, DEFAULT_NOTIFICATIONS, defaultKnownProviderModel, isStoredMediaProviderEntryEmpty, isStoredMediaProviderEntryPresent, KNOWN_PROVIDERS, mergeDaemonMediaProviders } from '../state/config';
import type { KnownProvider } from '../state/config';

import {
  API_PROTOCOL_TABS,
  DEFAULT_BASE_URL_BY_PROTOCOL,
  API_PROTOCOL_LABELS,
  isFixedOriginGateway,
  resolveFixedOriginBaseUrl,
  SUGGESTED_MODELS_BY_PROTOCOL,
} from '../state/apiProtocols';
import {
  mergeProviderModelOptions,
  providerModelsCacheKey,
  type ProviderModelsCache,
} from './providerModelsCache';
import {
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  modelMaxTokensDefault,
} from '../state/maxTokens';
import type { AgentInfo, ApiProtocol, ApiProtocolConfig, AppConfig, AppVersionInfo, ConnectionTestResponse, ExecMode, ProviderModelOption, ProviderModelsResponse } from '../types';
import {
  testAgent,
  testApiProvider,
} from '../providers/connection-test';
import { fetchProviderModels } from '../providers/provider-models';
import { openExternalUrl } from '../providers/registry';
import { MEDIA_PROVIDERS } from '../media/models';
import type { MediaProviderAvailability } from '@openpixo/contracts';
import { codexImageReasonKey } from '../media/codex-image-errors';
import { CodexImageProviderControl } from './CodexImageProviderControl';
import { useByokImageModelOptions, useByokVideoModelOptions, useByokSpeechModelOptions } from '../media/aihubmix-image-models';
import { isVisualStabilityMode } from '../utils/visualStability';
import { byokProviderRequiresApiKey } from '../utils/byokProvider';
import { XaiOAuthControl } from './XaiOAuthControl';
import type { MediaProvider } from '../media/models';
import { Toast } from './Toast';
import {
  checkForUpdaterUpdate,
  clearUpdaterCache,
  deriveUpdaterModel,
  downloadUpdaterUpdate,
  isUpdaterDownloadFailure,
  openUpdaterInstaller,
  quitAfterUpdaterInstallerOpen,
  readUpdaterStatus,
  restartSafetyFromActionResult,
  restartSafetyFromUpdaterStatus,
  subscribeToUpdaterStatus,
  type UpdaterActionResult,
  type UpdaterModel,
  type UpdaterRestartSafety,
} from '../lib/updater';
import { McpClientSection } from './McpClientSection';
import { SkillsSection } from './SkillsSection';
import { PrivacySection } from './PrivacySection';
import { AccountSection } from './account/AccountSection';
import { useOpenPixoAccount } from '../hooks/useOpenPixoAccount';
import { ProjectLocationsSection } from './ProjectLocationsSection';
import { SettingsNav, SettingsPageHeader } from './SettingsNav';
import {
  resolveSettingsDeepLink,
  settingsAnchorId,
  settingsNavItem,
  type SettingsAnchor,
  type SettingsPage,
  type SettingsSection,
} from '../settings-navigation';
import { ByokConnectionTestControl } from './byok/ByokConnectionTestControl';
import { ByokKeyField } from './byok/ByokKeyField';
import { ByokModelField } from './byok/ByokModelField';
import { ByokProviderBaseUrl } from './byok/ByokProviderBaseUrl';
import { ByokProviderPicker } from './byok/ByokProviderPicker';
import { byokPreflightBlockReason } from './byok/preflight';
import {
  blockingByokDraftFields,
  blockingByokDraftIssues,
  cleanByokApiKey,
  resolveByokModelPreference,
  validateByokDraft,
  type ByokDraftField,
  type ByokDraftIssue,
  type ByokDraftValidation,
} from './byok/validation';

import {
  applyAppearanceToDocument,
  resolveAccentColor,
} from '../state/appearance';
import { isAutosaveDraftOnlyChange } from '../App';
import {
  FAILURE_SOUNDS,
  SUCCESS_SOUNDS,
  notificationPermission,
  playSound,
  requestNotificationPermission,
  showCompletionNotification,
} from '../utils/notifications';


export {
  mergeProviderModelOptions,
  providerModelsCacheKey,
} from './providerModelsCache';


export type { SettingsSection } from '../settings-navigation';

interface ByokProviderPreset {
  id: string;
  title: string;
  protocol: ApiProtocol;
  baseUrl: string;
  preferredModels: readonly string[];
  custom?: boolean;
}


type AboutUpdatePrimaryAction = 'check' | 'download' | 'install' | 'quit';
type AboutUpdateTone = 'neutral' | 'success' | 'warning' | 'error';

export interface AboutUpdateControl {
  primaryAction: AboutUpdatePrimaryAction | null;
  primaryLabelKey: keyof Dict | null;
  showReleaseLink: boolean;
  statusKey: keyof Dict;
  statusTone: AboutUpdateTone;
  statusVars?: Record<string, string | number>;
}

export function deriveAboutUpdateControl(
  model: UpdaterModel,
  appVersionInfo: AppVersionInfo | null,
): AboutUpdateControl {
  if (appVersionInfo?.packaged === false) {
    return {
      primaryAction: null,
      primaryLabelKey: null,
      showReleaseLink: true,
      statusKey: 'settings.updateStatusDevelopment',
      statusTone: 'neutral',
    };
  }

  if (model.environment !== 'desktop' || !model.enabled || !model.supported) {
    return {
      primaryAction: null,
      primaryLabelKey: null,
      showReleaseLink: true,
      statusKey: 'settings.updateStatusUnsupported',
      statusTone: 'warning',
    };
  }

  switch (model.status?.state) {
    case 'checking':
      return {
        primaryAction: null,
        primaryLabelKey: 'updater.checking',
        showReleaseLink: true,
        statusKey: 'settings.updateStatusChecking',
        statusTone: 'neutral',
      };
    case 'not-available':
      return {
        primaryAction: 'check',
        primaryLabelKey: 'settings.updateRecheck',
        showReleaseLink: true,
        statusKey: 'settings.updateStatusUpToDate',
        statusTone: 'success',
      };
    case 'available':
      return {
        primaryAction: model.canDownload ? 'download' : null,
        primaryLabelKey: model.canDownload ? 'updater.download' : null,
        showReleaseLink: true,
        statusKey: model.availableVersion
          ? 'settings.updateStatusAvailable'
          : 'settings.updateStatusAvailableUnknown',
        statusTone: 'warning',
        ...(model.availableVersion ? { statusVars: { version: model.availableVersion } } : {}),
      };
    case 'downloading': {
      const percent = model.downloadProgress?.percent;
      return {
        primaryAction: null,
        primaryLabelKey: 'updater.downloading',
        showReleaseLink: true,
        statusKey: typeof percent === 'number'
          ? 'settings.updateStatusDownloadingPercent'
          : 'settings.updateStatusDownloading',
        statusTone: 'neutral',
        ...(typeof percent === 'number' ? { statusVars: { percent } } : {}),
      };
    }
    case 'downloaded': {
      if (model.installerOpened && model.canQuitAfterInstallerOpen) {
        return {
          primaryAction: 'quit',
          primaryLabelKey: 'updater.quitButton',
          showReleaseLink: false,
          statusKey: model.updateKind === 'payload' ? 'updater.installingRestart' : 'updater.opening',
          statusTone: 'neutral',
        };
      }
      const canInstallUpdate = model.canOpenInstaller || model.canApplyInPlace;
      return {
        primaryAction: canInstallUpdate ? 'install' : null,
        primaryLabelKey: canInstallUpdate
          ? model.updateKind === 'payload'
            ? 'updater.installRestart'
            : 'settings.updateNow'
          : null,
        showReleaseLink: true,
        statusKey: model.availableVersion
          ? 'settings.updateStatusReady'
          : 'settings.updateStatusReadyUnknown',
        statusTone: 'success',
        ...(model.availableVersion ? { statusVars: { version: model.availableVersion } } : {}),
      };
    }
    case 'installing':
      return {
        primaryAction: null,
        primaryLabelKey: 'updater.installingRestart',
        showReleaseLink: false,
        statusKey: 'settings.updateStatusInstalling',
        statusTone: 'neutral',
      };
    case 'error': {
      const canRetryInstall = model.status.downloadPath != null
        && (model.canOpenInstaller || model.canApplyInPlace);
      const primaryAction: AboutUpdatePrimaryAction = canRetryInstall
        ? 'install'
        : model.availableVersion != null && model.canDownload
          ? 'download'
          : 'check';
      return {
        primaryAction,
        primaryLabelKey: 'settings.updateRetry',
        showReleaseLink: true,
        // S31c(OPEND-2849):下载没完成就说下载没完成。这一格是版本号旁边的
        // 一枚短状态词,放得下的只有产品那格的标题;正文在更新弹窗里。
        statusKey: isUpdaterDownloadFailure(model.status) ? 'updater.downloadFailedTitle' : 'updater.failed',
        statusTone: 'error',
      };
    }
    case 'unsupported':
      return {
        primaryAction: null,
        primaryLabelKey: null,
        showReleaseLink: true,
        statusKey: 'settings.updateStatusUnsupported',
        statusTone: 'warning',
      };
    case 'idle':
    default:
      return {
        primaryAction: 'check',
        primaryLabelKey: 'settings.updateCheck',
        showReleaseLink: true,
        statusKey: 'settings.updateStatusNotChecked',
        statusTone: 'neutral',
      };
  }
}

interface Props {
  /**
   * How the settings surface is hosted. `'modal'` (default) renders the
   * classic dialog inside a backdrop; `'page'` renders the same surface as
   * the full-page `/settings` route — no backdrop, no dialog chrome, with a
   * back-to-home nav head above the section list.
   */
  presentation?: 'modal' | 'page';
  initial: AppConfig;
  agents: AgentInfo[];
  agentsLoading?: boolean;
  daemonLive: boolean;
  appVersionInfo: AppVersionInfo | null;
  welcome?: boolean;
  initialSection?: SettingsSection;
  /** Workspace id persisted on the currently-open project, when any. */
  persistedProjectWorkspaceId?: string | null;
  providerModelsCache?: ProviderModelsCache;
  /**
   * Persist the current draft. Invoked by the dialog's autosave loop on
   * every committed edit. Returns a promise that resolves once both
   * localStorage and the daemon have caught up so the footer status
   * indicator can flip from "Saving…" to "Saved". Should NOT close the
   * dialog and should NOT mutate onboarding state — it represents an
   * incremental save, not a final commit.
   */
  onPersist: (cfg: AppConfig, options?: { forceMediaProviderSync?: boolean }) => Promise<void> | void;
  /** Explicit selection intent, including clicking the already-selected CLI. */
  onAgentSelect?: (agentId: string) => void;
  /**
   * Non-optimistic write for the daemon-owned silent-update preference.
   * Settings → About uses this instead of the generic autosave path so a
   * failed `/api/app-config` cannot leave app-wide config on the rejected value.
   */
  onSilentUpdatePreferenceChange?: (allowSilentUpdates: boolean) => Promise<void>;
  onDraftChange?: (cfg: AppConfig) => void;
  onClose: () => void;
  /** Hand the explicit onboarding reset back to App, the config state owner. */
  onResetOnboarding?: (next: AppConfig) => void;
  onRefreshAgents: (
    options?: AgentRefreshOptions,
  ) => AgentInfo[] | Promise<AgentInfo[] | void> | void;

  /** Clear app-owned execution state after a confirmed active Cloud sign-out. */

  daemonMediaProviders?: AppConfig['mediaProviders'] | null;
  daemonMediaProvidersFetchState?: 'idle' | 'ok' | 'error';
  mediaProvidersNotice?: string | null;
  onReloadMediaProviders?: () => Promise<AppConfig['mediaProviders'] | null>;
  onProjectsRefresh?: () => Promise<void> | void;
  /** Same channel for skill registry mutations. */
  onSkillsChanged?: (affectedSkillId?: string) => void;
  /** Re-reads the skill registry after the Skills page creates, edits or deletes one. */
  onSkillsRefresh?: () => Promise<void> | void;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<ProviderModelsCache>>;
  /** Leaves Settings for the top-level Integrations view (external MCP, skills). */
  onOpenIntegrations?: () => void;
}

function telemetryPrefsEqual(
  a: AppConfig['telemetry'],
  b: AppConfig['telemetry'],
): boolean {
  return a?.metrics === b?.metrics;
}

export interface AgentRefreshOptions {
  throwOnError?: boolean;
  agentCliEnv?: AppConfig['agentCliEnv'];
}



function codexPathStrings(locale: Locale) {
  if (locale === 'zh-CN') {
    return {
      repairHint: '当前保存的 Codex 路径不适合继续使用。',
      useDetected: '使用检测到的 Codex',
      clearCustom: '清空自定义路径',
      configuredSuccess: (path: string) => `本次测试使用的是已配置的 Codex 路径：${path}。`,
      invalidFallback: (configuredPath: string, detectedPath: string) =>
        `已配置的 Codex 路径无效或不可执行：${configuredPath}。本次测试改用 PATH 中的 Codex CLI：${detectedPath}。建议更新 CODEX_BIN 或清空自定义路径。`,
      failedFallback: (configuredPath: string, detectedPath: string) =>
        `已配置的 Codex 路径启动失败：${configuredPath}。本次测试改用 PATH 中的 Codex CLI：${detectedPath}。建议更新 CODEX_BIN 或清空自定义路径。`,
    };
  }
  return {
    repairHint: 'The saved Codex path is not the binary this test should keep using.',
    useDetected: 'Use detected Codex',
    clearCustom: 'Clear custom path',
    configuredSuccess: (path: string) =>
      `This test used the configured Codex path: ${path}.`,
    invalidFallback: (configuredPath: string, detectedPath: string) =>
      `Configured Codex path is invalid or not executable: ${configuredPath}. This test used the PATH Codex CLI at ${detectedPath}. Update CODEX_BIN or clear the custom path to use the detected binary.`,
    failedFallback: (configuredPath: string, detectedPath: string) =>
      `Configured Codex path failed: ${configuredPath}. This test succeeded with the PATH Codex CLI at ${detectedPath}. Update CODEX_BIN or clear the custom path to use the detected binary.`,
  };
}

function sanitizeHttpsUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

type RescanNotice =
  | { kind: 'success'; count: number }
  | { kind: 'error' };

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: ConnectionTestResponse };

// Providers whose live model fetch IS their full account catalogue, so the
// per-option "from your account" badge and the "Loaded N from your account"
// hint are noise — every option carries the same badge and distinguishes
// nothing. For these we drop the source label and show a plain count instead.
// Add a protocol here when the same applies to another provider.
const ACCOUNT_MODEL_SOURCE_LABEL_HIDDEN = new Set<ApiProtocol>([
  'aihubmix',
  'bedrock',
]);

function hidesAccountModelSourceLabel(protocol: ApiProtocol): boolean {
  return ACCOUNT_MODEL_SOURCE_LABEL_HIDDEN.has(protocol);
}

// Fixed-origin gateway helpers (isFixedOriginGateway / resolveFixedOriginBaseUrl)
// live in ../state/apiProtocols so config loading and the top-bar switcher share
// the same single source of truth.

type ProviderModelsState =
  | { status: 'idle' }
  | { status: 'running'; cacheKey: string }
  | { status: 'done'; cacheKey: string; result: ProviderModelsResponse };

interface ByokProviderFormDraft {
  apiConfig: ApiProtocolConfig;
  maxTokensInput: string;
  maxTokens: AppConfig['maxTokens'];
  providerModelsCommittedKey: string | null;
  providerModelsState: ProviderModelsState;
  showApiKey: boolean;
  apiModelCustomEditing: boolean;
  apiModelUserSelected: boolean;
}

type ByokRequiredField = ByokDraftField;
type ByokPreconditionAction = 'test';
type ByokFieldMissing = 'api_key' | 'base_url' | 'model' | 'multiple' | 'none';

function byokFieldMissingFromIssues(issues: readonly ByokDraftIssue[]): ByokFieldMissing {
  const missingFields = new Set<ByokRequiredField>();
  for (const issue of issues) {
    if (
      issue.code === 'api_key_required' ||
      issue.code === 'base_url_required' ||
      issue.code === 'model_required'
    ) {
      missingFields.add(issue.field);
    }
  }
  if (missingFields.size === 0) return 'none';
  if (missingFields.size > 1) return 'multiple';
  return Array.from(missingFields)[0] ?? 'none';
}

function byokErrorKindFromIssues(issues: readonly ByokDraftIssue[]): string | undefined {
  return issues[0]?.code;
}

function byokTrackingTestResult(result: ConnectionTestResponse): 'success' | 'failed' | 'timeout' {
  if (result.ok) return 'success';
  return result.kind === 'timeout' ? 'timeout' : 'failed';
}

// Map a test result to the visual severity of its inline status node so
// the same green/red/amber palette as the Rescan status applies.
export function testStatusVariant(
  result: ConnectionTestResponse,
): 'success' | 'warn' | 'error' {
  if (result.ok) return 'success';
  if (result.kind === 'rate_limited') return 'warn';
  return 'error';
}

export function shouldShowCustomModelInput(
  modelValue: string,
  knownModelIds: readonly string[],
  explicitCustomMode: boolean,
): boolean {
  return (
    explicitCustomMode ||
    !modelValue ||
    !knownModelIds.includes(modelValue)
  );
}

export function canRunProviderConnectionTest(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl' | 'model'>,
  options: { requiresApiKey?: boolean } = {},
): boolean {
  const requiresApiKey = options.requiresApiKey ?? true;
  return (
    (!requiresApiKey || Boolean(config.apiKey.trim())) &&
    Boolean(config.baseUrl.trim()) &&
    Boolean(config.model.trim())
  );
}

export function canFetchProviderModels(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl'>,
  protocol: ApiProtocol,
): boolean {
  return (
    !isProviderModelDiscoveryUnsupported(protocol, config.baseUrl) &&
    protocol !== 'azure' &&
    protocol !== 'ollama' &&
    (protocol === 'bedrock' || Boolean(config.apiKey.trim())) &&
    Boolean(config.baseUrl.trim()) &&
    isValidApiBaseUrl(config.baseUrl)
  );
}

export function isProviderModelDiscoveryUnsupported(
  protocol: ApiProtocol,
  baseUrl: string,
): boolean {
  if (protocol === 'azure' || protocol === 'ollama') return true;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'token-plan-cn.xiaomimimo.com';
  } catch {
    return false;
  }
}

function missingByokConnectionFields(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl' | 'model'>,
  options: { requiresApiKey?: boolean } = {},
): ByokRequiredField[] {
  const requiresApiKey = options.requiresApiKey ?? true;
  const missing: ByokRequiredField[] = [];
  if (requiresApiKey && !config.apiKey.trim()) missing.push('api_key');
  if (!config.baseUrl.trim()) missing.push('base_url');
  if (!config.model.trim()) missing.push('model');
  return missing;
}

function missingByokModelFetchFields(
  config: Pick<AppConfig, 'apiKey' | 'baseUrl'>,
  protocol?: ApiProtocol,
): ByokRequiredField[] {
  const missing: ByokRequiredField[] = [];
  // AIHubMix publishes its catalogue on a public endpoint, so its model list
  // loads without a key (the user shouldn't need to paste a key just to browse
  // models). Bedrock uses a static model seed until AWS auth lands in BYOK.
  // Every other protocol fetches /v1/models behind the key.
  if (protocol !== 'aihubmix' && protocol !== 'bedrock' && !config.apiKey.trim()) missing.push('api_key');
  if (!config.baseUrl.trim()) missing.push('base_url');
  return missing;
}

function providerConnectionTestKey(
  protocol: ApiProtocol,
  config: Pick<AppConfig, 'apiKey' | 'baseUrl' | 'model' | 'apiVersion'>,
): string {
  return [
    protocol,
    config.baseUrl.trim().replace(/\/+$/, ''),
    config.apiKey.trim(),
    config.model.trim(),
    protocol === 'azure' ? config.apiVersion?.trim() ?? '' : '',
  ].join('\n');
}

type ByokFirstPartyBaseUrlHint = {
  baseUrl: string;
  hostTypo: boolean;
};

function byokFirstPartyBaseUrlHint(
  protocol: ApiProtocol,
  baseUrl: string,
  protocolProviders: readonly KnownProvider[],
): ByokFirstPartyBaseUrlHint | undefined {
  if (
    protocol !== 'anthropic' &&
    protocol !== 'openai' &&
    protocol !== 'google'
  ) {
    return undefined;
  }
  const firstPartyBaseUrl = protocolProviders.find(
    (provider) => provider.baseUrl.trim(),
  )?.baseUrl;
  if (!firstPartyBaseUrl) return undefined;

  const firstPartyHost = byokDraftBaseUrlHost(firstPartyBaseUrl);
  const draftHost = byokDraftBaseUrlHost(baseUrl);
  if (!firstPartyHost || !draftHost) return undefined;
  if (draftHost === firstPartyHost) {
    return { baseUrl: firstPartyBaseUrl, hostTypo: false };
  }
  if (!draftHost.startsWith(firstPartyHost)) return undefined;

  const suffix = draftHost.slice(firstPartyHost.length);
  return suffix && !suffix.startsWith('.')
    ? { baseUrl: firstPartyBaseUrl, hostTypo: true }
    : undefined;
}

function byokDraftBaseUrlHost(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

const API_KEY_CONSOLE_LINKS: Record<ApiProtocol, { host: string; url: string }> = {
  anthropic: {
    host: 'console.anthropic.com',
    url: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    host: 'platform.openai.com',
    url: 'https://platform.openai.com/api-keys',
  },
  azure: {
    host: 'portal.azure.com',
    url: 'https://portal.azure.com/',
  },
  google: {
    host: 'aistudio.google.com',
    url: 'https://aistudio.google.com/apikey',
  },
  ollama: {
    host: 'ollama.com',
    url: 'https://ollama.com/settings/keys',
  },
  senseaudio: {
    host: 'docs.senseaudio.cn',
    url: 'https://docs.senseaudio.cn',
  },
  aihubmix: {
    host: 'aihubmix.com',
    url: 'https://aihubmix.com/?aff=JA1e',
  },
  bedrock: {
    host: 'aws.amazon.com',
    url: 'https://aws.amazon.com/bedrock/',
  },
};

const AGENT_SHORT_DESCRIPTION_KEYS: Partial<Record<string, keyof Dict>> = {
  claude: 'settings.agentShort.claude',
  codex: 'settings.agentShort.codex',
  opencode: 'settings.agentShort.opencode',
};

function agentShortDescription(agentId: string, t: (key: keyof Dict) => string): string | undefined {
  const key = AGENT_SHORT_DESCRIPTION_KEYS[agentId];
  return key ? t(key) : undefined;
}

function cleanAgentVersionLabel(
  name: string,
  version: string | null | undefined,
): string {
  if (!version) return '';
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return version
    .replace(new RegExp(`\\s*\\(${escapedName}\\)\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s+${escapedName}\\s*$`, 'i'), '')
    .trim();
}

function displayAgentName(agent: Pick<AgentInfo, 'id' | 'name'>): string {
  return agent.name;
}

const AGENT_CLI_ENV_FIELDS = [
  {
    agentId: 'claude',
    envKey: 'CLAUDE_CONFIG_DIR',
    labelKey: 'settings.cliEnvClaudeConfigDir',
    placeholder: '~/.claude-2',
  },
  {
    agentId: 'claude',
    envKey: 'ANTHROPIC_BASE_URL',
    labelKey: 'settings.cliEnvClaudeBaseUrl',
    placeholder: 'https://your-proxy.example.com',
  },
  {
    agentId: 'claude',
    envKey: 'ANTHROPIC_API_KEY',
    labelKey: 'settings.cliEnvClaudeApiKey',
    pasteName: 'CLI API key',
    secret: true,
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_HOME',
    labelKey: 'settings.cliEnvCodexHome',
    placeholder: '~/.codex-alt',
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_BIN',
    labelKey: 'settings.cliEnvCodexBin',
    placeholder: '/absolute/path/to/codex',
  },
  {
    agentId: 'codex',
    envKey: 'OPENAI_BASE_URL',
    labelKey: 'settings.cliEnvCodexBaseUrl',
    placeholder: 'https://your-proxy.example.com/v1',
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_API_KEY',
    labelKey: 'settings.cliEnvCodexApiKey',
    labelSuffix: 'CODEX_API_KEY',
    pasteName: 'CODEX_API_KEY',
    secret: true,
  },
  {
    agentId: 'codex',
    envKey: 'OPENAI_API_KEY',
    labelKey: 'settings.cliEnvCodexApiKey',
    labelSuffix: 'OPENAI_API_KEY',
    pasteName: 'OPENAI_API_KEY',
    secret: true,
  },
] as const;

function persistByokProviderConfigDraft(
  config: AppConfig,
  draftKey: string,
  apiConfig: ApiProtocolConfig,
): AppConfig {
  return {
    ...config,
    byokProviderConfigDrafts: {
      ...(config.byokProviderConfigDrafts ?? {}),
      [draftKey]: {
        apiConfig,
        maxTokens: config.maxTokens,
      },
    },
  };
}

function byokProviderDraftKey(
  protocol: ApiProtocol,
  apiProviderBaseUrl: string | null | undefined,
  baseUrl: string,
): string {
  return `${protocol}:${apiProviderBaseUrl ?? `custom:${baseUrl}`}`;
}

function byokProviderKeyForConfig(config: AppConfig): string {
  const apiConfig = currentApiProtocolConfig(config);
  return byokProviderDraftKey(
    config.apiProtocol ?? 'anthropic',
    apiConfig.apiProviderBaseUrl,
    apiConfig.baseUrl,
  );
}

/**
 * Keeps an incomplete replacement BYOK form durable without promoting it to
 * the active execution config. The selected provider's current fields are
 * stored under `byokProviderConfigDrafts`; the last successfully persisted
 * execution mode and BYOK projection stay active until the replacement is
 * complete.
 */
export function resolveSettingsAutosavePayload(
  draft: AppConfig,
  active: AppConfig,
  intent: { commitClearedActiveApiKey?: boolean } = {},
): AppConfig {
  if (draft.mode !== 'api') return draft;
  if (byokPreflightBlockReason(draft) === null) {
    if (!draft.byokPendingProviderKey) return draft;
    return { ...draft, byokPendingProviderKey: undefined };
  }

  const draftKey = byokProviderKeyForConfig(draft);
  const clearsActiveApiKey =
    intent.commitClearedActiveApiKey === true
    && active.mode === 'api'
    && draftKey === byokProviderKeyForConfig(active)
    && active.apiKey.trim() !== ''
    && draft.apiKey.trim() === '';
  if (clearsActiveApiKey) {
    if (!draft.byokPendingProviderKey) return draft;
    return { ...draft, byokPendingProviderKey: undefined };
  }

  const withCurrentDraft = persistByokProviderConfigDraft(
    draft,
    draftKey,
    currentApiProtocolConfig(draft),
  );
  return {
    ...withCurrentDraft,
    byokPendingProviderKey: draftKey,
    mode: active.mode,
    apiKey: active.apiKey,
    apiProtocol: active.apiProtocol,
    apiVersion: active.apiVersion,
    apiProviderBaseUrl: active.apiProviderBaseUrl,
    apiProtocolConfigs: active.apiProtocolConfigs,
    baseUrl: active.baseUrl,
    model: active.model,
    byokImageModel: active.byokImageModel,
    byokVideoModel: active.byokVideoModel,
    byokSpeechModel: active.byokSpeechModel,
    byokSpeechVoice: active.byokSpeechVoice,
    maxTokens: active.maxTokens,
  };
}

function apiProtocolFromProviderDraftKey(draftKey: string): ApiProtocol | null {
  const separator = draftKey.indexOf(':');
  if (separator <= 0) return null;
  const protocol = draftKey.slice(0, separator);
  return API_PROTOCOL_TABS.some((tab) => tab.id === protocol)
    ? (protocol as ApiProtocol)
    : null;
}

function restorePendingByokProviderDraft(config: AppConfig): AppConfig {
  const currentDraftKey = byokProviderKeyForConfig(config);
  const candidateKeys = config.byokPendingProviderKey
    ? [config.byokPendingProviderKey, currentDraftKey]
    : [currentDraftKey];
  for (const draftKey of candidateKeys) {
    const draft = config.byokProviderConfigDrafts?.[draftKey];
    const protocol = apiProtocolFromProviderDraftKey(draftKey);
    if (!draft || !protocol) continue;
    return applyApiProtocolConfig(
      {
        ...config,
        maxTokens: draft.maxTokens,
      },
      protocol,
      draft.apiConfig,
    );
  }
  return config;
}

export function isValidApiBaseUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  const result = validateBaseUrl(trimmed);
  // The internal-IP / SSRF decision belongs to the daemon, which is the single
  // source of truth and honors the operator's PIXO_ALLOWED_INTERNAL_HOSTS
  // allowlist — a value the browser cannot see (#3225). A `forbidden` result
  // here is a syntactically-valid URL that points at an internal address; keep
  // it UI-valid so the operator can run the connection test / model fetch and
  // get the daemon's authoritative answer (allowed when listed, a clear
  // "Internal IPs blocked" otherwise). Only genuinely malformed URLs stay
  // invalid client-side.
  if (result.forbidden) return true;
  return Boolean(result.parsed && !result.error);
}

const AGENT_CLI_AUTH_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
]);
const AGENT_CLI_BASE_URL_ENV_KEYS = new Set(['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL']);

export function updateAgentCliEnvValue(
  config: AppConfig,
  agentId: string,
  envKey: string,
  rawValue: string,
): AppConfig {
  const value = rawValue.trim();
  const agentCliEnv = { ...(config.agentCliEnv ?? {}) };
  const agentCliEnvIntent = { ...(config.agentCliEnvIntent ?? {}) };
  const nextAgentEnv = { ...(agentCliEnv[agentId] ?? {}) };
  const nextAgentIntent = { ...(agentCliEnvIntent[agentId] ?? {}) };
  if (value) {
    nextAgentEnv[envKey] = value;
  } else {
    delete nextAgentEnv[envKey];
  }

  const hasAuthKey = Object.keys(nextAgentEnv).some((key) => AGENT_CLI_AUTH_ENV_KEYS.has(key));
  if (
    (AGENT_CLI_AUTH_ENV_KEYS.has(envKey) && value) ||
    (AGENT_CLI_BASE_URL_ENV_KEYS.has(envKey) && hasAuthKey)
  ) {
    nextAgentIntent.apiKeyOverride = true;
  } else if (AGENT_CLI_AUTH_ENV_KEYS.has(envKey) && !hasAuthKey) {
    delete nextAgentIntent.apiKeyOverride;
  }

  if (Object.keys(nextAgentEnv).length > 0) {
    agentCliEnv[agentId] = nextAgentEnv;
  } else {
    delete agentCliEnv[agentId];
  }

  if (Object.keys(nextAgentEnv).length > 0 && Object.keys(nextAgentIntent).length > 0) {
    agentCliEnvIntent[agentId] = nextAgentIntent;
  } else {
    delete agentCliEnvIntent[agentId];
  }

  return {
    ...config,
    agentCliEnv: Object.keys(agentCliEnv).length > 0 ? agentCliEnv : {},
    agentCliEnvIntent: Object.keys(agentCliEnvIntent).length > 0 ? agentCliEnvIntent : {},
  };
}


export function agentRefreshOptionsForConfig(cfg: AppConfig): AgentRefreshOptions {
  return {
    throwOnError: true,
    agentCliEnv: cfg.agentCliEnv ?? {},
  };
}


function apiModelOptionLabel(
  model: ProviderModelOption,
  sourceLabel?: string,
): string {
  const baseLabel = model.label && model.label !== model.id
    ? `${model.label} (${model.id})`
    : model.id;
  return sourceLabel ? `${baseLabel} · ${sourceLabel}` : baseLabel;
}

function codexPathRepairState(
  result: ConnectionTestResponse,
): { detectedPath: string; canUseDetected: boolean } | null {
  if (!result.ok) return null;
  if (
    result.usedExecutableSource !== 'fallback_invalid' &&
    result.usedExecutableSource !== 'fallback_failed'
  ) {
    return null;
  }
  const detectedPath = result.detectedExecutablePath?.trim() || '';
  if (!detectedPath) return null;
  return {
    detectedPath,
    canUseDetected: true,
  };
}

/**
 * Returns whether the modal's footer Save button should be enabled for the
 * currently active sidebar section.
 *
 * The mode-completeness check (BYOK requires apiKey + model + valid baseUrl;
 * Local CLI requires a selected available agent) is only meaningful on the
 * execution-mode section, where the user is actively editing those fields.
 * On every other sidebar section (language, appearance, composio, media,
 * integrations, notifications, library, about), partial state from a
 * draft mode toggle (e.g. user clicked BYOK on the execution section without
 * filling in fields, then navigated to language) must NOT block saving
 * changes the user is making in those unrelated sections. Issue #739.
 */
export function shouldEnableSettingsSave(
  cfg: AppConfig,
  activeSection: SettingsSection,
  agents: ReadonlyArray<{ id: string; available: boolean }>,
  isBaseUrlValid: boolean,
): boolean {
  if (activeSection !== 'execution') return true;
  if (cfg.mode === 'daemon') {
    return Boolean(
      cfg.agentId && agents.find((a) => a.id === cfg.agentId)?.available,
    );
  }
  return Boolean(cfg.apiKey.trim() && cfg.model.trim() && isBaseUrlValid);
}

/**
 * Returns the config that should actually be persisted by `onSave`.
 *
 * Counterpart to {@link shouldEnableSettingsSave}: when Save is enabled on a
 * non-execution sidebar section but the user's draft execution config is
 * incomplete (e.g. they toggled BYOK on the execution section, never filled
 * in apiKey, then navigated to Language and clicked Save), the raw `cfg`
 * still carries that broken draft. Persisting it would leave the app in an
 * unusable execution state after the modal closes. This helper reverts the
 * execution-related fields to their `initial` values in that case, so saving
 * an unrelated section change never silently commits an incomplete execution
 * mode.
 *
 * Within the execution section, or when execution is already valid, the
 * config passes through unchanged. Issue #739.
 */
export function sanitizeSettingsSavePayload(
  cfg: AppConfig,
  initial: AppConfig,
  activeSection: SettingsSection,
  agents: ReadonlyArray<{ id: string; available: boolean }>,
  isBaseUrlValid: boolean,
): AppConfig {
  if (activeSection === 'execution') return cfg;
  // Reuse the existing execution-section validity gate so the two helpers
  // share one source of truth for "execution config is complete enough."
  const executionValid = shouldEnableSettingsSave(cfg, 'execution', agents, isBaseUrlValid);
  if (executionValid) return cfg;
  return {
    ...cfg,
    mode: initial.mode,
    apiKey: initial.apiKey,
    apiProtocol: initial.apiProtocol,
    apiVersion: initial.apiVersion,
    apiProtocolConfigs: initial.apiProtocolConfigs,
    byokProviderConfigDrafts: initial.byokProviderConfigDrafts,
    byokPendingProviderKey: initial.byokPendingProviderKey,
    apiProviderBaseUrl: initial.apiProviderBaseUrl,
    baseUrl: initial.baseUrl,
    model: initial.model,
    agentId: initial.agentId,
    agentCliEnv: initial.agentCliEnv,
    maxTokens: initial.maxTokens,
  };
}

export function SettingsDialog({
  presentation = 'modal',
  initial,
  agents,
  agentsLoading = false,
  daemonLive,
  appVersionInfo,
  welcome,
  initialSection = 'general',
  persistedProjectWorkspaceId = null,
  onPersist,
  onAgentSelect,
  onSilentUpdatePreferenceChange,
  onClose: onDismiss,
  onResetOnboarding,
  onRefreshAgents,


  daemonMediaProviders,
  daemonMediaProvidersFetchState = 'idle',
  mediaProvidersNotice,
  onReloadMediaProviders,
  onProjectsRefresh,
  providerModelsCache: sharedProviderModelsCache,
  onProviderModelsCacheChange,
  onDraftChange,
  onOpenIntegrations,
  onSkillsChanged,
  onSkillsRefresh,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(true);
  const onClose = () => { if (presentation === 'page') onDismiss(); else setDialogOpen(false); };
  const { t, locale, setLocale } = useI18n();
  const analytics = useAnalytics();
  // Backfill the fixed-origin base URL on mount too, so a config persisted with
  // an empty baseUrl (e.g. selected AIHubMix before this resolution existed)
  // isn't stuck blocking the live model fetch until the user re-selects the tab.
  const normalizedInitialConfig: AppConfig = {
    ...initial,
    baseUrl: resolveFixedOriginBaseUrl(initial.apiProtocol ?? 'anthropic', initial.baseUrl),
  };
  const initialFormConfig = initial.mode === 'api'
    ? restorePendingByokProviderDraft(normalizedInitialConfig)
    : normalizedInitialConfig;
  const [cfg, setCfg] = useState<AppConfig>(() => initialFormConfig);
  const [maxTokensInput, setMaxTokensInput] = useState(
    initialFormConfig.maxTokens == null ? '' : String(initialFormConfig.maxTokens),
  );
  const [pendingMediaProviderEditIds, setPendingMediaProviderEditIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const previousInitialRef = useRef(initial);
  // Accent only — the theme is a constant now that the app ships light-only.
  const lastSavedAppearanceRef = useRef({
    accentColor: resolveAccentColor(initial.accentColor),
  });

  useEffect(() => {
    onDraftChange?.(cfg);
  }, [cfg, onDraftChange]);

  // settings_view — fire on dialog open and on every section switch so the
  // configuration funnel can see which section the user spent time in.
  // The fire is keyed on section so a section bounce (open → switch →
  // close) emits one event per surface.
  const lastViewSectionRef = useRef<string | null>(null);

  useEffect(() => {
    lastSavedAppearanceRef.current = {
      accentColor: resolveAccentColor(initial.accentColor),
    };
  }, [initial.accentColor]);

  useEffect(() => {
    const previousInitial = previousInitialRef.current;
    const parentPrivacyChanged =
      previousInitial.installationId !== initial.installationId ||
      previousInitial.privacyDecisionAt !== initial.privacyDecisionAt ||
      !telemetryPrefsEqual(previousInitial.telemetry, initial.telemetry);
    setCfg((current) => {
      const nextAgentCliEnv = current.agentCliEnv;
      const nextAgentModels = current.agentModels;
      if (
        nextAgentCliEnv === current.agentCliEnv
        && nextAgentModels === current.agentModels
        && !parentPrivacyChanged
      ) {
        return current;
      }
      return {
        ...current,
        agentCliEnv: nextAgentCliEnv,
        agentModels: nextAgentModels,
        ...(parentPrivacyChanged
          ? {
              installationId: initial.installationId,
              privacyDecisionAt: initial.privacyDecisionAt,
              telemetry: initial.telemetry ? { ...initial.telemetry } : undefined,
            }
          : {}),
      };
    });
    autosaveLastSavedRef.current = {
      ...autosaveLastSavedRef.current,
      agentCliEnv: autosaveLastSavedRef.current.agentCliEnv,
      agentModels: autosaveLastSavedRef.current.agentModels,
      ...(parentPrivacyChanged
        ? {
            installationId: initial.installationId,
            privacyDecisionAt: initial.privacyDecisionAt,
            telemetry: initial.telemetry ? { ...initial.telemetry } : undefined,
          }
        : {}),
    };
    previousInitialRef.current = initial;
  }, [initial]);

  // Revert the live theme preview to the most recently persisted appearance.
  // That is the initial appearance until autosave succeeds; after autosave,
  // closing Settings must not roll the document back to stale colors.
  useLayoutEffect(() => {
    return () => {
      applyAppearanceToDocument(lastSavedAppearanceRef.current);
    };
  }, []);
  const [showApiKey, setShowApiKey] = useState(false);
  const byokProviderFormDraftsRef = useRef<Record<string, ByokProviderFormDraft>>({});
  const lastCustomByokProviderDraftKeysRef = useRef<Partial<Record<ApiProtocol, string>>>(
    (initial.apiProviderBaseUrl ?? null) === null
      ? { [initial.apiProtocol ?? 'anthropic']: byokProviderKeyForConfig(initial) }
      : {},
  );
  const [activeSection, setActiveSection] = useState<SettingsPage>(() => resolveSettingsDeepLink(initialSection).page);
  // Block a deep link asked for (e.g. `notifications` inside General); scrolled
  // into view once that page has rendered, then cleared.
  const [pendingAnchor, setPendingAnchor] = useState<SettingsAnchor | null>(
    () => resolveSettingsDeepLink(initialSection).anchor ?? null,
  );
  const openPixoAccount = useOpenPixoAccount();

  const [settingsSidebarCollapsed, setSettingsSidebarCollapsed] = useState(false);
  const [settingsFullscreen, setSettingsFullscreen] = useState(true);
  // Scroll the right-hand content pane back to the top whenever the user
  // picks a different settings section. Without this, switching from a
  // long section the user had scrolled (e.g. Library) into a short one
  // (About) keeps the previous scrollTop, so the new section's header
  // can land out of view and the panel reads as half-loaded. Issue #634.
  const settingsContentRef = useRef<HTMLDivElement | null>(null);

  const [agentRescanRunning, setAgentRescanRunning] = useState(false);
  const [agentRescanNotice, setAgentRescanNotice] =
    useState<RescanNotice | null>(null);
  const [agentTestState, setAgentTestState] = useState<TestState>({
    status: 'idle',
  });




  const [providerTestState, setProviderTestState] = useState<TestState>({
    status: 'idle',
  });




  const [byokPreconditionNotice, setByokPreconditionNotice] = useState<{
    action: ByokPreconditionAction;
    field?: ByokRequiredField;
    message: string;
  } | null>(null);
  const [providerModelsState, setProviderModelsState] =
    useState<ProviderModelsState>({ status: 'idle' });
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
  const [providerModelsCommittedKey, setProviderModelsCommittedKey] =
    useState<string | null>(() => {
      const protocol = initial.apiProtocol ?? 'anthropic';
      if (
        initial.mode !== 'api' ||
        protocol === 'azure' ||
        protocol === 'ollama' ||
        missingByokModelFetchFields(initial, protocol).length > 0 ||
        !isValidApiBaseUrl(initial.baseUrl)
      ) {
        return null;
      }
      return providerModelsCacheKey(
        protocol,
        initial.baseUrl,
        initial.apiKey,
        initial.apiVersion ?? '',
      );
    });
  const agentTestAbortRef = useRef<AbortController | null>(null);
  const providerTestAbortRef = useRef<AbortController | null>(null);
  const providerModelsAbortRef = useRef<AbortController | null>(null);
  const pendingAgentInstallRescanRef = useRef(false);

  const agentTestRevisionRef = useRef(0);
  const providerTestRevisionRef = useRef(0);
  const providerModelsRevisionRef = useRef(0);
  const providerTestFirstResetRef = useRef(true);
  const providerTestSkipNextResetRef = useRef(false);
  const providerModelsFirstResetRef = useRef(true);
  const providerModelsSkipNextResetRef = useRef(false);
  const deferAfterKeyCleanRef = useRef(false);
  const providerAutoTestKeyRef = useRef<string | null>(null);
  const byokLastUnsuccessfulTestKeyRef = useRef<string | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const baseUrlInputRef = useRef<HTMLInputElement | null>(null);
  const modelSelectRef = useRef<HTMLButtonElement | null>(null);
  const customModelInputRef = useRef<HTMLInputElement | null>(null);
  const focusByokRequiredFieldAfterProtocolSwitchRef = useRef(false);
  const visualStabilityMode = isVisualStabilityMode();
  // Tracks whether the current BYOK model value came from an explicit user
  // pick (combobox selection or custom entry) rather than an auto-populated
  // provider preset. The account-model auto-switch must never overwrite a
  // deliberate choice, even when that choice equals the provider preset id.
  const apiModelUserSelectedRef = useRef(false);
  const [apiModelCustomEditing, setApiModelCustomEditing] = useState(false);
  const [agentCustomModelIds, setAgentCustomModelIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [aboutUpdaterModel, setAboutUpdaterModel] = useState<UpdaterModel>(() => deriveUpdaterModel(null));
  const [aboutUpdateActionBusy, setAboutUpdateActionBusy] = useState(false);
  const [aboutUpdateQuitFailed, setAboutUpdateQuitFailed] = useState(false);
  const [aboutToast, setAboutToast] = useState<string | null>(null);
  // Two-stage inline confirm for the destructive manual cache clear.
  const [clearUpdaterCacheStage, setClearUpdaterCacheStage] = useState<'idle' | 'confirm'>('idle');
  const [clearUpdaterCacheBusy, setClearUpdaterCacheBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeToUpdaterStatus((status) => {
      if (!mounted) return;
      const nextModel = deriveUpdaterModel(status, { hostAvailable: true });
      setAboutUpdaterModel(nextModel);
      if (!nextModel.installerOpened) setAboutUpdateQuitFailed(false);
    });
    void readUpdaterStatus({ payload: { source: 'settings-about:mount' } }).then((result) => {
      if (!mounted) return;
      const nextModel = result.ok ? result.model : deriveUpdaterModel(null, { hostAvailable: false });
      setAboutUpdaterModel(nextModel);
      if (!nextModel.installerOpened) setAboutUpdateQuitFailed(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const aboutUpdateControl = useMemo(() => {
    const control = deriveAboutUpdateControl(aboutUpdaterModel, appVersionInfo);
    if (!aboutUpdateQuitFailed || !aboutUpdaterModel.installerOpened) return control;
    return {
      ...control,
      primaryAction: 'quit' as const,
      primaryLabelKey: 'updater.quitButton' as const,
      showReleaseLink: false,
      statusKey: 'updater.quitFailedTitle' as const,
      statusTone: 'warning' as const,
    };
  }, [aboutUpdateQuitFailed, aboutUpdaterModel, appVersionInfo]);

  // Restart-safety preflight denials stay hard-blocked in Settings → About
  // (the force path lives in the app-menu UpdateDialog), but the toast must
  // explain the active-run situation instead of a generic failure.
  const aboutUpdaterToastText = useCallback(
    (safety: UpdaterRestartSafety | null, fallback: string): string => {
      if (safety == null) return fallback;
      return safety.state === 'blocked'
        ? t('updater.activeRunsBody', { count: safety.activeRunCount })
        : t('updater.activeRunsUnknownBody');
    },
    [t],
  );

  const applyAboutUpdaterResult = useCallback((result: UpdaterActionResult): boolean => {
    if (!result.ok) {
      setAboutToast(t('settings.updateActionFailed'));
      return false;
    }
    setAboutUpdaterModel(result.model);
    if (result.model.errorMessage != null) {
      const safety = restartSafetyFromUpdaterStatus(result.status);
      setAboutToast(aboutUpdaterToastText(safety, t('settings.updateActionFailed')));
      return false;
    }
    return true;
  }, [aboutUpdaterToastText, t]);

  const handleAboutUpdateAction = useCallback(async () => {
    if (aboutUpdateActionBusy || aboutUpdaterModel.busy || aboutUpdateControl.primaryAction == null) return;
    setAboutUpdateActionBusy(true);
    setAboutUpdateQuitFailed(false);
    let quitAttempted = false;
    try {
      const options = { payload: { source: 'settings-about' } };
      if (aboutUpdateControl.primaryAction === 'check') {
        applyAboutUpdaterResult(await checkForUpdaterUpdate(options));
      } else if (aboutUpdateControl.primaryAction === 'download') {
        applyAboutUpdaterResult(await downloadUpdaterUpdate(options));
      } else if (aboutUpdateControl.primaryAction === 'quit') {
        quitAttempted = true;
        const quitResult = await quitAfterUpdaterInstallerOpen(options);
        if (!quitResult.ok) {
          setAboutUpdateQuitFailed(true);
          setAboutToast(aboutUpdaterToastText(restartSafetyFromActionResult(quitResult), t('updater.quitFailedTitle')));
        }
      } else {
        const installed = applyAboutUpdaterResult(await openUpdaterInstaller(options));
        if (installed) {
          quitAttempted = true;
          const quitResult = await quitAfterUpdaterInstallerOpen(options);
          if (!quitResult.ok) {
            setAboutUpdateQuitFailed(true);
            setAboutToast(aboutUpdaterToastText(restartSafetyFromActionResult(quitResult), t('updater.quitFailedTitle')));
          }
        }
      }
    } catch {
      if (quitAttempted) setAboutUpdateQuitFailed(true);
      setAboutToast(t('settings.updateActionFailed'));
    } finally {
      setAboutUpdateActionBusy(false);
    }
  }, [
    aboutUpdateActionBusy,
    aboutUpdateControl.primaryAction,
    aboutUpdaterModel.busy,
    aboutUpdaterToastText,
    applyAboutUpdaterResult,
    t,
  ]);

  const handleOpenReleaseNotes = useCallback(() => {
    void openExternalUrl(localizedProductPage(PRODUCT_RELEASES_URL, locale));
  }, [locale]);

  // Manual updater/launcher cache clear — the disaster-recovery action for
  // stuck update state. The desktop owns the capability; this handler only
  // reports the outcome and refreshes the About updater model.
  const handleClearUpdaterCache = useCallback(() => {
    if (clearUpdaterCacheBusy) return;
    setClearUpdaterCacheBusy(true);
    void (async () => {
      try {
        const result = await clearUpdaterCache();
        if (result.ok) {
          setAboutUpdaterModel(result.model);
          setAboutToast(t('settings.clearUpdaterCacheSuccess'));
        } else {
          setAboutToast(t('settings.clearUpdaterCacheFailed'));
        }
      } finally {
        setClearUpdaterCacheBusy(false);
        setClearUpdaterCacheStage('idle');
      }
    })();
  }, [clearUpdaterCacheBusy, t]);


  // Imperative handle for the External MCP section. The dialog footer Save
  // routes through this when the MCP tab is active so the user can press the
  // single Save button at the bottom instead of hunting for the inner one.
  useEffect(() => {
    const link = resolveSettingsDeepLink(initialSection);
    setActiveSection(link.page);
    setPendingAnchor(link.anchor ?? null);
  }, [initialSection]);

  // settings_view — fires whenever the active section changes (and once on
  // mount). Keying the fire on a section+section-string lets us dedupe
  // accidental double-renders while still capturing genuine tab switches.
  useEffect(() => {
    if (lastViewSectionRef.current === activeSection) return;
    lastViewSectionRef.current = activeSection;
    // v2 settings_view collapses to `{ page=settings, area }`; the
    // execution_mode / has_available_cli / selected_cli_id signal that v1
    // tagged onto every view now lives in the configure-state global
    // properties (registered once and inherited by every event).
    trackSettingsView(analytics.track, {
      page_name: 'settings',
      area: settingsSectionToTracking(activeSection),
    });
  }, [activeSection, analytics.track]);
  useEffect(() => {
    const el = settingsContentRef.current;
    if (el) el.scrollTop = 0;
  }, [activeSection]);
  useEffect(() => {
    if (!pendingAnchor) return;
    const target = document.getElementById(settingsAnchorId(pendingAnchor));
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    setPendingAnchor(null);
  }, [activeSection, pendingAnchor]);
  const agentChoiceForTest =
    cfg.mode === 'daemon' && cfg.agentId
      ? cfg.agentModels?.[cfg.agentId]
      : null;
  useEffect(() => {
    agentTestRevisionRef.current += 1;
    setAgentTestState((state) =>
      state.status === 'running' ? state : { status: 'idle' },
    );
  }, [
    cfg.agentId,
    agentChoiceForTest?.model,
    agentChoiceForTest?.reasoning,
    cfg.agentCliEnv,
  ]);
  // Rescan notices are list-level feedback for a one-shot action and
  // shouldn't linger in the content stream. After 6s, fade them out so
  // repeated Rescan clicks don't pile up; the next click resets the
  // notice immediately, so this only affects "user moved on" cases.
  useEffect(() => {
    if (!agentRescanNotice) return;
    const id = window.setTimeout(() => setAgentRescanNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [agentRescanNotice]);
  useEffect(() => {
    if (providerTestFirstResetRef.current) {
      providerTestFirstResetRef.current = false;
      return;
    }
    if (providerTestSkipNextResetRef.current) {
      providerTestSkipNextResetRef.current = false;
      return;
    }
    providerTestRevisionRef.current += 1;
    providerAutoTestKeyRef.current = null;
    setByokPreconditionNotice(null);
    setProviderTestState((state) =>
      state.status === 'running' ? state : { status: 'idle' },
    );
  }, [
    cfg.apiProtocol,
    cfg.apiKey,
    cfg.baseUrl,
    cfg.model,
    cfg.apiVersion,
  ]);
  useEffect(() => {
    if (providerModelsFirstResetRef.current) {
      providerModelsFirstResetRef.current = false;
      return;
    }
    if (providerModelsSkipNextResetRef.current) {
      providerModelsSkipNextResetRef.current = false;
      return;
    }
    providerModelsRevisionRef.current += 1;
    providerModelsAbortRef.current?.abort();
    providerModelsAbortRef.current = null;
    setProviderModelsCommittedKey(null);
    setByokPreconditionNotice(null);
    setProviderModelsState({ status: 'idle' });
  }, [
    cfg.apiProtocol,
    cfg.apiKey,
    cfg.baseUrl,
    cfg.apiVersion,
  ]);
  // Releasing the abort controllers on unmount avoids the "setState after
  // unmount" warning if the dialog closes while a test is still running.
  useEffect(() => {
    return () => {
      agentTestAbortRef.current?.abort();
      providerTestAbortRef.current?.abort();
      providerModelsAbortRef.current?.abort();
    };
  }, []);

  const installedCount = useMemo(
    () => agents.filter((a) => a.available && isVisibleLocalCliAgent(a)).length,
    [agents],
  );

  const setMode = (mode: ExecMode) => {
    setCfg((c) => {
      const modeBefore = executionModeToTracking(c.mode);
      const modeAfter = executionModeToTracking(mode);
      if (modeBefore !== modeAfter) {
        trackSettingsExecutionModeTabClick(analytics.track, {
          page_name: 'settings',
          area: 'configure_execution_mode',
          element: 'execution_mode_tab',
          action: 'switch_execution_mode',
          mode_before: modeBefore,
          mode_after: modeAfter,
        });
      }
      if (mode === 'api' && c.mode !== 'api') {
        return restorePendingByokProviderDraft({ ...c, mode });
      }
      return { ...c, mode };
    });
  };
  const setByokProvider = (provider: ByokProviderPreset) => {
    const currentDraftKey = byokProviderKeyForConfig(cfg);
    const currentApiConfig = currentApiProtocolConfig(cfg);
    if ((cfg.apiProviderBaseUrl ?? null) === null) {
      lastCustomByokProviderDraftKeysRef.current[cfg.apiProtocol ?? 'anthropic'] =
        currentDraftKey;
    }
    byokProviderFormDraftsRef.current[currentDraftKey] = {
      apiConfig: currentApiConfig,
      maxTokens: cfg.maxTokens,
      maxTokensInput,
      providerModelsCommittedKey,
      providerModelsState,
      showApiKey,
      apiModelCustomEditing,
      apiModelUserSelected: apiModelUserSelectedRef.current,
    };
    const nextProviderBaseUrlForCurrent = provider.custom ? null : provider.baseUrl;
    const providerChangedBeforeSwitch = provider.custom
      ? (cfg.apiProviderBaseUrl ?? null) !== null
      : (cfg.apiProtocol ?? 'anthropic') !== provider.protocol ||
        (cfg.apiProviderBaseUrl ?? null) !== nextProviderBaseUrlForCurrent;
    focusByokRequiredFieldAfterProtocolSwitchRef.current = !provider.custom;
    providerModelsSkipNextResetRef.current = providerChangedBeforeSwitch;
    setCfg((current) => {
      const currentProtocol = current.apiProtocol ?? 'anthropic';
      const nextProviderBaseUrl = provider.custom ? null : provider.baseUrl;
      const providerChanged = provider.custom
        ? (current.apiProviderBaseUrl ?? null) !== null
        : currentProtocol !== provider.protocol ||
          (current.apiProviderBaseUrl ?? null) !== nextProviderBaseUrl;
      const switched = switchApiProtocolConfig(current, provider.protocol);
      const fallbackApiConfig = currentApiProtocolConfig(switched);
      const customDraftKey = provider.custom
        ? lastCustomByokProviderDraftKeysRef.current[provider.protocol]
        : null;
      const nextProviderDraftKey = customDraftKey ?? byokProviderDraftKey(
        provider.protocol,
        nextProviderBaseUrl,
        provider.custom ? fallbackApiConfig.baseUrl : provider.baseUrl,
      );
      const savedDraft = nextProviderDraftKey
        ? byokProviderFormDraftsRef.current[nextProviderDraftKey]
        : undefined;
      const persistedDraft = nextProviderDraftKey
        ? current.byokProviderConfigDrafts?.[nextProviderDraftKey]
        : undefined;
      const applyDraftUiState = (draft: ByokProviderFormDraft | undefined) => {
        setShowApiKey(draft?.showApiKey ?? false);
        setApiModelCustomEditing(draft?.apiModelCustomEditing ?? false);
        apiModelUserSelectedRef.current = draft?.apiModelUserSelected ?? false;
        setMaxTokensInput(
          draft
            ? draft.maxTokensInput
            : switched.maxTokens == null ? '' : String(switched.maxTokens),
        );
        setProviderModelsCommittedKey(draft?.providerModelsCommittedKey ?? null);
        setProviderModelsState(draft?.providerModelsState ?? { status: 'idle' });
      };
      if (savedDraft) {
        applyDraftUiState(savedDraft);
        return applyApiProtocolConfig(
          persistByokProviderConfigDraft(
            {
              ...switched,
              maxTokens: savedDraft.maxTokens,
            },
            currentDraftKey,
            currentApiProtocolConfig(current),
          ),
          provider.protocol,
          savedDraft.apiConfig,
        );
      }
      if (persistedDraft) {
        applyDraftUiState(undefined);
        return applyApiProtocolConfig(
          persistByokProviderConfigDraft(
            {
              ...switched,
              maxTokens: persistedDraft.maxTokens,
            },
            currentDraftKey,
            currentApiProtocolConfig(current),
          ),
          provider.protocol,
          persistedDraft.apiConfig,
        );
      }
      const switchedWithCurrentDraft = persistByokProviderConfigDraft(
        switched,
        currentDraftKey,
        currentApiProtocolConfig(current),
      );
      if (provider.custom) {
        applyDraftUiState(undefined);
        return updateCurrentApiProtocolConfig(switchedWithCurrentDraft, {
          apiProviderBaseUrl: null,
          ...(providerChanged ? { model: '' } : {}),
        });
      }
      applyDraftUiState(undefined);
      return updateCurrentApiProtocolConfig(switchedWithCurrentDraft, {
        ...(providerChanged ? { apiKey: '' } : {}),
        baseUrl: provider.baseUrl,
        model: provider.preferredModels[0] ?? '',
        apiProviderBaseUrl: provider.baseUrl,
      });
    });
  };
  const updateApiConfig = (patch: Partial<ApiProtocolConfig>) =>
    setCfg((c) => updateCurrentApiProtocolConfig(c, patch));
  const updateMaxTokensInput = (raw: string) => {
    setMaxTokensInput(raw);
    const trimmed = raw.trim();
    if (trimmed === '') {
      setCfg((c) => ({ ...c, maxTokens: undefined }));
      return;
    }
    const value = Number(trimmed);
    const nextMaxTokens =
      Number.isInteger(value) &&
      value >= MIN_MAX_TOKENS &&
      value <= MAX_MAX_TOKENS
        ? value
        : undefined;
    setCfg((c) => ({ ...c, maxTokens: nextMaxTokens }));
  };
  const markAgentInstallIntent = () => {
    pendingAgentInstallRescanRef.current = true;
  };
  const handleRefreshAgents = async () => {
    if (agentRescanRunning) return;
    setAgentRescanRunning(true);
    setAgentRescanNotice(null);
    try {
      const refreshed = await onRefreshAgents(agentRefreshOptionsForConfig(cfg));
      const nextAgents = Array.isArray(refreshed) ? refreshed : agents;
      setAgentRescanNotice({
        kind: 'success',
        count: availableVisibleAgentCount(nextAgents),
      });
    } catch {
      setAgentRescanNotice({ kind: 'error' });
    } finally {
      setAgentRescanRunning(false);
    }
  };
  const openAgentFixUrl = (url: string) => {
    const href = sanitizeHttpsUrl(url);
    if (!href) return;
    markAgentInstallIntent();
    void openExternalUrl(href);
  };
  const diagnosticHandlersForAgent = (agent: AgentInfo) => {
    const docsUrl = sanitizeHttpsUrl(agent.docsUrl);
    const installUrl = sanitizeHttpsUrl(agent.installUrl);
    return {
      onRescan: () => void handleRefreshAgents(),
      ...(docsUrl ? { onOpenDocs: () => openAgentFixUrl(docsUrl) } : {}),
      ...(installUrl
        ? {
            onOpenInstall: () =>
              openAgentFixUrl(installUrl),
          }
        : {}),
    };
  };
  useEffect(() => {
    const handleReturnToSettings = () => {
      if (
        !pendingAgentInstallRescanRef.current ||
        agentRescanRunning ||
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      pendingAgentInstallRescanRef.current = false;
      void handleRefreshAgents();
    };
    document.addEventListener('visibilitychange', handleReturnToSettings);
    window.addEventListener('focus', handleReturnToSettings);
    return () => {
      document.removeEventListener('visibilitychange', handleReturnToSettings);
      window.removeEventListener('focus', handleReturnToSettings);
    };
  }, [agentRescanRunning, handleRefreshAgents]);



  const handleTestAgent = async () => {
    if (agentTestState.status === 'running') {
      return;
    }
    const selected = agents.find((a) => a.id === cfg.agentId && a.available);
    if (!selected) return;
    const choice = cfg.agentModels?.[selected.id] ?? {};
    const controller = new AbortController();
    const revision = agentTestRevisionRef.current;
    agentTestAbortRef.current = controller;
    setAgentTestState({ status: 'running' });
    const startedAt = performance.now();
    const cliProviderId = agentIdToTracking(selected.id);
    const clearIfStale = () => {
      if (agentTestAbortRef.current === controller) {
        setAgentTestState({ status: 'idle' });
      }
    };
    try {
      const result = await testAgent(
        {
          agentId: selected.id,
          model: choice.model || undefined,
          reasoning: choice.reasoning || undefined,
          serviceTier: choice.serviceTier || undefined,
          agentCliEnv: cfg.agentCliEnv ?? {},
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (agentTestRevisionRef.current !== revision) {
        clearIfStale();
        return;
      }
      setAgentTestState({ status: 'done', result });
      trackSettingsCliTestResult(analytics.track, {
        page_name: 'settings',
        area: 'configure_execution_mode',
        cli_provider_id: cliProviderId,
        result: result.ok ? 'success' : 'failed',
        ...(result.ok ? {} : { error_code: result.kind || 'UNKNOWN' }),
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (agentTestRevisionRef.current !== revision) {
        clearIfStale();
        return;
      }
      setAgentTestState({
        status: 'done',
        result: {
          ok: false,
          kind: 'unknown',
          latencyMs: 0,
          model: choice.model || 'default',
          detail: err instanceof Error ? err.message : 'Test request failed',
        },
      });
      trackSettingsCliTestResult(analytics.track, {
        page_name: 'settings',
        area: 'configure_execution_mode',
        cli_provider_id: cliProviderId,
        result: 'failed',
        error_code: err instanceof Error ? err.name : 'UNKNOWN',
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } finally {
      if (agentTestAbortRef.current === controller) {
        agentTestAbortRef.current = null;
      }
    }
  };

  const handleTestProvider = async (
    options: { silentPreconditions?: boolean } = {},
  ) => {
    if (providerTestState.status === 'running') {
      return;
    }
    const blockingIssues = blockingByokDraftIssues(byokDraftValidation);
    const hasFirstPartyHostTypo = Boolean(byokFirstPartyBaseUrl?.hostTypo);
    const currentConfigKey = providerConnectionTestKey(apiProtocol, cfg);
    const lastUnsuccessfulConfigKey = byokLastUnsuccessfulTestKeyRef.current;
    const configKeyChanged = lastUnsuccessfulConfigKey !== null &&
      lastUnsuccessfulConfigKey !== currentConfigKey;
    if (hasFirstPartyHostTypo) {
      if (!options.silentPreconditions) {
        setByokPreconditionNotice({
          action: 'test',
          field: 'base_url',
          message: t('settings.testInvalidBaseUrl'),
        });
        focusByokRequiredField('base_url');
      }
      byokLastUnsuccessfulTestKeyRef.current = currentConfigKey;
      return;
    }
    if (blockingIssues.length > 0) {
      if (options.silentPreconditions) {
        return;
      }
      showByokDraftValidationNotice('test', byokDraftValidation);
      const byokProviderId = byokProtocolToTracking(apiProtocol);
      if (byokProviderId) {
        trackSettingsByokTestResult(analytics.track, {
          page_name: 'settings',
          area: 'execution_model',
          provider_id: byokProviderId,
          result: 'failed',
          error_code: byokErrorKindFromIssues(blockingIssues),
          error_kind: byokErrorKindFromIssues(blockingIssues),
          field_missing: byokFieldMissingFromIssues(blockingIssues),
          config_key_changed: configKeyChanged,
          success_after_action: false,
          duration_ms: 0,
        });
      }
      byokLastUnsuccessfulTestKeyRef.current = currentConfigKey;
      return;
    }
    const controller = new AbortController();
    const revision = providerTestRevisionRef.current;
    providerTestAbortRef.current = controller;
    setProviderTestState({ status: 'running' });
    const startedAt = performance.now();
    const clearIfStale = () => {
      if (providerTestAbortRef.current === controller) {
        setProviderTestState({ status: 'idle' });
      }
    };
    try {
      const result = await testApiProvider(
        {
          protocol: apiProtocol,
          baseUrl: cfg.baseUrl,
          apiKey: cleanByokApiKey(cfg.apiKey),
          model: cfg.model,
          apiVersion:
            apiProtocol === 'azure'
              ? cfg.apiVersion?.trim() || undefined
              : undefined,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (providerTestRevisionRef.current !== revision) {
        clearIfStale();
        return;
      }
      setProviderTestState({ status: 'done', result });
      if (!result.ok && result.kind === 'not_found_model') {
        focusByokRequiredField('model');
      }
      const byokProviderId = byokProtocolToTracking(apiProtocol);
      if (byokProviderId) {
        trackSettingsByokTestResult(analytics.track, {
          page_name: 'settings',
          area: 'execution_model',
          provider_id: byokProviderId,
          result: byokTrackingTestResult(result),
          ...(result.ok ? {} : { error_code: byokErrorCode(result) }),
          ...(result.ok ? {} : { error_kind: result.kind || 'UNKNOWN' }),
          field_missing: 'none',
          config_key_changed: configKeyChanged,
          success_after_action: result.ok && configKeyChanged,
          duration_ms: Math.round(performance.now() - startedAt),
        });
      }
      byokLastUnsuccessfulTestKeyRef.current = result.ok ? null : currentConfigKey;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (providerTestRevisionRef.current !== revision) {
        clearIfStale();
        return;
      }
      setProviderTestState({
        status: 'done',
        result: {
          ok: false,
          kind: 'unknown',
          latencyMs: 0,
          model: cfg.model,
          detail: err instanceof Error ? err.message : 'Test request failed',
        },
      });
      const byokProviderId = byokProtocolToTracking(apiProtocol);
      if (byokProviderId) {
        trackSettingsByokTestResult(analytics.track, {
          page_name: 'settings',
          area: 'execution_model',
          provider_id: byokProviderId,
          result: 'failed',
          error_code: err instanceof Error ? err.name : 'UNKNOWN',
          error_kind: err instanceof Error ? err.name : 'UNKNOWN',
          field_missing: 'none',
          config_key_changed: configKeyChanged,
          success_after_action: false,
          duration_ms: Math.round(performance.now() - startedAt),
        });
      }
      byokLastUnsuccessfulTestKeyRef.current = currentConfigKey;
    } finally {
      if (providerTestAbortRef.current === controller) {
        providerTestAbortRef.current = null;
      }
    }
  };

  const handleAutoTestProvider = () => {
    if (providerTestState.status === 'running') {
      return;
    }
    if (byokFirstPartyBaseUrl?.hostTypo) {
      return;
    }
    if (blockingByokDraftIssues(byokDraftValidation).length > 0) {
      return;
    }
    const key = providerConnectionTestKey(apiProtocol, cfg);
    if (providerAutoTestKeyRef.current === key) {
      return;
    }
    providerAutoTestKeyRef.current = key;
    void handleTestProvider({ silentPreconditions: true });
  };

  const handleFetchProviderModels = async (
    options: { silent?: boolean; trigger?: 'auto' | 'manual' } = {},
  ) => {
    const trigger = options.trigger ?? (options.silent ? 'auto' : 'manual');
    const byokProviderId = byokProtocolToTracking(apiProtocol);
    const trackModelsFetchResult = (
      props: Omit<
        Parameters<typeof trackSettingsByokModelsFetchResult>[1],
        'page_name' | 'area' | 'provider_id' | 'trigger' | 'source'
      >,
      source: 'network' | 'cache' = 'network',
    ) => {
      if (!byokProviderId) return;
      trackSettingsByokModelsFetchResult(analytics.track, {
        page_name: 'settings',
        area: 'configure_execution_mode_byok',
        provider_id: byokProviderId,
        trigger,
        source,
        ...props,
      });
    };
    if (providerModelsState.status === 'running') {
      return;
    }
    if (apiProtocol === 'azure') {
      trackModelsFetchResult({
        result: 'failed',
        error_code: 'unsupported_azure',
        error_kind: 'unsupported_azure',
        duration_ms: 0,
      });
      if (!options.silent) {
        setByokPreconditionNotice({
          action: 'test',
          message: t('settings.fetchModelsUnsupportedAzure'),
        });
      }
      return;
    }
    if (apiProtocol === 'ollama') {
      trackModelsFetchResult({
        result: 'failed',
        error_code: 'unsupported_ollama',
        error_kind: 'unsupported_ollama',
        duration_ms: 0,
      });
      if (!options.silent) {
        setByokPreconditionNotice({
          action: 'test',
          message: t('settings.fetchModelsUnsupportedOllama'),
        });
      }
      return;
    }
    if (isProviderModelDiscoveryUnsupported(apiProtocol, cfg.baseUrl)) {
      trackModelsFetchResult({
        result: 'failed',
        error_code: 'unsupported_provider_models',
        error_kind: 'unsupported_provider_models',
        duration_ms: 0,
      });
      if (!options.silent) {
        setByokPreconditionNotice({
          action: 'test',
          message: t('settings.fetchModelsUnsupported'),
        });
      }
      return;
    }
    const modelFetchBlockingIssues = blockingByokDraftIssues(
      byokModelFetchDraftValidation,
    );
    if (byokFirstPartyBaseUrl?.hostTypo) {
      if (!options.silent) {
        setByokPreconditionNotice({
          action: 'test',
          field: 'base_url',
          message: t('settings.testInvalidBaseUrl'),
        });
        focusByokRequiredField('base_url');
      }
      return;
    }
    if (modelFetchBlockingIssues.length > 0) {
      trackModelsFetchResult({
        result: 'failed',
        error_code: byokErrorKindFromIssues(modelFetchBlockingIssues),
        error_kind: byokErrorKindFromIssues(modelFetchBlockingIssues),
        field_missing: byokFieldMissingFromIssues(modelFetchBlockingIssues),
        duration_ms: 0,
      });
      if (!options.silent) {
        showByokDraftValidationNotice('test', byokModelFetchDraftValidation);
      }
      return;
    }
    const cacheKey = providerModelsCacheKey(
      apiProtocol,
      cfg.baseUrl,
      cfg.apiKey,
      cfg.apiVersion ?? '',
    );
    const cachedModels = activeProviderModelsCache[cacheKey];
    if (cachedModels) {
      trackModelsFetchResult(
        {
          result: 'success',
          model_count: cachedModels.length,
          duration_ms: 0,
        },
        'cache',
      );
      setProviderModelsState({
        status: 'done',
        cacheKey,
        result: {
          ok: true,
          kind: 'success',
          latencyMs: 0,
          models: cachedModels,
        },
      });
      return;
    }
    const controller = new AbortController();
    const revision = providerModelsRevisionRef.current;
    providerModelsAbortRef.current = controller;
    setProviderModelsState({ status: 'running', cacheKey });
    const startedAt = performance.now();
    const clearIfStale = () => {
      if (providerModelsAbortRef.current === controller) {
        setProviderModelsState({ status: 'idle' });
      }
    };
    try {
      const result = await fetchProviderModels(
        {
          protocol: apiProtocol,
          baseUrl: cfg.baseUrl,
          apiKey: cleanByokApiKey(cfg.apiKey),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (providerModelsRevisionRef.current !== revision) {
        clearIfStale();
        return;
      }
      if (result.ok && result.models?.length) {
        activeSetProviderModelsCache((prev) => ({
          ...prev,
          [cacheKey]: result.models ?? [],
        }));
      }
      trackModelsFetchResult({
        result: result.ok ? 'success' : 'failed',
        ...(result.ok ? {} : { error_code: result.kind || 'UNKNOWN' }),
        ...(result.ok ? {} : { error_kind: result.kind || 'UNKNOWN' }),
        model_count: result.ok ? result.models?.length ?? 0 : 0,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      setProviderModelsState({ status: 'done', cacheKey, result });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (providerModelsRevisionRef.current !== revision) {
        clearIfStale();
        return;
      }
      setProviderModelsState({
        status: 'done',
        cacheKey,
        result: {
          ok: false,
          kind: 'unknown',
          latencyMs: 0,
          detail: err instanceof Error ? err.message : 'Model list request failed',
        },
      });
      trackModelsFetchResult({
        result: 'failed',
        error_code: err instanceof Error ? err.name : 'UNKNOWN',
        error_kind: err instanceof Error ? err.name : 'UNKNOWN',
        model_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } finally {
      if (providerModelsAbortRef.current === controller) {
        providerModelsAbortRef.current = null;
      }
    }
  };

  const renderTestMessage = (
    result: ConnectionTestResponse,
    kindForSuccess: 'api' | 'cli',
  ): string => {
    const ms = Math.max(0, Math.round(result.latencyMs));
    const sample = result.sample ?? '';
    const agentName = result.agentName ?? '';
    const testedModel = result.model ?? cfg.model;
    if (result.ok) {
      const baseMessage = kindForSuccess === 'api'
        ? t('settings.testSuccessApi', { ms, sample })
        : t('settings.testSuccessCli', { agentName, ms, sample });
      const successMessage =
        kindForSuccess === 'cli' &&
        result.resolvedModel &&
        result.resolvedModel !== testedModel
          ? `${baseMessage} ${t('settings.model')}: ${result.resolvedModel}`
          : baseMessage;
      if (kindForSuccess === 'cli' && cfg.agentId === 'codex') {
        const codexStrings = codexPathStrings(locale);
        if (
          result.usedExecutableSource === 'configured' &&
          result.configuredExecutablePath
        ) {
          return `${successMessage} ${codexStrings.configuredSuccess(result.configuredExecutablePath)}`;
        }
        if (
          result.usedExecutableSource === 'fallback_invalid' &&
          result.configuredExecutablePath &&
          result.detectedExecutablePath
        ) {
          return `${successMessage} ${codexStrings.invalidFallback(
            result.configuredExecutablePath,
            result.detectedExecutablePath,
          )}`;
        }
        if (
          result.usedExecutableSource === 'fallback_failed' &&
          result.configuredExecutablePath &&
          result.detectedExecutablePath
        ) {
          return `${successMessage} ${codexStrings.failedFallback(
            result.configuredExecutablePath,
            result.detectedExecutablePath,
          )}`;
        }
      }
      return result.detail ? `${successMessage} ${result.detail}` : successMessage;
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
        const baseMessage = t('settings.testUpstream', {
          status: result.status ?? 0,
        });
        return result.detail ? `${baseMessage} ${result.detail}` : baseMessage;
      }
      case 'timeout':
        return t('settings.testTimeout', { ms });
      case 'agent_not_installed':
        return t('settings.testAgentMissing', { agentName });
      case 'agent_auth_required':
        return result.detail || t('settings.testAgentAuthRequired');
      case 'agent_spawn_failed':
        return t('settings.testAgentSpawn', {
          agentName,
          detail: result.detail ?? '',
        });
      default:
        return t('settings.testUnknown', { detail: result.detail ?? '' });
    }
  };

  const applyCodexDetectedPath = (detectedPath: string) => {
    setCfg((c) => updateAgentCliEnvValue(c, 'codex', 'CODEX_BIN', detectedPath));
    setAgentTestState({ status: 'idle' });
  };

  const clearCodexCustomPath = () => {
    setCfg((c) => updateAgentCliEnvValue(c, 'codex', 'CODEX_BIN', ''));
    setAgentTestState({ status: 'idle' });
  };

  const apiProtocol = cfg.apiProtocol ?? 'anthropic';
  const defaultApiKeyConsoleLink = API_KEY_CONSOLE_LINKS[apiProtocol];
  const byokProviderPresets: ReadonlyArray<ByokProviderPreset> = [
    ...BYOK_PROVIDER_PRESETS,
    {
      id: 'custom',
      title: t('settings.customProvider'),
      protocol: apiProtocol,
      baseUrl: cfg.baseUrl,
      preferredModels: cfg.model ? [cfg.model] : [],
      custom: true,
    },
  ];
  const customByokProvider = byokProviderPresets.find((provider) => provider.custom) ?? {
    id: 'custom',
    title: t('settings.customProvider'),
    protocol: apiProtocol,
    baseUrl: cfg.baseUrl,
    preferredModels: cfg.model ? [cfg.model] : [],
    custom: true,
  };
  const byokPresetProtocols = new Set(
    byokProviderPresets
      .filter((provider) => !provider.custom)
      .map((provider) => provider.protocol),
  );
  const byokProviderOptions: ReadonlyArray<ByokProviderPreset> = [
    ...byokProviderPresets.filter((provider) => !provider.custom),
    ...API_PROTOCOL_TABS.filter((tab) => !byokPresetProtocols.has(tab.id)).map((tab) => {
      const fallback = defaultApiProtocolConfig(tab.id);
      return {
        id: `protocol-${tab.id}`,
        title: tab.title,
        protocol: tab.id,
        baseUrl: fallback.baseUrl || DEFAULT_BASE_URL_BY_PROTOCOL[tab.id],
        preferredModels: [
          fallback.model || SUGGESTED_MODELS_BY_PROTOCOL[tab.id][0] || '',
        ].filter(Boolean),
      };
    }),
    customByokProvider,
  ];
  const selectedByokProvider =
    cfg.apiProviderBaseUrl === null
      ? customByokProvider
      : byokProviderOptions.find(
        (provider) =>
          !provider.custom &&
          provider.protocol === apiProtocol &&
          provider.baseUrl === cfg.apiProviderBaseUrl,
      ) ?? customByokProvider;
  const baseUrlValid = isValidApiBaseUrl(cfg.baseUrl);
  const baseUrlInvalid = Boolean(cfg.baseUrl.trim() && !baseUrlValid);
  const byokRequiredLabel = (field: ByokRequiredField): string => {
    switch (field) {
      case 'api_key':
        return t('settings.apiKey');
      case 'base_url':
        return t('settings.baseUrl');
      case 'model':
        return apiProtocol === 'azure'
          ? t('settings.azureDeploymentModel')
          : t('settings.model');
      default: {
        const exhaustive: never = field;
        return exhaustive;
      }
    }
  };
  const formatByokMissingFields = (fields: ByokRequiredField[]): string =>
    fields.map(byokRequiredLabel).join(', ');
  const focusByokRequiredField = (field: ByokRequiredField | undefined) => {
    if (!field) return;
    window.setTimeout(() => {
      if (field === 'api_key') {
        apiKeyInputRef.current?.focus();
        return;
      }
      if (field === 'base_url') {
        baseUrlInputRef.current?.focus();
        return;
      }
      if (customModelInputRef.current) {
        customModelInputRef.current.focus();
        return;
      }
      modelSelectRef.current?.focus();
    }, 0);
  };
  const showByokPreconditionNotice = (
    action: ByokPreconditionAction,
    fields: ByokRequiredField[],
  ) => {
    setByokPreconditionNotice({
      action,
      message: t('settings.testMissingFields', {
        fields: formatByokMissingFields(fields),
      }),
    });
    focusByokRequiredField(fields[0]);
  };
  const byokDraftIssueMessage = (issue: ByokDraftIssue): string => {
    switch (issue.code) {
      case 'api_key_required':
      case 'base_url_required':
      case 'model_required':
        return t('settings.testMissingFields', {
          fields: byokRequiredLabel(issue.field),
        });
      case 'api_key_extra_whitespace':
      case 'api_key_malformed':
      case 'api_key_wrong_protocol':
        return t('settings.apiKeyInvalid');
      case 'base_url_invalid':
        return t('settings.baseUrlInvalid');
      default: {
        const exhaustive: never = issue.code;
        return exhaustive;
      }
    }
  };
  const showByokDraftValidationNotice = (
    action: ByokPreconditionAction,
    validation: ByokDraftValidation,
  ) => {
    const blockingFields = blockingByokDraftFields(validation);
    if (blockingFields.length === 0) return;
    const blockingIssues = blockingByokDraftIssues(validation);
    const missingFields = blockingIssues
      .filter((issue) =>
        issue.code === 'api_key_required' ||
        issue.code === 'base_url_required' ||
        issue.code === 'model_required'
      )
      .map((issue) => issue.field);
    if (missingFields.length > 0) {
      showByokPreconditionNotice(action, missingFields);
      return;
    }
    const firstIssue = blockingIssues[0];
    if (!firstIssue) return;
    setByokPreconditionNotice({
      action,
      field: firstIssue.field,
      message: byokDraftIssueMessage(firstIssue),
    });
    focusByokRequiredField(firstIssue.field);
  };
  // Autosave loop. Every committed edit to `cfg` schedules a debounced
  // sync to localStorage + the daemon. We keep a 400ms debounce so rapid
  // typing in text fields doesn't flood the daemon with PUTs while still
  // feeling near-instant for toggles/selects (which fire once and settle).
  // The Composio API key field is intentionally excluded from this loop —
  // see ConnectorSection for the explicit "Save key" gesture.
  // The status here drives the footer indicator: 'idle' = no draft to
  // flush, 'pending' = scheduled, 'saving' = request in flight, 'saved'
  // = recent successful sync, 'error' = recent failure.
  type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  // The indicator is one shared surface: every section drives this same pill.
  // A section whose write outlives it — Labs writes immediately and can settle
  // after unmount — must not relabel a newer save's outcome, so every writer
  // takes a claim and only the current claim may settle. Comparing the
  // displayed value would not be enough: a newer section can legitimately be
  // showing the same `saving` an older write left behind.
  const autosaveClaimRef = useRef(0);
  const claimAutosaveStatus = useCallback((next: AutosaveStatus): number => {
    autosaveClaimRef.current += 1;
    setAutosaveStatus(next);
    return autosaveClaimRef.current;
  }, []);
  const settleAutosaveStatus = useCallback((claim: number, next: AutosaveStatus): void => {
    if (claim !== autosaveClaimRef.current) return;
    setAutosaveStatus(next);
  }, []);
  const labsAutosave = useMemo(() => ({
    claim: () => claimAutosaveStatus('saving'),
    settle: (claim: number, status: 'saved' | 'error' | 'idle') => {
      // Settling does not hand the indicator to anyone else, so the claim
      // stays valid for this writer's own follow-up (saved -> idle).
      settleAutosaveStatus(claim, status);
    },
  }), [claimAutosaveStatus, settleAutosaveStatus]);
  // Skip the very first effect tick so just opening the dialog doesn't
  // appear to "save" anything before the user has touched a field.
  const autosaveSkipFirstRef = useRef(true);
  // Silent-update toggles use a dedicated non-optimistic path; skip the next
  // autosave effect tick so we do not double-write through handleConfigPersist.
  const suppressNextAutosaveRef = useRef(false);
  const silentUpdateWriteTokenRef = useRef(0);
  const [silentUpdateBusy, setSilentUpdateBusy] = useState(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveSavedTimerRef = useRef<number | null>(null);
  const autosaveRetryTimerRef = useRef<number | null>(null);
  const autosavePendingFlushRef = useRef(false);
  const explicitOnboardingResetRef = useRef(false);
  const byokPreflightTrackingRef = useRef<string | null>(null);
  const committedClearedByokProviderKeyRef = useRef<string | null>(null);
  const autosaveLatestRef = useRef<AppConfig>(cfg);
  // Baseline used by the draft-only detector: the snapshot at the most
  // recent successful autosave (or the initial cfg on mount). Compared
  // against the current snapshot to decide whether the only edits
  // since last save are intentionally-stripped fields like the
  // Composio API key — in which case we must NOT flash "All changes
  // saved", because the draft has not actually been persisted.
  const autosaveLastSavedRef = useRef<AppConfig>(normalizedInitialConfig);
  const mediaProvidersChangeVersionRef = useRef(0);
  const lastSyncedMediaProvidersVersionRef = useRef(0);
  const [autosaveCommitTick, setAutosaveCommitTick] = useState(0);
  const [autosaveRetryTick, setAutosaveRetryTick] = useState(0);
  autosaveLatestRef.current = cfg;

  // App owns the config transition and persistence. Settings only supplies
  // its latest draft with the explicit reset intent. Cancel a queued autosave
  // before handing off: the dialog unmounts immediately, and its normal
  // pending-draft flush must not replay the pre-reset `true` snapshot.
  const handleResetOnboarding = useCallback(() => {
    if (!onResetOnboarding) return;
    explicitOnboardingResetRef.current = true;
    autosavePendingFlushRef.current = false;
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (autosaveRetryTimerRef.current != null) {
      window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = null;
    }
    claimAutosaveStatus('idle');
    onResetOnboarding({ ...cfg, onboardingCompleted: false });
  }, [cfg, claimAutosaveStatus, onResetOnboarding]);

  useEffect(() => {
    if (autosaveSkipFirstRef.current) {
      autosaveSkipFirstRef.current = false;
      return;
    }
    if (suppressNextAutosaveRef.current) {
      suppressNextAutosaveRef.current = false;
      return;
    }
    const autosaveClaim = claimAutosaveStatus('pending');
    if (autosaveSavedTimerRef.current != null) {
      window.clearTimeout(autosaveSavedTimerRef.current);
      autosaveSavedTimerRef.current = null;
    }
    if (autosaveRetryTimerRef.current != null) {
      window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = null;
    }
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosavePendingFlushRef.current = true;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosavePendingFlushRef.current = false;
      autosaveTimerRef.current = null;
      const snapshot = autosaveLatestRef.current;
      const preflightReason = snapshot.mode === 'api'
        ? byokPreflightBlockReason(snapshot)
        : null;
      if (preflightReason) {
        const providerId = byokProtocolToTracking(snapshot.apiProtocol) ?? 'unknown';
        const activeExecutionMode = executionModeToTracking(autosaveLastSavedRef.current.mode);
        const trackingKey = [
          byokProviderKeyForConfig(snapshot),
          preflightReason,
          activeExecutionMode,
        ].join(':');
        if (byokPreflightTrackingRef.current !== trackingKey) {
          byokPreflightTrackingRef.current = trackingKey;
          trackByokPreflightBlocked(analytics.track, {
            source: 'settings',
            reason: preflightReason,
            provider_id: providerId,
            active_execution_mode: activeExecutionMode,
          });
        }
      } else {
        byokPreflightTrackingRef.current = null;
      }
      const committedClearedProviderKey = committedClearedByokProviderKeyRef.current;
      const persistedSnapshot = resolveSettingsAutosavePayload(
        snapshot,
        autosaveLastSavedRef.current,
        {
          commitClearedActiveApiKey:
            committedClearedProviderKey === byokProviderKeyForConfig(snapshot),
        },
      );
      const mediaProvidersVersion = mediaProvidersChangeVersionRef.current;
      const persistOptions = {
        forceMediaProviderSync: mediaProvidersVersion > lastSyncedMediaProvidersVersionRef.current,
      };
      // Draft-only edit (e.g. the user is mid-typing the Composio API
      // key, which only commits via the explicit "Save key" gesture):
      // the persisted shape would be identical to what is already on
      // disk, so a save would be a no-op that mis-reports "Saved" and
      // makes users trust that a sensitive key was persisted when it
      // was not. Skip the persist and settle the indicator to idle.
      // The forced media-provider sync path still runs because that
      // is a real outbound effect even when the persisted shape
      // hasn't changed.
      if (
        !persistOptions.forceMediaProviderSync
        && isAutosaveDraftOnlyChange(persistedSnapshot, autosaveLastSavedRef.current)
      ) {
        settleAutosaveStatus(autosaveClaim, 'idle');
        return;
      }
      settleAutosaveStatus(autosaveClaim, 'saving');
      void (async () => {
        try {
          await onPersist(persistedSnapshot, persistOptions);
          autosaveLastSavedRef.current = persistedSnapshot;
          if (
            committedClearedProviderKey
            && committedClearedByokProviderKeyRef.current === committedClearedProviderKey
          ) {
            committedClearedByokProviderKeyRef.current = null;
          }
          lastSavedAppearanceRef.current = {
            accentColor: resolveAccentColor(persistedSnapshot.accentColor),
          };
          // If a newer edit landed while the request was in flight,
          // leave the status as 'pending' so the next debounce tick
          // owns the indicator instead of flashing "Saved".
          if (autosaveLatestRef.current !== snapshot) {
            settleAutosaveStatus(autosaveClaim, 'pending');
            return;
          }
          if (persistOptions.forceMediaProviderSync) {
            lastSyncedMediaProvidersVersionRef.current = mediaProvidersVersion;
            setPendingMediaProviderEditIds(new Set());
          }
          settleAutosaveStatus(autosaveClaim, 'saved');
          autosaveSavedTimerRef.current = window.setTimeout(() => {
            autosaveSavedTimerRef.current = null;
            // Settle to idle after a moment so the indicator doesn't
            // stay on "Saved" forever and become noise.
            settleAutosaveStatus(autosaveClaim, 'idle');
          }, 1800);
        } catch {
          if (
            persistOptions.forceMediaProviderSync
            && autosaveLatestRef.current === snapshot
            && mediaProvidersChangeVersionRef.current === mediaProvidersVersion
            && lastSyncedMediaProvidersVersionRef.current < mediaProvidersVersion
          ) {
            settleAutosaveStatus(autosaveClaim, 'pending');
            autosaveRetryTimerRef.current = window.setTimeout(() => {
              autosaveRetryTimerRef.current = null;
              if (
                autosaveLatestRef.current !== snapshot
                || mediaProvidersChangeVersionRef.current !== mediaProvidersVersion
                || lastSyncedMediaProvidersVersionRef.current >= mediaProvidersVersion
              ) {
                return;
              }
              setAutosaveRetryTick((tick) => tick + 1);
            }, 1500);
            return;
          }
          settleAutosaveStatus(autosaveClaim, 'error');
        }
      })();
    }, 400);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    analytics.track,
    autosaveCommitTick,
    autosaveRetryTick,
    cfg,
    claimAutosaveStatus,
    onPersist,
    settleAutosaveStatus,
  ]);
  // Flush any pending autosave on unmount so a fast-closing dialog
  // never strands an in-flight edit. We also clear the "Saved" toast
  // timer to avoid setState after unmount.
  useEffect(() => {
    return () => {
      if (
        autosavePendingFlushRef.current
        && !explicitOnboardingResetRef.current
      ) {
        const mediaProvidersVersion = mediaProvidersChangeVersionRef.current;
        // Best-effort flush; if it rejects, localStorage already has
        // the latest copy from the synchronous saveConfig call inside
        // onPersist.
        autosavePendingFlushRef.current = false;
        const persistedSnapshot = resolveSettingsAutosavePayload(
          autosaveLatestRef.current,
          autosaveLastSavedRef.current,
          {
            commitClearedActiveApiKey:
              committedClearedByokProviderKeyRef.current ===
              byokProviderKeyForConfig(autosaveLatestRef.current),
          },
        );
        void Promise.resolve(onPersist(persistedSnapshot, {
          forceMediaProviderSync: mediaProvidersVersion > lastSyncedMediaProvidersVersionRef.current,
        })).catch(() => undefined);
      }
      if (autosaveSavedTimerRef.current != null) {
        window.clearTimeout(autosaveSavedTimerRef.current);
        autosaveSavedTimerRef.current = null;
      }
      if (autosaveRetryTimerRef.current != null) {
        window.clearTimeout(autosaveRetryTimerRef.current);
        autosaveRetryTimerRef.current = null;
      }
    };
  }, [onPersist]);

  const protocolProviders = useMemo(
    () => KNOWN_PROVIDERS.filter((p) => p.protocol === apiProtocol),
    [apiProtocol],
  );
  const selectedProviderIndex =
    protocolProviders.findIndex((p) => {
      if (cfg.apiProviderBaseUrl == null) {
        return apiProtocol === 'azure' && p.baseUrl === '' && Boolean(cfg.baseUrl?.trim());
      }
      return (
        p.baseUrl === cfg.apiProviderBaseUrl &&
        (p.baseUrl === cfg.baseUrl || (apiProtocol === 'azure' && p.baseUrl === ''))
      );
    });
  const selectedProvider = selectedProviderIndex >= 0 ? protocolProviders[selectedProviderIndex] : undefined;
  const apiKeyConsoleLink =
    selectedProvider?.apiKeyConsoleLink ?? defaultApiKeyConsoleLink;
  const showProviderPreset =
    protocolProviders.length > 0 && !isFixedOriginGateway(apiProtocol);
  // Fixed-origin gateways resolve their Base URL automatically; nothing for the
  // user to edit, so hide the field entirely.
  const showBaseUrlField = !isFixedOriginGateway(apiProtocol);
  const byokRuntimeNotice = t(nativeCodexProviderForConfig({ protocol: apiProtocol, baseUrl: cfg.baseUrl })
    ? 'settings.byokCodexNotice'
    : 'settings.byokNoFileToolsNotice');
  const byokRequiresApiKey = byokProviderRequiresApiKey(
    apiProtocol,
    selectedProvider,
    cfg.baseUrl,
  );
  const byokProviderConfigured = (provider: ByokProviderPreset): boolean => {
    if (provider.custom) {
      return canRunProviderConnectionTest(currentApiProtocolConfig(cfg), {
        requiresApiKey: byokRequiresApiKey,
      }) && isValidApiBaseUrl(cfg.baseUrl);
    }
    const providerDraft = cfg.byokProviderConfigDrafts?.[
      byokProviderDraftKey(provider.protocol, provider.baseUrl, provider.baseUrl)
    ]?.apiConfig;
    const activeProvider = selectedByokProvider?.id === provider.id;
    const entry = activeProvider
      ? currentApiProtocolConfig(cfg)
      : providerDraft ?? (
        provider.protocol === apiProtocol
          ? undefined
          : cfg.apiProtocolConfigs?.[provider.protocol]
      );
    if (!entry) return false;
    if (provider.baseUrl) {
      if (entry.baseUrl !== provider.baseUrl) return false;
    } else if (provider.protocol !== 'azure' && entry.baseUrl !== provider.baseUrl) {
      return false;
    }
    const knownProvider = KNOWN_PROVIDERS.find((item) => item.baseUrl === provider.baseUrl);
    return canRunProviderConnectionTest(entry, {
      requiresApiKey: byokProviderRequiresApiKey(
        provider.protocol,
        knownProvider,
        entry.baseUrl,
      ),
    }) && isValidApiBaseUrl(entry.baseUrl);
  };
  const byokFirstPartyBaseUrl = useMemo(
    () => byokFirstPartyBaseUrlHint(
      apiProtocol,
      cfg.baseUrl,
      protocolProviders,
    ),
    [apiProtocol, cfg.baseUrl, protocolProviders],
  );
  const byokKeyValidationBaseUrl = byokFirstPartyBaseUrl?.baseUrl;
  const byokDraftValidation = useMemo(
    () => validateByokDraft(
      apiProtocol,
      {
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
      },
      {
        requiresApiKey: byokRequiresApiKey,
        keyValidationBaseUrl: byokKeyValidationBaseUrl,
      },
    ),
    [
      apiProtocol,
      byokKeyValidationBaseUrl,
      byokRequiresApiKey,
      cfg.apiKey,
      cfg.baseUrl,
      cfg.model,
    ],
  );
  const byokBlockingDraftIssues = useMemo(
    () => blockingByokDraftIssues(byokDraftValidation),
    [byokDraftValidation],
  );
  const byokActivationPreflightReason = useMemo(
    () => byokPreflightBlockReason(cfg),
    [
      cfg.apiKey,
      cfg.apiProtocol,
      cfg.apiProviderBaseUrl,
      cfg.baseUrl,
      cfg.model,
    ],
  );
  const apiKeyDraftInvalid = byokBlockingDraftIssues.some((issue) =>
    issue.field === 'api_key' && issue.code !== 'api_key_required'
  );
  const byokModelFetchDraftValidation = useMemo(
    () => validateByokDraft(
      apiProtocol,
      {
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
      },
      {
        requiresApiKey: byokRequiresApiKey,
        requireModel: false,
        keyValidationBaseUrl: byokKeyValidationBaseUrl,
      },
    ),
    [
      apiProtocol,
      byokKeyValidationBaseUrl,
      byokRequiresApiKey,
      cfg.apiKey,
      cfg.baseUrl,
      cfg.model,
    ],
  );
  const providerModelsKey = useMemo(
    () => providerModelsCacheKey(
      apiProtocol,
      cfg.baseUrl,
      cfg.apiKey,
      cfg.apiVersion ?? '',
    ),
    [apiProtocol, cfg.baseUrl, cfg.apiKey, cfg.apiVersion],
  );
  const providerModelDiscoveryUnavailable =
    apiProtocol !== 'azure' &&
    apiProtocol !== 'ollama' &&
    isProviderModelDiscoveryUnsupported(apiProtocol, cfg.baseUrl);
  const providerModelDiscoverySupported =
    apiProtocol !== 'azure' &&
    apiProtocol !== 'ollama' &&
    !providerModelDiscoveryUnavailable;
  const fetchedApiModelOptions =
    providerModelDiscoveryUnavailable
      ? []
      : activeProviderModelsCache[providerModelsKey] ?? [];
  const providerPreferredModels =
    selectedProvider?.preferredModels ?? SUGGESTED_MODELS_BY_PROTOCOL[apiProtocol];
  const providerManagedModelIds = useMemo(
    () => new Set([
      ...providerPreferredModels,
      ...(selectedProvider?.retiredModels ?? []),
    ]),
    [providerPreferredModels, selectedProvider],
  );
  const fetchedApiModelIds = useMemo(
    () => new Set(fetchedApiModelOptions.map((model) => model.id.trim())),
    [fetchedApiModelOptions],
  );
  const pendingProviderModelReconciliation = (() => {
    if (cfg.mode !== 'api' || apiModelCustomEditing) return null;
    if (apiModelUserSelectedRef.current) return null;
    if (fetchedApiModelOptions.length === 0) return null;
    const currentModel = cfg.model.trim();
    if (currentModel && fetchedApiModelIds.has(currentModel)) return null;
    if (currentModel && !providerManagedModelIds.has(currentModel)) return null;
    const preference = resolveByokModelPreference({
      currentModel: '',
      accountModels: fetchedApiModelOptions,
      providerPreferredModels,
    });
    return preference.model === currentModel ? null : preference.model;
  })();
  const commitProviderModelsInputs = () => {
    if (
      byokFirstPartyBaseUrl?.hostTypo ||
      blockingByokDraftIssues(byokModelFetchDraftValidation).length > 0
    ) {
      setProviderModelsCommittedKey(null);
      return;
    }
    setProviderModelsCommittedKey(providerModelsKey);
  };
  const onByokKeyCommit = () => {
    // Normalize the stored key on blur so the value that flows into the
    // connection-test / model-fetch requests below (and back to the daemon
    // via autosave) is already free of pasted whitespace / zero-width
    // characters — otherwise a key like "sk-ant-...\n" would only raise a
    // non-blocking warning yet still go out malformed over the wire.
    const cleanedApiKey = cleanByokApiKey(cfg.apiKey);
    const currentProviderKey = byokProviderKeyForConfig(cfg);
    const activeConfig = autosaveLastSavedRef.current;
    const commitsClearedActiveApiKey =
      cleanedApiKey === ''
      && activeConfig.mode === 'api'
      && activeConfig.apiKey.trim() !== ''
      && currentProviderKey === byokProviderKeyForConfig(activeConfig);
    committedClearedByokProviderKeyRef.current = commitsClearedActiveApiKey
      ? currentProviderKey
      : null;
    if (commitsClearedActiveApiKey) {
      setAutosaveCommitTick((tick) => tick + 1);
    }
    if (cleanedApiKey !== cfg.apiKey) {
      // Writing the cleaned key changes cfg.apiKey, which re-runs the reset
      // effects above: one nulls providerModelsCommittedKey, the other bumps
      // providerTestRevisionRef / clears providerAutoTestKeyRef. So committing
      // the model key or starting the auto-test here would be clobbered — the
      // model commit before the auto-fetch effect reads it. Defer the commit
      // until the cleaned value has landed (effect below); connection testing
      // waits for model discovery and reconciliation.
      deferAfterKeyCleanRef.current = true;
      updateApiConfig({ apiKey: cleanedApiKey });
      return;
    }
    commitProviderModelsInputs();
  };
  useEffect(() => {
    if (!deferAfterKeyCleanRef.current) return;
    deferAfterKeyCleanRef.current = false;
    if (
      byokFirstPartyBaseUrl?.hostTypo ||
      blockingByokDraftIssues(byokModelFetchDraftValidation).length > 0
    ) {
      setProviderModelsCommittedKey(null);
    } else {
      setProviderModelsCommittedKey(providerModelsKey);
    }
  }, [
    byokFirstPartyBaseUrl?.hostTypo,
    byokModelFetchDraftValidation,
    cfg.apiKey,
    providerModelsKey,
  ]);
  useEffect(() => {
    if (cfg.mode !== 'api') return;
    if (visualStabilityMode) return;
    if (providerTestState.status === 'running') return;
    if (byokFirstPartyBaseUrl?.hostTypo) return;
    if (blockingByokDraftIssues(byokDraftValidation).length > 0) return;
    if (providerModelDiscoverySupported) {
      if (
        apiProtocol !== 'aihubmix' &&
        providerModelsCommittedKey !== providerModelsKey
      ) {
        const timer = window.setTimeout(() => {
          setProviderModelsCommittedKey(providerModelsKey);
        }, 200);
        return () => window.clearTimeout(timer);
      }
      if (
        providerModelsState.status !== 'done' ||
        providerModelsState.cacheKey !== providerModelsKey
      ) return;
      if (
        !providerModelsState.result.ok &&
        (
          providerModelsState.result.kind === 'auth_failed' ||
          providerModelsState.result.kind === 'forbidden'
        )
      ) return;
      if (pendingProviderModelReconciliation !== null) return;
    }
    const key = providerConnectionTestKey(apiProtocol, cfg);
    if (providerAutoTestKeyRef.current === key) return;
    const timer = window.setTimeout(() => {
      handleAutoTestProvider();
    }, providerModelDiscoverySupported ? 0 : 500);
    return () => window.clearTimeout(timer);
  }, [
    apiProtocol,
    byokFirstPartyBaseUrl?.hostTypo,
    byokDraftValidation,
    cfg.apiKey,
    cfg.apiVersion,
    cfg.baseUrl,
    cfg.mode,
    cfg.model,
    providerModelDiscoverySupported,
    pendingProviderModelReconciliation,
    providerModelsCommittedKey,
    providerModelsKey,
    providerModelsState,
    providerTestState.status,
    visualStabilityMode,
  ]);
  useEffect(() => {
    if (cfg.mode !== 'api') return;
    if (visualStabilityMode) return;
    if (isProviderModelDiscoveryUnsupported(apiProtocol, cfg.baseUrl)) return;
    if (byokFirstPartyBaseUrl?.hostTypo) return;
    if (blockingByokDraftIssues(byokModelFetchDraftValidation).length > 0) return;
    // AIHubMix needs no key and prefills its base URL, so there's nothing to
    // debounce-commit — fetch as soon as the tab is selected. Every other
    // protocol waits until the key/baseUrl inputs are committed (on blur) so we
    // don't fire on each keystroke.
    if (apiProtocol !== 'aihubmix' && providerModelsCommittedKey !== providerModelsKey) return;
    const timer = window.setTimeout(() => {
      void handleFetchProviderModels({ silent: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    apiProtocol,
    byokFirstPartyBaseUrl?.hostTypo,
    cfg.apiKey,
    cfg.baseUrl,
    cfg.mode,
    cfg.apiVersion,
    byokModelFetchDraftValidation,
    providerModelsCommittedKey,
    providerModelsKey,
    visualStabilityMode,
  ]);
  const currentProviderModelsResult =
    providerModelsState.status === 'done' &&
    providerModelsState.cacheKey === providerModelsKey
      ? providerModelsState.result
      : null;
  const loadedAccountModelCount =
    currentProviderModelsResult?.ok && currentProviderModelsResult.models?.length
      ? currentProviderModelsResult.models.length
      : 0;
  const apiKeyAuthFailed =
    currentProviderModelsResult?.ok === false &&
    currentProviderModelsResult.kind === 'auth_failed';
  const providerModelsFailureMessage =
    currentProviderModelsResult?.ok === false && !apiKeyAuthFailed
      ? t('settings.fetchModelsFailed', {
          detail:
            currentProviderModelsResult.detail ||
            currentProviderModelsResult.kind,
        })
      : null;
  const providerTestBaseUrlInvalid =
    providerTestState.status === 'done' &&
    !providerTestState.result.ok &&
    providerTestState.result.kind === 'invalid_base_url';
  const providerTestApiKeyAuthFailed =
    providerTestState.status === 'done' &&
    !providerTestState.result.ok &&
    providerTestState.result.kind === 'auth_failed';
  const apiKeyFieldAuthFailed =
    providerTestApiKeyAuthFailed ||
    (apiKeyAuthFailed && providerTestState.status === 'idle');
  const baseUrlErrorMessage = baseUrlInvalid
    ? t('settings.baseUrlInvalid')
    : providerTestBaseUrlInvalid || byokFirstPartyBaseUrl?.hostTypo
      ? (
        providerTestState.status === 'done' &&
        providerTestState.result.detail?.trim()
          ? providerTestState.result.detail.trim()
          : t('settings.testInvalidBaseUrl')
      )
      : null;
  const suggestedApiModelIds = useMemo(
    () => {
      if (providerModelDiscoveryUnavailable) {
        return selectedProvider?.preferredModels.length
          ? Array.from(new Set(selectedProvider.preferredModels))
          : [];
      }
      return Array.from(new Set(
        selectedProvider?.preferredModels.length
          ? selectedProvider.preferredModels
          : SUGGESTED_MODELS_BY_PROTOCOL[apiProtocol],
      ));
    },
    [apiProtocol, selectedProvider, providerModelDiscoveryUnavailable],
  );
  const apiModelOptions = useMemo(
    () => mergeProviderModelOptions(
      fetchedApiModelOptions,
      suggestedApiModelIds,
    ),
    [fetchedApiModelOptions, suggestedApiModelIds],
  );
  // Shared hook: live AIHubMix catalogue for aihubmix, static registry for
  // other providers (same list the chat composer's image picker uses).
  const byokImageModelOptions = useByokImageModelOptions(apiProtocol);
  const byokVideoModelOptions = useByokVideoModelOptions(apiProtocol);
  const byokSpeechModelOptions = useByokSpeechModelOptions(apiProtocol);
  const apiModelIds = useMemo(
    () => apiModelOptions.map((m) => m.id),
    [apiModelOptions],
  );
  useEffect(() => {
    if (pendingProviderModelReconciliation === null) return;
    updateApiConfig({ model: pendingProviderModelReconciliation });
  }, [
    pendingProviderModelReconciliation,
  ]);
  const apiModelCustomActive =
    shouldShowCustomModelInput(
      cfg.model,
      apiModelIds,
      apiModelCustomEditing,
    );
  const baseUrlReadOnly =
    (apiProtocol === 'anthropic' || apiProtocol === 'google') &&
    cfg.apiProviderBaseUrl !== null &&
    Boolean(cfg.baseUrl.trim()) &&
    !baseUrlInvalid;
  const baseUrlPlaceholder =
    apiProtocol === 'azure'
      ? t('settings.azureBaseUrlPlaceholder')
      : apiProtocol === 'ollama'
        ? 'http://localhost:11434'
        : undefined;
  useEffect(() => {
    if (!focusByokRequiredFieldAfterProtocolSwitchRef.current) return;
    focusByokRequiredFieldAfterProtocolSwitchRef.current = false;
    focusByokRequiredField(
      missingByokConnectionFields(cfg, {
        requiresApiKey: byokRequiresApiKey,
      })[0],
    );
  }, [apiModelCustomActive, cfg, apiProtocol, byokRequiresApiKey]);

  // Header title/subtitle follow the active page, and come from the same nav
  // entry as the sidebar row so the two can never disagree. `mcpClient` has
  // no nav row (external MCP lives in the top-level Integrations view) and is
  // only reachable through `initialSection`.
  const activeNavItem = settingsNavItem(activeSection);
  const activeHeader = activeNavItem
    ? { title: t(activeNavItem.labelKey), subtitle: t(activeNavItem.descriptionKey) }
    : { title: t('settings.externalMcpTitle'), subtitle: t('settings.externalMcpHint') };
  // Builds without an account service show nothing cloud in the nav; a deep
  // link to the section still explains why.
  const accountNavVisible = activeSection === 'account' || (
    openPixoAccount.status !== null && openPixoAccount.status.availability !== 'not_configured'
  );
  const visibleAgents = agents.filter(isVisibleLocalCliAgent);
  const installedAgents = visibleAgents
    .filter((agent) => agent.available)
    .sort((a, b) => Number(b.id === 'codex') - Number(a.id === 'codex')
      || Number(false) - Number(false));
  const unavailableAgents = visibleAgents.filter(
    (agent) => !agent.available,
  );
  const initialAgentScanRunning = agentsLoading && agents.length === 0;
  const agentModelOptionLabel = (
    model: ProviderModelOption | undefined,
    fallback: string,
  ) => {
    if (!model) return fallback;
    if (model.id === 'default') return t('settings.modelUsesCliDefault');
    const label = model.label?.trim();
    const id = model.id.trim();
    if (label && label !== id) {
      return label.toLowerCase().includes(id.toLowerCase())
        ? label
        : `${label} (${id})`;
    }
    return label || id;
  };
  const agentModelSummary = (agent: AgentInfo) => {
    if (!Array.isArray(agent.models) || agent.models.length === 0) return null;
    const choice = cfg.agentModels?.[agent.id] ?? {};
    const modelValue = choice.model ?? defaultAgentModelId(agent) ?? '';
    if (!modelValue) return t('settings.modelCustom');
    return agentModelOptionLabel(
      agent.models.find((m) => m.id === modelValue),
      modelValue,
    );
  };
  const renderAgentModelConfig = (selected: AgentInfo) => {
    const hasModels =
      Array.isArray(selected.models) && selected.models.length > 0;
    const configuredModelId =
      cfg.agentModels?.[selected.id]?.model ?? defaultAgentModelId(selected);
    const modelReasoningOptions = selected.models?.find(
      (model) => model.id === configuredModelId,
    )?.reasoningOptions;
    const activeReasoningOptions = modelReasoningOptions ?? selected.reasoningOptions;
    const hasReasoning =
      Array.isArray(activeReasoningOptions) &&
      activeReasoningOptions.length > 0;

    if (!hasModels && !hasReasoning) return null;
    const choice = cfg.agentModels?.[selected.id] ?? {};
    const modelsForSelect = (
      selected.models
    )?.map((model) =>
      model.id === 'default'
        ? { ...model, label: t('settings.modelUsesCliDefault') }
        : model,
    );
    const knownModelIds = selected.models?.map((m) => m.id) ?? [];
    // Adapters opt out via `supportsCustomModel: false` on their
    // RuntimeAgentDef when their CLI has no `--model` flag.
    // Undefined means allow.
    const allowCustomModel = selected.supportsCustomModel !== false;
    const explicitCustomMode = agentCustomModelIds.has(selected.id);
    const configuredModel =
      typeof choice.model === 'string' && choice.model
        ? choice.model
        : null;
    const customModelDraft =
      explicitCustomMode && typeof choice.model === 'string'
        ? choice.model
        : null;
    const setChoice = (
      next: { model?: string; reasoning?: string; serviceTier?: string },
    ) => {
      setCfg((c) => {
        const prev = c.agentModels?.[selected.id] ?? {};
        const merged = { ...prev, ...next };
        if (
          Object.prototype.hasOwnProperty.call(next, 'serviceTier') &&
          next.serviceTier === undefined
        ) {
          delete merged.serviceTier;
        }
        return {
          ...c,
          agentModels: {
            ...(c.agentModels ?? {}),
            [selected.id]: merged,
          },
        };
      });
    };
    const fallbackModelValue =
      configuredModel ?? defaultAgentModelId(selected) ?? '';
    const modelValue = customModelDraft ?? fallbackModelValue;
    const reasoningValue =
      activeReasoningOptions?.some((option) => option.id === choice.reasoning)
        ? choice.reasoning!
        : activeReasoningOptions?.find((option) => option.default)?.id ??
          activeReasoningOptions?.[0]?.id ?? '';
    const customActive =
      allowCustomModel &&
      hasModels &&
      shouldShowCustomModelInput(
        modelValue,
        knownModelIds,
        explicitCustomMode,
      );
    const selectValue = customActive
      ? CUSTOM_MODEL_SENTINEL
      : modelValue;
    const modelSource = selected.modelsSource ?? 'fallback';
    const modelSourceLabel =
      modelSource === 'live'
        ? t('settings.modelSourceLive')
        : t('settings.modelSourceFallback');
    return (
      <div className="agent-card-config">
        {hasModels ? (
          <>
            <label className="field">
              <span className="field-label">
                {t('settings.modelPicker')}
                <span
                  className={`agent-model-source-badge ${modelSource}`}
                  aria-hidden="true"
                >
                  {modelSourceLabel}
                </span>
              </span>
              <div className="agent-model-select-wrap">
                <SearchableModelSelect
                  className="inline-switcher__select settings-model-select"
                  popoverClassName="settings-model-popover"
                  value={selectValue}
                  aria-label={t('settings.modelPicker')}
                  searchPlaceholder={t('designs.searchPlaceholder')}
                  searchInputTestId={`settings-agent-model-search-${selected.id}`}
                  popoverTestId={`settings-agent-model-popover-${selected.id}`}
                  minSearchableOptions={5}
                  popoverMinWidth={340}
                  groupByCompany={false}
                  models={modelsForSelect!}
                  onChange={(nextValue) => {
                    if (nextValue === CUSTOM_MODEL_SENTINEL) {
                      setAgentCustomModelIds((prev) => {
                        const next = new Set(prev);
                        next.add(selected.id);
                        return next;
                      });
                      setChoice({ model: '', serviceTier: undefined });
                    } else {
                      setAgentCustomModelIds((prev) => {
                        if (!prev.has(selected.id)) return prev;
                        const next = new Set(prev);
                        next.delete(selected.id);
                        return next;
                      });
                      const nextModelOption = selected.models?.find((m) => m.id === nextValue);
                      const nextServiceTierOptions =
                        nextModelOption?.serviceTierOptions ?? [];
                      setChoice({
                        model: nextValue,
                        serviceTier: nextServiceTierOptions.some(
                          (tier) => tier.id === choice.serviceTier,
                        )
                          ? choice.serviceTier
                          : undefined,
                      });
                    }
                  }}
                  additionalOptions={
                    allowCustomModel
                      ? [
                          {
                            value: CUSTOM_MODEL_SENTINEL,
                            label: t('settings.modelCustom'),
                          },
                        ]
                      : undefined
                  }
                  disabledOptionHint={
                    undefined
                  }
                />
              </div>
            </label>
          </>
        ) : null}
        {customActive ? (
          <label className="field">
            <span className="field-label">
              {t('settings.modelCustomLabel')}
            </span>
            <input
              type="text"
              value={modelValue}
              placeholder={t('settings.modelCustomPlaceholder')}
              onChange={(e) =>
                setChoice({ model: e.target.value.trim(), serviceTier: undefined })
              }
            />
          </label>
        ) : null}
        {hasReasoning ? (
          <label className="field">
            <span className="field-label">
              {t('settings.reasoningPicker')}
            </span>
            <div className="agent-model-select-wrap">
              <select
                value={reasoningValue}
                onChange={(e) =>
                  setChoice({ reasoning: e.target.value })
                }
              >
                {activeReasoningOptions!.map((r) => (
                  <option key={r.id} value={r.id}>
                    {effortOptionLabel(r, t)}
                  </option>
                ))}
              </select>
              <Icon
                name="chevron-down"
                size={12}
                className="agent-model-select-chevron"
              />
            </div>
          </label>
        ) : null}
      </div>
    );
  };

  const settingsSidebarToggleLabel = settingsSidebarCollapsed
    ? t('settings.sidebarExpand')
    : t('settings.sidebarCollapse');
  const settingsFullscreenLabel = settingsFullscreen
    ? t('common.exitFullscreen')
    : t('common.fullscreen');
  const pageMode = presentation === 'page';
  useEffect(() => {
    if (!pageMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="alertdialog"]')) onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pageMode, onDismiss]);

  const surface = (
      <div
        className={
          'modal modal-settings' +
          (pageMode ? ' settings-page-surface' : '') +
          (settingsSidebarCollapsed ? ' settings-sidebar-collapsed' : '') +
          (!pageMode && settingsFullscreen ? ' settings-fullscreen' : '')
        }
        role={pageMode ? 'region' : undefined}
        aria-labelledby="settings-dialog-title"
        onClick={pageMode ? undefined : (e) => e.stopPropagation()}
      >
        {/* Autosave feedback is viewport-level rather than part of the
            top-right dialog chrome: it rides the app's own top chrome row, so
            a passive status never covers the Local CLI pickers that occupy the
            panel's upper band (OPEND-2148). */}
        <div className="settings-autosave-layer">
          <div
            className={`settings-autosave is-${autosaveStatus}`}
            role="status"
            aria-live="polite"
          >
            {autosaveStatus === 'saving' || autosaveStatus === 'pending' ? (
              <>
                <Icon name="spinner" size={12} className="icon-spin" />
                <span>{t('settings.autosaveSaving')}</span>
              </>
            ) : autosaveStatus === 'saved' ? (
              <>
                <Icon name="check" size={12} />
                <span>{t('settings.autosaveSaved')}</span>
              </>
            ) : autosaveStatus === 'error' ? (
              <>
                <Icon name="close" size={12} />
                <span>{t('settings.autosaveError')}</span>
              </>
            ) : null}
          </div>
        </div>
        {/* Top-right chrome strip — anchored to the modal corner so the
            close and fullscreen controls stay at a stable optical location
            regardless of the header copy. */}
        <div className="settings-chrome" aria-hidden={false}>
          {pageMode ? null : (
            <button
              type="button"
              className="settings-chrome-btn settings-fullscreen-toggle"
              onClick={() => setSettingsFullscreen((current) => !current)}
              aria-label={settingsFullscreenLabel}
              aria-pressed={settingsFullscreen}
              title={settingsFullscreenLabel}
            >
              <Icon
                name={settingsFullscreen ? 'minimize' : 'maximize'}
                size={15}
                strokeWidth={2}
              />
            </button>
          )}
          <button
            type="button"
            className="settings-chrome-btn settings-close"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <Icon name="close" size={16} strokeWidth={2} />
          </button>
        </div>
        {/* Page mode titles each page inside the content column instead
            (SettingsPageHeader), so the modal header is not rendered there. */}
        {pageMode ? null : (
        <header className="modal-head" id="settings-dialog-title">
          {welcome ? (
            <>
              <span className="kicker">{t('settings.welcomeKicker')}</span>
              <h2>{t('settings.welcomeTitle')}</h2>
              <p className="subtitle">{t('settings.welcomeSubtitle')}</p>
            </>
          ) : (
            <>
              <span className="kicker">{t('settings.kicker')}</span>
              <div className="modal-head-line">
                <h2>{activeHeader.title}</h2>
                <p className="subtitle">{activeHeader.subtitle}</p>
              </div>
            </>
          )}
        </header>
        )}

        <div className="modal-body">
          <button
            type="button"
            className="settings-sidebar-toggle"
            onClick={() => setSettingsSidebarCollapsed((current) => !current)}
            aria-label={settingsSidebarToggleLabel}
            aria-pressed={settingsSidebarCollapsed}
            aria-controls="settings-sidebar"
            title={settingsSidebarToggleLabel}
          >
            <Icon
              name={settingsSidebarCollapsed ? 'chevron-right' : 'chevron-left'}
              size={15}
              strokeWidth={2}
            />
          </button>
          <aside
            id="settings-sidebar"
            className="settings-sidebar"
            aria-label={t('settings.navAria')}
            aria-hidden={settingsSidebarCollapsed ? true : undefined}
          >
            {pageMode ? (
              <div className="settings-page-nav-head">
                <button
                  type="button"
                  className="settings-page-back"
                  onClick={onClose}
                >
                  <Icon name="arrow-left" size={15} />
                  <span>{t('settings.pageBackToHome')}</span>
                </button>
              </div>
            ) : null}
            <SettingsNav
              activePage={activeSection}
              onSelect={setActiveSection}
              isVisible={(item) => item.page !== 'account' || accountNavVisible}
            />
          </aside>
          <div className="settings-content" ref={settingsContentRef}>
          {pageMode ? (
            <SettingsPageHeader
              id="settings-dialog-title"
              title={activeHeader.title}
              description={activeHeader.subtitle}
            />
          ) : null}
          {activeSection === 'doctor' ? <DoctorSection onOpenSettings={setActiveSection} /> : null}
          {activeSection === 'execution' ? (
            <>
              {/* Sticky shell: the 本机 CLI / API 提供商 switch stays pinned
                  while the agent list scrolls. The wrapper (not .seg-control
                  itself) is sticky so it can paint an opaque full-width strip
                  behind the pill — otherwise cards would show through around
                  the pill's rounded corners mid-scroll. */}
              <div className="settings-execution-sticky">
              <div
                className="seg-control"
                role="tablist"
                aria-label={t('settings.modeAria')}
                style={{ ['--seg-cols' as string]: 2 } as CSSProperties}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={cfg.mode === 'daemon'}
                  className={
                    'seg-btn seg-btn--inline' +
                    (cfg.mode === 'daemon' ? ' active' : '')
                  }
                  disabled={!daemonLive}
                  onClick={() => setMode('daemon')}
                  title={
                    daemonLive
                      ? t('settings.modeDaemonHelp')
                      : t('settings.modeDaemonOffline')
                  }
                >
                  <span className="seg-title">{t('settings.localCli')}</span>
                  <span className="seg-meta">
                    {daemonLive
                      ? t('settings.modeDaemonInstalledMeta', { count: installedCount })
                      : t('settings.modeDaemonOfflineMeta')}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={cfg.mode === 'api'}
                  className={
                    'seg-btn seg-btn--inline' +
                    (cfg.mode === 'api' ? ' active' : '')
                  }
                  onClick={() => setMode('api')}
                >
                  <span className="seg-title">{t('settings.modeApiMeta')}</span>
                  <span className="seg-meta">{t('settings.modeApi')}</span>
                </button>
              </div>
              </div>
              {null}
              {cfg.mode === 'api' ? (
                <div
                  className="protocol-chips protocol-chips--providers"
                  role="tablist"
                  aria-label={t('settings.protocolAria')}
                >
                  <div className="protocol-chip-group protocol-chip-group--providers">
                    <div className="protocol-chip-group-options">
                      {byokProviderOptions.map((provider) => {
                        const active = selectedByokProvider?.id === provider.id;
                        const configured = byokProviderConfigured(provider);
                        const statusLabel = configured
                          ? t('settings.mediaProviderConfigured')
                          : t('settings.mediaProviderUnset');
                        return (
                          <button
                            key={provider.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            aria-label={provider.title}
                            className={'protocol-chip protocol-chip--provider' + (active ? ' active' : '')}
                            title={`${provider.title} - ${statusLabel}`}
                            onClick={() => {
                              const byokProviderId = byokProtocolToTracking(provider.protocol);
                              if (byokProviderId) {
                                trackSettingsByokProviderOptionClick(analytics.track, {
                                  page_name: 'settings',
                                  area: 'configure_execution_mode_byok',
                                  element: 'byok_provider_option',
                                  action: 'select_byok_provider',
                                  provider_id: byokProviderId,
                                  is_selected: active,
                                });
                              }
                              if (!active) {
                                setByokProvider(provider);
                              }
                            }}
                          >
                            <span
                              className={`protocol-chip-status${configured ? ' is-configured' : ' is-unset'}`}
                              aria-hidden
                            />
                            <span>{provider.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
          {cfg.mode === 'daemon' ? (
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <p className="hint">{t('settings.codeAgentHint')}</p>
                </div>
              </div>
              {initialAgentScanRunning ? (
                <div className="agent-scan-card" role="status" aria-live="polite">
                  <div className="agent-scan-card__stage">
                    <span className="agent-scan-card__ring" aria-hidden />
                    <strong>{t('settings.rescanRunning')}</strong>
                    <span>{t('settings.codeAgentHint')}</span>
                    <div className="agent-scan-card__progress" aria-hidden>
                      <span />
                    </div>
                  </div>
                  <div className="agent-scan-card__rows" aria-hidden>
                    <span><i /><b /><em /></span>
                    <span><i /><b /><em /></span>
                    <span><i /><b /><em /></span>
                  </div>
                </div>
              ) : agents.length === 0 ? (
                <div className="empty-card">
                  {t('settings.noAgentsDetected')}
                </div>
              ) : (
                <>
                  <div className="agent-group">
                    <div className="agent-group-head">
                      <h4>
                        {t('settings.agentInstalledGroup', {
                          count: installedAgents.length,
                        })}
                      </h4>
                      <div className="agent-group-head-actions">
                        {agentRescanNotice ? (
                          <span
                            className={
                              'settings-rescan-status settings-rescan-status-inline ' +
                              agentRescanNotice.kind
                            }
                            role={
                              agentRescanNotice.kind === 'error'
                                ? 'alert'
                                : 'status'
                            }
                          >
                            {agentRescanNotice.kind === 'success'
                              ? t('settings.rescanSuccess', {
                                  count: agentRescanNotice.count,
                                })
                              : t('settings.rescanFailed')}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className={
                            'ghost icon-btn settings-rescan-btn agent-group-rescan-btn' +
                            (agentRescanRunning ? ' loading' : '')
                          }
                          onClick={() => void handleRefreshAgents()}
                          disabled={agentRescanRunning}
                          title={t('settings.rescanTitle')}
                        >
                          {agentRescanRunning ? (
                            <>
                              <Icon
                                name="spinner"
                                size={13}
                                className="icon-spin"
                              />
                              <span>{t('settings.rescanRunning')}</span>
                            </>
                          ) : (
                            t('settings.rescan')
                          )}
                        </button>
                      </div>
                    </div>
                    {installedAgents.length > 0 ? (
                      <div className="agent-grid agent-grid-installed">
                        {installedAgents.map((a) => {
                          const active =
                            cfg.agentId === a.id;
                          const running =
                            active && agentTestState.status === 'running';
                          const description = agentShortDescription(a.id, t);
                          const agentName = displayAgentName(a);
                          const diagnosticHandlers = diagnosticHandlersForAgent(a);
                          const modelSummary = agentModelSummary(a);
                          const versionLabel =
                            cleanAgentVersionLabel(a.name, a.version);
                          const metaLabel =
                            a.authStatus === 'missing'
                              ? t('settings.agentAuthRequired')
                              : a.authStatus === 'unknown'
                                ? t('settings.agentAuthUnknown')
                                : versionLabel
                                  ? versionLabel
                                  : t('common.installed');
                          const metaTitle =
                            a.authStatus === 'missing' ||
                            a.authStatus === 'unknown'
                              ? (a.authMessage ?? a.path ?? '')
                              : (a.path ?? '');
                          const cardEl = (
                            <div
                              key={a.id}
                              ref={undefined}
                              data-testid={`settings-agent-card-${a.id}`}
                              className={
                                'agent-card agent-card-installed' +
                                (active ? ' active' : '') +
                                ('') +
                                ('')
                              }
                            >
                              <div className="agent-card-main">
                                <button
                                  type="button"
                                  className="agent-card-select"
                                  data-testid={`settings-agent-select-${a.id}`}
                                  onClick={() => {
                                    trackSettingsLocalCliClick(analytics.track, {
                                      page_name: 'settings',
                                      area: 'configure_execution_mode_local_cli',
                                      element: 'cli_provider',
                                      cli_provider_id: agentIdToTracking(a.id),
                                      install_status: 'installed',
                                    });

                                    setCfg((c) => ({ ...c, agentId: a.id }));
                                    onAgentSelect?.(a.id);
                                  }}
                                  aria-pressed={active}
                                  >
                                    <AgentIcon id={a.id} size={32} />
                                    <div className="agent-card-body">
                                      <div
                                        className={
                                          'agent-card-name' +
                                          ('')
                                        }
                                      >
                                        <span className="agent-card-title">
                                          {agentName}
                                        </span>
                                        {description ? (
                                          <>
                                            <span
                                              className="agent-card-name-divider"
                                              aria-hidden="true"
                                            >
                                              ·
                                            </span>
                                            <span className="agent-card-tagline">
                                              {description}
                                            </span>
                                          </>
                                        ) : null}
                                        {null}
                                      </div>
                                      {metaLabel ? (
                                        <div className="agent-card-meta">
                                          <span title={metaTitle}>
                                            {metaLabel}
                                          </span>
                                        </div>
                                      ) : null}
                                      {null}
                                      {!active && modelSummary ? (
                                        <div className="agent-card-model-summary">
                                          <span>{t('settings.modelPicker')}</span>
                                          <strong>{modelSummary}</strong>
                                        </div>
                                      ) : null}
                                  </div>
                                </button>
                                {null}
                                {active && true ? (
                                  <button
                                    type="button"
                                    className={
                                      'ghost icon-btn settings-test-btn agent-card-test-btn' +
                                      (running ? ' loading' : '')
                                    }
                                    onClick={() => void handleTestAgent()}
                                    disabled={running}
                                    title={t('settings.testTitle')}
                                  >
                                    {running ? (
                                      <>
                                        <Icon
                                          name="spinner"
                                          size={13}
                                          className="icon-spin"
                                        />
                                        <span>{t('settings.test')}</span>
                                      </>
                                    ) : (
                                      t('settings.test')
                                    )}
                                  </button>
                                ) : null}
                              </div>
                              {/* Diagnostics belong to the expanded card only:
                                  collapsed cards all present the same compact
                                  summary regardless of agent health. */}
                              {active
                                ? (a.diagnostics ?? []).map((diagnostic, i) => (
                                    <AgentDiagnosticRow
                                      key={`${diagnostic.reason}-${i}`}
                                      diagnostic={diagnostic}
                                      handlers={diagnosticHandlers}
                                      className="agent-card-diagnostic"
                                    />
                                  ))
                                : null}
                              {active ? renderAgentModelConfig(a) : null}
                            </div>
                          );
                          if (active && agentTestState.status !== 'idle') {
                            const resultRow = (
                              <div
                                key={`${a.id}__test-result`}
                                className="agent-test-result-row"
                              >
                                {agentTestState.status === 'running' ? (
                                  <p
                                    className="settings-test-status running"
                                    role="status"
                                    aria-live="polite"
                                  >
                                    {t('settings.testRunning')}
                                  </p>
                                ) : (
                                  <>
                                    <p
                                      className={
                                        'settings-test-status ' +
                                        testStatusVariant(agentTestState.result)
                                      }
                                      role={
                                        agentTestState.result.ok
                                          ? 'status'
                                          : 'alert'
                                      }
                                    >
                                      {renderTestMessage(
                                        agentTestState.result,
                                        'cli',
                                      )}
                                    </p>
                                    {!agentTestState.result.ok ? (
                                      <div className="settings-test-actions">
                                        <div className="settings-test-actions-row">
                                          <button
                                            type="button"
                                            className="ghost icon-btn settings-test-btn"
                                            onClick={() => void handleTestAgent()}
                                          >
                                            <Icon name="reload" size={13} />
                                            <span>{t('settings.testRetry')}</span>
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                    {cfg.agentId === 'codex' && (() => {
                                      const repair = codexPathRepairState(
                                        agentTestState.result,
                                      );
                                      if (!repair) return null;
                                      const codexStrings = codexPathStrings(locale);
                                      return (
                                        <div className="settings-test-actions">
                                          <span className="settings-test-actions-hint">
                                            {codexStrings.repairHint}
                                          </span>
                                          <div className="settings-test-actions-row">
                                            {repair.canUseDetected ? (
                                              <button
                                                type="button"
                                                className="settings-test-btn"
                                                onClick={() =>
                                                  applyCodexDetectedPath(
                                                    repair.detectedPath,
                                                  )
                                                }
                                              >
                                                {codexStrings.useDetected}
                                              </button>
                                            ) : null}
                                            <button
                                              type="button"
                                              className="ghost icon-btn settings-rescan-btn"
                                              onClick={clearCodexCustomPath}
                                            >
                                              {codexStrings.clearCustom}
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </>
                                )}
                              </div>
                            );
                            return [cardEl, resultRow];
                          }
                          return [cardEl];
                        })}
                      </div>
                    ) : (
                      <div className="empty-card">
                        {t('settings.noAgentsDetected')}
                      </div>
                    )}
                  </div>
                  {unavailableAgents.length > 0 ? (
                    <details
                      className="agent-install-collapse"
                      open={installedAgents.length > 0 ? undefined : true}
                    >
                      <summary className="agent-install-collapse-summary">
                        <span>
                          {t('settings.agentInstallGroup', {
                            count: unavailableAgents.length,
                          })}
                        </span>
                      </summary>
                      <div className="agent-grid agent-grid-unavailable">
                        {unavailableAgents.map((a) => {
                          const installUrl = sanitizeHttpsUrl(a.installUrl);
                          const docsUrl = sanitizeHttpsUrl(a.docsUrl);
                          const description = agentShortDescription(a.id, t);
                          const agentName = displayAgentName(a);
                          const diagnosticHandlers = diagnosticHandlersForAgent(a);
                          const cardLabel = `${agentName} · ${t('common.notInstalled')}`;
                          return (
                            <div
                              key={a.id}
                              className="agent-card disabled agent-card-unavailable"
                              role="group"
                              aria-label={cardLabel}
                            >
                              <div className="agent-card-unavailable-row">
                                <AgentIcon id={a.id} size={30} />
                                <div className="agent-card-body">
                                  <div className="agent-card-name">
                                    {agentName}
                                  </div>
                                  {description ? (
                                    <div className="agent-card-description">
                                      {description}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              {/* Why is it unavailable? not-on-path vs a broken
                                  shim vs a bad *_BIN override each get a
                                  distinct, actionable line, full-width below the
                                  logo/name. Rendered message-only: the fix
                                  actions are hoisted into the shared footer bar
                                  so every control lives on one row. */}
                              {(a.diagnostics ?? []).map((diagnostic, i) => (
                                <AgentDiagnosticRow
                                  key={`${diagnostic.reason}-${i}`}
                                  diagnostic={diagnostic}
                                />
                              ))}
                              {/* Every action for the card collapses into one
                                  horizontal bar at the foot, fenced from the
                                  content above by a hair divider: Docs + Rescan
                                  as quiet icon buttons, Install as the primary
                                  labelled CTA holding the right edge. */}
                              <div className="agent-card-footer">
                                {docsUrl ? (
                                  <a
                                    href={docsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="agent-card-link agent-card-link--muted agent-card-link--icon"
                                    onClick={markAgentInstallIntent}
                                    title={t('settings.agentInstall.docs')}
                                    aria-label={t('settings.agentInstall.docs')}
                                  >
                                    <Icon name="file" size={15} />
                                  </a>
                                ) : null}
                                <button
                                  type="button"
                                  className="agent-card-link agent-card-link--muted agent-card-link--icon"
                                  onClick={() => diagnosticHandlers.onRescan?.()}
                                  title={t('settings.rescan')}
                                  aria-label={t('settings.rescan')}
                                >
                                  <Icon name="reload" size={15} />
                                </button>
                                {installUrl ? (
                                  <a
                                    href={installUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="agent-card-link agent-card-link--ghost"
                                    onClick={(event) => {
                                      markAgentInstallIntent();

                                    }}
                                  >
                                    {t('settings.agentInstall.install')}
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ) : null}
                  {/*
                    Show the install guide only when the user has *no*
                    working agent picked yet. Older logic surfaced it
                    whenever any agent on the support list was missing,
                    which fired for almost everyone (few people install
                    all 14 supported CLIs) — the four-step quickstart
                    then sat between the agent grid and the model picker
                    forever, even after the user had successfully picked
                    Claude Code months ago. Once a working agent is
                    selected, the guide has done its job and only adds
                    noise.
                  */}
                  {!agents.find(
                    (a) => a.id === cfg.agentId && a.available,
                  ) ? (
                    <div className="agent-install-guide">
                      <p className="hint agent-install-path-hint">
                        {t('settings.agentInstall.pathHint')}
                      </p>
                      <ol className="agent-install-steps">
                        <li>{t('settings.agentInstall.stepOpenLinks')}</li>
                        <li>{t('settings.agentInstall.stepAuth')}</li>
                        <li>{t('settings.agentInstall.stepRescan')}</li>
                        <li>{t('settings.agentInstall.stepSelect')}</li>
                      </ol>
                    </div>
                  ) : null}
                </>
              )}
              {daemonLive ? <AgentApprovalSettings
                agentId={cfg.agentId}
                mode={cfg.agentId ? cfg.agentApprovalModes?.[cfg.agentId] : undefined}
                onChange={(mode) => setCfg((current) => current.agentId ? {
                  ...current,
                  agentApprovalModes: { ...current.agentApprovalModes, [current.agentId]: mode },
                } : current)}
              /> : null}

              {(() => {
                /*
                  Per-agent CLI environment overrides — proxy URLs, custom
                  config dirs, and a binary path override. The previous
                  layout listed every supported agent's variables in one
                  long always-expanded block; for users on Claude Code
                  the Codex fields were just visual filler (and vice
                  versa), and the section hijacked Settings real estate
                  on every open even though nine in ten users never
                  touch it. Now: filtered to the *currently selected*
                  agent only, and folded into a collapsed disclosure
                  that opens to "Advanced: proxy & custom paths" — power
                  users who route through LiteLLM or installed the
                  binary out-of-PATH still have one click access; new
                  users no longer wonder "are these fields I forgot to
                  fill in?".
                */
                const cliEnvFields = AGENT_CLI_ENV_FIELDS.filter(
                  (field) => field.agentId === cfg.agentId,
                );
                if (cliEnvFields.length === 0) return null;
                return (
                  <details
                    className="agent-cli-env"
                    data-testid="settings-cli-env"
                  >
                    <summary className="agent-cli-env-summary">
                      <span className="agent-cli-env-summary-title">
                        {t('settings.cliEnvTitle')}
                      </span>
                    </summary>
                    <div className="agent-cli-env-body">
                      <p className="hint">{t('settings.cliEnvHint')}</p>
                      <div className="agent-cli-env-grid">
                        {cliEnvFields.map((field) => (
                          <label
                            className="field"
                            key={`${field.agentId}:${field.envKey}`}
                          >
                            <span className="field-label">
                              {t(field.labelKey)}
                              {'labelSuffix' in field
                                ? ` (${field.labelSuffix})`
                                : ''}
                            </span>
                            <input
                              type={
                                'secret' in field && field.secret
                                  ? 'password'
                                  : 'text'
                              }
                              value={
                                cfg.agentCliEnv?.[field.agentId]?.[
                                  field.envKey
                                ] ?? ''
                              }
                              placeholder={'pasteName' in field ? t('settings.cliEnvPastePlaceholder', { name: field.pasteName }) : field.placeholder}
                              spellCheck={false}
                              autoComplete="off"
                              onChange={(e) =>
                                setCfg((c) =>
                                  updateAgentCliEnvValue(
                                    c,
                                    field.agentId,
                                    field.envKey,
                                    e.target.value,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </details>
                );
              })()}
            </section>
          ) : (
            /*
              BYOK panel — wrap the per-protocol form in a bordered card so
              the chips above (Anthropic / OpenAI / Azure / Gemini / Ollama)
              visually own the content below. Without the card, the chip
              row and the form looked like two unrelated stripes; users
              had no anchor for "this is what I configured for the active
              tab", and switching tabs felt like the whole right column
              just reshuffled. The card lives on the same white-with-soft-
              border pattern as `.agent-model-row` so the two BYOK / CLI
              panels feel like the same family.
            */
            <section className="settings-section settings-section-card settings-section-byok">
              <div className="section-head">
                <div>
                  <div className="settings-byok-title">
                    <h3>{API_PROTOCOL_LABELS[apiProtocol]}</h3>
                    <span className="settings-byok-info-wrap">
                      <button
                        type="button"
                        className="settings-byok-info-button"
                        aria-label={byokRuntimeNotice}
                        aria-describedby="settings-byok-no-file-tools-tooltip"
                        data-testid="settings-byok-no-file-tools-trigger"
                      >
                        <Icon name="info" size={13} />
                      </button>
                      <span
                        id="settings-byok-no-file-tools-tooltip"
                        className="settings-byok-info-tooltip"
                        role="tooltip"
                        data-testid="settings-byok-no-file-tools-notice"
                      >
                        {byokRuntimeNotice}
                      </span>
                    </span>
                  </div>
                </div>
                <ByokConnectionTestControl
                  baseUrlValid={baseUrlValid}
                  canRunConnectionTest={
                    !byokFirstPartyBaseUrl?.hostTypo &&
                    canRunProviderConnectionTest(cfg, {
                      requiresApiKey: byokRequiresApiKey,
                    })
                  }
                  labels={{
                    readyToTest: t('settings.byokReadyToTest'),
                    test: t('settings.test'),
                    testRetry: t('settings.testRetry'),
                    testRunning: t('settings.testRunning'),
                    testTitle: t('settings.testTitle'),
                  }}
                  providerTestState={providerTestState}
                  renderTestMessage={(result) => renderTestMessage(result, 'api')}
                  suppressResultStatus={
                    providerTestBaseUrlInvalid || providerTestApiKeyAuthFailed
                  }
                  suppressReadyState={Boolean(
                    byokPreconditionNotice ||
                      apiKeyFieldAuthFailed ||
                      providerTestBaseUrlInvalid ||
                      byokBlockingDraftIssues.length > 0,
                  )}
                  onTestProvider={() => handleTestProvider()}
                />
              </div>
              {byokActivationPreflightReason ? (
                <p
                  className="settings-test-status warn"
                  role="status"
                  data-testid="settings-byok-draft-notice"
                >
                  {t('settings.byokDraftNotice')}
                </p>
              ) : null}
              {byokPreconditionNotice && !byokPreconditionNotice.field ? (
                <p
                  className="settings-test-status error"
                  role="alert"
                  aria-live="polite"
                  data-action={byokPreconditionNotice.action}
                >
                  {byokPreconditionNotice.message}
                </p>
              ) : null}
              {showProviderPreset ? (
                <ByokProviderPicker
                  label={t('settings.providerPreset')}
                  customProviderLabel={t('settings.customProvider')}
                  providers={protocolProviders}
                  selectedProviderIndex={selectedProviderIndex}
                  onCustomProviderSelect={() => {
                    setApiModelCustomEditing(false);
                    updateApiConfig({
                      baseUrl: '',
                      model: '',
                      apiProviderBaseUrl: null,
                    });
                  }}
                  onProviderSelect={(p) => {
                    setApiModelCustomEditing(false);
                    updateApiConfig({
                      baseUrl: p.baseUrl,
                      model: defaultKnownProviderModel(p),
                      apiProviderBaseUrl: p.baseUrl,
                    });
                  }}
                />
              ) : null}
              <ByokKeyField
                apiKey={cfg.apiKey}
                apiKeyConsoleLink={apiKeyConsoleLink}
                apiProtocol={apiProtocol}
                inputRef={apiKeyInputRef}
                labels={{
                  apiHint: t('settings.apiHint'),
                  apiKey: t('settings.apiKey'),
                  apiKeyCleaned: t('settings.apiKeyCleaned'),
                  apiKeyGetLink: t('settings.apiKeyGetLink', {
                    host: apiKeyConsoleLink.host,
                  }),
                  apiKeyInvalid: t('settings.apiKeyInvalid'),
                  hide: t('settings.hide'),
                  hideKey: t('settings.hideKey'),
                  required: t('settings.required'),
                  show: t('settings.show'),
                  showKey: t('settings.showKey'),
                }}
                requiresApiKey={byokRequiresApiKey}
                showApiKeyInvalid={Boolean(
                  apiKeyFieldAuthFailed ||
                    byokPreconditionNotice?.field === 'api_key' ||
                    apiKeyDraftInvalid,
                )}
                showApiKey={showApiKey}
                onBlur={onByokKeyCommit}
                onChange={(value) => {
                  committedClearedByokProviderKeyRef.current = null;
                  updateApiConfig({ apiKey: value });
                }}
                onFocus={() => {
                  const byokProviderId = byokProtocolToTracking(apiProtocol);
                  if (byokProviderId) {
                    trackSettingsByokFieldClick(analytics.track, {
                      page_name: 'settings',
                      area: 'configure_execution_mode_byok',
                      element: 'api_key',
                      provider_id: byokProviderId,
                      has_value: Boolean(cfg.apiKey?.trim()),
                    });
                  }
                }}
                onToggleShowApiKey={() => setShowApiKey((v) => !v)}
              />
              {showBaseUrlField ? (
                <ByokProviderBaseUrl
                  apiProtocol={apiProtocol}
                  inputRef={baseUrlInputRef}
                  baseUrl={cfg.baseUrl}
                  baseUrlError={baseUrlErrorMessage}
                  baseUrlInvalid={Boolean(baseUrlErrorMessage)}
                  baseUrlPlaceholder={baseUrlPlaceholder}
                  baseUrlReadOnly={baseUrlReadOnly}
                  labels={{
                    baseUrl: t('settings.baseUrl'),
                    required: t('settings.required'),
                    customize: t('settings.baseUrlCustomize'),
                    invalid: t('settings.baseUrlInvalid'),
                    defaultHint: t('settings.baseUrlDefaultHint'),
                    azureHint: t('settings.azureBaseUrlHint'),
                  }}
                  onBlur={commitProviderModelsInputs}
                  onChange={(value) =>
                    updateApiConfig({
                      baseUrl: value,
                      apiProviderBaseUrl: apiProtocol === 'azure' ? '' : null,
                    })
                  }
                  onCustomize={() => {
                    updateApiConfig({ apiProviderBaseUrl: null });
                    window.setTimeout(() => baseUrlInputRef.current?.focus(), 0);
                  }}
                  onFocus={() => {
                    const byokProviderId = byokProtocolToTracking(apiProtocol);
                    if (byokProviderId) {
                      trackSettingsByokFieldClick(analytics.track, {
                        page_name: 'settings',
                        area: 'configure_execution_mode_byok',
                        element: 'base_url',
                        provider_id: byokProviderId,
                        has_value: Boolean(cfg.baseUrl?.trim()),
                      });
                    }
                  }}
                />
              ) : null}
              <label className="field">
                <span className="field-label">{t('settings.maxTokens')}</span>
                <input
                  type="number"
                  min={MIN_MAX_TOKENS}
                  max={MAX_MAX_TOKENS}
                  step={1}
                  placeholder={String(modelMaxTokensDefault(cfg.model))}
                  value={maxTokensInput}
                  onChange={(e) => updateMaxTokensInput(e.target.value)}
                  onBlur={() => setMaxTokensInput(cfg.maxTokens == null ? '' : String(cfg.maxTokens))}
                />
                <p className="hint">{t('settings.maxTokensHint')}</p>
              </label>
              <ByokModelField
                customActive={apiModelCustomActive}
                customInputRef={customModelInputRef}
                labels={{
                  customModel: t('settings.modelCustom'),
                  customModelLabel: apiProtocol === 'azure'
                    ? t('settings.azureCustomDeploymentName')
                    : t('settings.modelCustomLabel'),
                  customModelPlaceholder: apiProtocol === 'azure'
                    ? t('settings.azureDeploymentModel')
                    : t('settings.modelCustomPlaceholder'),
                  fetchModelsUnsupported: t('settings.fetchModelsUnsupported'),
                  model: apiProtocol === 'azure'
                    ? t('settings.azureDeploymentModel')
                    : t('settings.model'),
                  required: t('settings.required'),
                  searchPlaceholder: t('designs.searchPlaceholder'),
                  suggestedModelsHint: t('settings.suggestedModelsHint'),
                }}
                model={cfg.model}
                modelSelectRef={modelSelectRef}
                models={apiModelOptions.map((m) => ({
                  ...m,
                  label: apiModelOptionLabel(
                    m,
                    !hidesAccountModelSourceLabel(apiProtocol) &&
                    loadedAccountModelCount > 0
                      ? fetchedApiModelIds.has(m.id)
                        ? t('settings.modelSourceAccount')
                        : t('settings.modelSourceSuggested')
                      : undefined,
                  ),
                }))}
                modelsLoadedFromAccountMessage={
                  loadedAccountModelCount > 0
                    ? t(
                        hidesAccountModelSourceLabel(apiProtocol)
                          ? 'settings.modelsLoadedCount'
                          : 'settings.modelsLoadedFromAccount',
                        {
                          count: loadedAccountModelCount,
                        },
                      )
                    : null
                }
                providerModelsFailureMessage={providerModelsFailureMessage}
                forceTextInput={apiProtocol === 'azure'}
                showAzureModelFetchHint={apiProtocol === 'azure'}
                showFetchModelsUnsupportedHint={
                  apiProtocol !== 'azure' &&
                  isProviderModelDiscoveryUnsupported(apiProtocol, cfg.baseUrl)
                }
                showSuggestedModelsHint={apiProtocol !== 'azure' && !selectedProvider}
                azureModelFetchHint={t('settings.azureModelFetchHint')}
                onCustomModelChange={(value) => updateApiConfig({ model: value })}
                onCustomModelSelect={() => {
                  apiModelUserSelectedRef.current = true;
                  setApiModelCustomEditing(true);
                  updateApiConfig({ model: '' });
                }}
                onFocus={() => {
                  const byokProviderId = byokProtocolToTracking(apiProtocol);
                  if (byokProviderId) {
                    trackSettingsByokFieldClick(analytics.track, {
                      page_name: 'settings',
                      area: 'configure_execution_mode_byok',
                      element: 'model',
                      provider_id: byokProviderId,
                      has_value: Boolean(cfg.model?.trim()),
                    });
                  }
                }}
                onModelSelect={(nextValue) => {
                  apiModelUserSelectedRef.current = true;
                  setApiModelCustomEditing(false);
                  updateApiConfig({ model: nextValue });
                }}
              />

              {apiProtocol === 'azure' ? (
                <label className="field">
                  <span className="field-label">{t('settings.apiVersion')}</span>
                  <input
                    type="text"
                    value={cfg.apiVersion ?? ''}
                    placeholder="2024-10-21"
                    onBlur={commitProviderModelsInputs}
                    onChange={(e) => updateApiConfig({ apiVersion: e.target.value.trim() })}
                  />
                </label>
              ) : null}
              {apiProtocol === 'senseaudio' || apiProtocol === 'aihubmix' ? (
                <label className="field">
                  <span className="field-label">{t('settings.byokImageModel')}</span>
                  <SearchableModelSelect
                    className="inline-switcher__select settings-model-select settings-model-select--byok"
                    aria-label={t('settings.byokImageModel')}
                    searchPlaceholder={t('designs.searchPlaceholder')}
                    popoverClassName="settings-byok-select-popover"
                    minSearchableOptions={Number.POSITIVE_INFINITY}
                    // Live catalogue from the shared hook: AIHubMix's image
                    // models for aihubmix, the static SenseAudio registry
                    // otherwise. The default-empty option (first entry) resolves
                    // to the registry default on the daemon side.
                    models={[
                      {
                        id: '',
                        label: byokImageModelOptions[0]?.label
                          ? `${byokImageModelOptions[0].label} (${t('settings.byokModelDefaultOption')})`
                          : t('settings.byokModelDefaultOption'),
                      },
                      ...byokImageModelOptions.map((m) => ({ id: m.id, label: m.label })),
                    ]}
                    value={cfg.byokImageModel ?? ''}
                    onChange={(value) =>
                      updateApiConfig({ byokImageModel: value })
                    }
                  />
                </label>
              ) : null}
              {apiProtocol === 'aihubmix' ? (
                <label className="field">
                  <span className="field-label">{t('settings.byokVideoModel')}</span>
                  <select
                    value={cfg.byokVideoModel ?? ''}
                    onChange={(e) =>
                      updateApiConfig({ byokVideoModel: e.target.value })
                    }
                  >
                    {/* Empty resolves to the default video model on the daemon
                        side. The LLM can still override per-call via the tool's
                        `model` arg. */}
                    <option value="">
                      {byokVideoModelOptions[0]?.label
                        ? `${byokVideoModelOptions[0].label} (${t('settings.byokModelDefaultOption')})`
                        : t('settings.byokModelDefaultOption')}
                    </option>
                    {byokVideoModelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {apiProtocol === 'aihubmix' ? (
                <label className="field">
                  <span className="field-label">{t('settings.byokSpeechModel')}</span>
                  <select
                    value={cfg.byokSpeechModel ?? ''}
                    onChange={(e) => updateApiConfig({ byokSpeechModel: e.target.value })}
                  >
                    <option value="">
                      {byokSpeechModelOptions[0]?.label
                        ? `${byokSpeechModelOptions[0].label} (${t('settings.byokModelDefaultOption')})`
                        : t('settings.byokModelDefaultOption')}
                    </option>
                    {byokSpeechModelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {apiProtocol === 'aihubmix' ? (
                <label className="field">
                  <span className="field-label">{t('settings.byokSpeechVoice')}</span>
                  <select
                    value={cfg.byokSpeechVoice ?? ''}
                    onChange={(e) => updateApiConfig({ byokSpeechVoice: e.target.value })}
                  >
                    <option value="">{t('settings.byokSpeechVoiceDefault')}</option>
                    {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </section>
          )}
            {/* Rules apply to every run, whichever agent or key runs it, so
                they sit below both modes rather than inside one. */}
            <section
              id={settingsAnchorId('instructions')}
              className="settings-section settings-section-card instructions-rules-section"
            >
              <div className="instructions-field-block instructions-rules-card">
                <div className="instructions-block-head">
                  <div>
                    <h4>{t('settings.customInstructionsTitle')}</h4>
                    <p className="hint">
                      {t('settings.customInstructionsDesc')}
                    </p>
                  </div>
                </div>
                <textarea
                  className="custom-instructions-input instructions-input instructions-rules-input"
                  rows={5}
                  maxLength={5000}
                  placeholder={t('settings.customInstructionsPlaceholder')}
                  value={cfg.customInstructions ?? ''}
                  onChange={(event) =>
                    setCfg({
                      ...cfg,
                      customInstructions: event.target.value || undefined,
                    })
                  }
                />
              </div>
            </section>
            </>
          ) : null}

          {activeSection === 'media' ? (
            <MediaProvidersSection
              cfg={cfg}
              setCfg={setCfg}
              mediaProvidersNotice={mediaProvidersNotice}
              onReloadMediaProviders={onReloadMediaProviders}
              pendingLocalProviderIds={pendingMediaProviderEditIds}
              onChange={(providerId) => {
                mediaProvidersChangeVersionRef.current += 1;
                setPendingMediaProviderEditIds((current) => {
                  if (current.has(providerId)) return current;
                  const next = new Set(current);
                  next.add(providerId);
                  return next;
                });
              }}
            />
          ) : null}
          {activeSection === 'integrations' ? (
            <>
              <IntegrationsSection />
              {onOpenIntegrations ? (
                <div className="settings-about-diagnostics">
                  <div className="settings-about-diagnostics-text">
                    <h4>{t('settings.integrationsMoreTitle')}</h4>
                    <p className="hint">{t('settings.integrationsMoreHint')}</p>
                  </div>
                  <Button data-testid="settings-open-integrations" onClick={onOpenIntegrations}>
                    {t('settings.integrationsMoreButton')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {activeSection === 'mcpClient' ? <McpClientSection surface="settings" /> : null}

          {activeSection === 'skills' ? (
            <SkillsSection cfg={cfg} setCfg={setCfg} onSkillsRefresh={onSkillsRefresh} onSkillsChanged={onSkillsChanged} />
          ) : null}






          {/* General is one scrollable page of `settings-general-block`
              sections, per #5517. Tokens that address a piece of it
              (language / appearance / notifications / projectLocations)
              resolve to 'general' in resolveSettingsDeepLink, with an anchor
              block where one exists. */}
          {activeSection === 'gameEngines' ? <GameEnginesSettings value={cfg.gameEnginePaths ?? {}}
            onChange={gameEnginePaths => setCfg(current => ({ ...current, gameEnginePaths }))} /> : null}
          {activeSection === 'general' ? (
            <section className="settings-section settings-general-section">
              <div className="settings-general-block">
                <div className="settings-general-field">
                  <span className="settings-general-label">{t('settings.language')}</span>
                  <label className="settings-general-select">
                    <select
                      value={locale}
                      aria-label={t('settings.language')}
                      onChange={(event) => {
                        const next = event.target.value as Locale;
                        // P1 ui_click area=language — record the locale id
                        // that was picked, regardless of whether it differs
                        // from the current one (user clicked = signal).
                        trackSettingsLanguageClick(analytics.track, {
                          page_name: 'settings',
                          area: 'language',
                          element: next,
                        });
                        setLocale(next);
                      }}
                    >
                      {LOCALES.map((code) => (
                        <option key={code} value={code}>
                          {LOCALE_LABEL[code]} · {code}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron-down" size={14} />
                  </label>
                </div>
              </div>

              {/* Asked by the new-game dialog the first time; `pixo config set gameExperience <id>` writes the same value. */}
              <div className="settings-general-block">
                <div className="settings-general-block-head">
                  <h3 id="settings-game-experience">{t('settings.gameExperience')}</h3>
                  <p className="hint">{t('settings.gameExperienceHint')}</p>
                </div>
                <label className="settings-general-select">
                  <select
                    value={cfg.gameExperience ?? ''}
                    aria-labelledby="settings-game-experience"
                    data-testid="settings-game-experience"
                    onChange={(event) => {
                      const next = event.target.value;
                      if (isGameExperience(next)) setCfg((current) => ({ ...current, gameExperience: next }));
                    }}
                  >
                    {cfg.gameExperience ? null : <option value="" disabled>{t('settings.gameExperienceUnset')}</option>}
                    {GAME_EXPERIENCE_LEVELS.map((level) => (
                      <option key={level} value={level}>{t(`game.wizard.experience.${level}` as const)}</option>
                    ))}
                  </select>
                  <Icon name="chevron-down" size={14} />
                </label>
              </div>

              <div id={settingsAnchorId('notifications')} className="settings-general-block">
                <div className="settings-general-block-head">
                  <h3>{t('settings.systemPrefsTitle')}</h3>
                  <p className="hint">{t('settings.systemPrefsHint')}</p>
                </div>
                <NotificationsSection cfg={cfg} setCfg={setCfg} />
              </div>


              <div id={settingsAnchorId('projectLocations')} className="settings-general-block">
                <div className="settings-general-block-head">
                  <h3>{t('settings.projectLocations')}</h3>
                </div>
                <ProjectLocationsSection cfg={cfg} setCfg={setCfg} onProjectsRefresh={onProjectsRefresh} />
              </div>


            </section>
          ) : null}

          {null}

          {activeSection === 'privacy' ? (
            <PrivacySection cfg={cfg} setCfg={setCfg} />
          ) : null}

          {activeSection === 'account' ? <AccountSection /> : null}

          {activeSection === 'about' ? (
            <section className="settings-section">
              <h3>{t('app.brand')}</h3>
              <p className="hint">{t('settings.onboardingCreateBody')}</p>
              {appVersionInfo ? (
                <dl className="settings-about-list">
                  <div className="settings-about-version-row">
                    <div className="settings-about-version-copy">
                      <div className="settings-about-version-left">
                        <dt>{t('settings.appVersion')}</dt>
                        <span className="settings-about-version-num">{appVersionInfo.version}</span>
                        <dd
                          aria-live="polite"
                          className={`settings-about-update-status settings-about-update-status--${aboutUpdateControl.statusTone}`}
                        >
                          {t(aboutUpdateControl.statusKey, aboutUpdateControl.statusVars)}
                        </dd>
                      </div>
                    </div>
                    <div className="settings-about-update-actions">
                      {aboutUpdateControl.primaryLabelKey ? (
                        <button
                          type="button"
                          className={`settings-about-update-button${
                            aboutUpdateControl.primaryAction === 'download'
                              || aboutUpdateControl.primaryAction === 'install'
                              || aboutUpdateControl.primaryAction === 'quit'
                              ? ' settings-about-update-button--primary'
                              : ''
                          }`}
                          disabled={
                            aboutUpdateActionBusy
                            || aboutUpdaterModel.busy
                            || aboutUpdateControl.primaryAction == null
                          }
                          onClick={handleAboutUpdateAction}
                        >
                          {aboutUpdateActionBusy
                            ? t('common.loading')
                            : t(aboutUpdateControl.primaryLabelKey)}
                        </button>
                      ) : null}
                      {aboutUpdateControl.showReleaseLink ? (
                        <button
                          type="button"
                          className="settings-about-release-link"
                          onClick={handleOpenReleaseNotes}
                        >
                          {t('settings.updateViewReleases')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <dt>{t('settings.appChannel')}</dt>
                    <dd>{appVersionInfo.channel}</dd>
                  </div>
                  <div>
                    <dt>{t('settings.appRuntime')}</dt>
                    <dd>
                      {appVersionInfo.packaged
                        ? t('settings.runtimePackaged')
                        : t('settings.runtimeDevelopment')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('settings.appPlatform')}</dt>
                    <dd>{appVersionInfo.platform}</dd>
                  </div>
                  <div>
                    <dt>{t('settings.appArchitecture')}</dt>
                    <dd>{appVersionInfo.arch}</dd>
                  </div>
                </dl>
              ) : (
                <div className="empty-card">{t('settings.versionUnavailable')}</div>
              )}
              <div className="settings-about-diagnostics settings-about-silent-updates">
                <label className="settings-about-toggle">
                  <input
                    checked={cfg.allowSilentUpdates === true}
                    data-testid="settings-allow-silent-updates"
                    disabled={silentUpdateBusy}
                    type="checkbox"
                    onChange={(event) => {
                      // Capture before setState: React clears event.currentTarget
                      // after the handler returns, and the functional updater can
                      // run later when SettingsDialog already has pending lanes
                      // (about-updater status, autosave indicator, etc.).
                      const allowSilentUpdates = event.currentTarget.checked;
                      const previous = cfg.allowSilentUpdates;
                      // Dedicated non-optimistic path: do not flush through
                      // handleConfigPersist (which setConfig before daemon write).
                      // Serialize via busy + write token so a slow earlier save
                      // cannot re-apply UI after a later toggle.
                      const writeToken = ++silentUpdateWriteTokenRef.current;
                      suppressNextAutosaveRef.current = true;
                      setCfg((current) => ({
                        ...current,
                        allowSilentUpdates,
                      }));
                      if (onSilentUpdatePreferenceChange == null) return;
                      const autosaveClaim = claimAutosaveStatus('saving');
                      setSilentUpdateBusy(true);
                      void (async () => {
                        try {
                          await onSilentUpdatePreferenceChange(allowSilentUpdates);
                          if (writeToken !== silentUpdateWriteTokenRef.current) return;
                          // Only advance the baseline for this daemon-owned field.
                          // Spreading autosaveLatestRef would stamp any concurrent
                          // draft (theme, accent, …) as already saved and let the
                          // generic autosave skip a real onPersist for that edit.
                          autosaveLastSavedRef.current = {
                            ...autosaveLastSavedRef.current,
                            allowSilentUpdates,
                          };
                          settleAutosaveStatus(autosaveClaim, 'saved');
                          if (autosaveSavedTimerRef.current != null) {
                            window.clearTimeout(autosaveSavedTimerRef.current);
                          }
                          autosaveSavedTimerRef.current = window.setTimeout(() => {
                            autosaveSavedTimerRef.current = null;
                            settleAutosaveStatus(autosaveClaim, 'idle');
                          }, 1800);
                        } catch {
                          if (writeToken !== silentUpdateWriteTokenRef.current) return;
                          suppressNextAutosaveRef.current = true;
                          setCfg((current) => ({
                            ...current,
                            allowSilentUpdates: previous,
                          }));
                          settleAutosaveStatus(autosaveClaim, 'error');
                        } finally {
                          if (writeToken === silentUpdateWriteTokenRef.current) {
                            setSilentUpdateBusy(false);
                          }
                        }
                      })();
                    }}
                  />
                  <span className="settings-about-toggle-copy">
                    <span>{t('settings.allowSilentUpdates')}</span>
                    <span className="hint">{t('settings.allowSilentUpdatesDesc')}</span>
                  </span>
                </label>
              </div>
            </section>
          ) : null}

          {activeSection === 'advanced' ? (
            <section className="settings-section settings-general-section">
              <div className="settings-general-block">
                <div className="settings-general-block-head">
                  <h3>{t('settings.advancedTroubleshootingTitle')}</h3>
                </div>
                {aboutUpdaterModel.environment === 'desktop'
                  && aboutUpdaterModel.supported
                  && appVersionInfo?.packaged !== false ? (
                  <div className="settings-about-diagnostics">
                    <div className="settings-about-diagnostics-text">
                      <h4>{t('settings.clearUpdaterCacheTitle')}</h4>
                      <p className="hint">{t('settings.clearUpdaterCacheHint')}</p>
                    </div>
                    <Button data-testid="settings-clear-updater-cache" disabled={clearUpdaterCacheBusy || aboutUpdaterModel.busy}
                      onClick={() => setClearUpdaterCacheStage('confirm')}>{t('settings.clearUpdaterCacheButton')}</Button>
                    <ConfirmDialog open={clearUpdaterCacheStage === 'confirm'} title={t('settings.clearUpdaterCacheTitle')}
                      busy={clearUpdaterCacheBusy || aboutUpdaterModel.busy} destructive
                      confirmLabel={t('settings.clearUpdaterCacheConfirmButton')} cancelLabel={t('common.cancel')}
                      onCancel={() => setClearUpdaterCacheStage('idle')} onConfirm={handleClearUpdaterCache}>
                      {t('settings.clearUpdaterCacheHint')}
                    </ConfirmDialog>
                  </div>
                ) : null}
                <div className="settings-about-diagnostics">
                  <div className="settings-about-diagnostics-text">
                    <h4>{t('diagnostics.exportTitle')}</h4>
                    <p className="hint">{t('diagnostics.exportHint')}</p>
                  </div>
                  <ExportDiagnosticsRow />
                </div>
                <div className="settings-about-diagnostics">
                  <div className="settings-about-diagnostics-text">
                    <h4>{t('settings.resetOnboarding')}</h4>
                    <p className="hint">{t('settings.resetOnboardingDesc')}</p>
                  </div>
                  <Button onClick={handleResetOnboarding}>
                    {t('settings.resetOnboardingButton')}
                  </Button>
                </div>
              </div>
              {daemonLive ? (
                <div className="settings-general-block">
                  <AgentCapabilityMatrix />
                </div>
              ) : null}
              <div id={settingsAnchorId('labs')} className="settings-general-block">
                <div className="settings-general-block-head">
                  <h3>{t('labs.title')}</h3>
                </div>
                <LabsSection autosave={labsAutosave} />
              </div>
            </section>
          ) : null}

          {aboutToast ? (
            <Toast
              message={aboutToast}
              onDismiss={() => setAboutToast(null)}
            />
          ) : null}
          </div>
        </div>
      </div>
  );

  if (pageMode) {
    return (
      <div className="settings-page-shell">
        {surface}
      </div>
    );
  }

  return (
    <Dialog open={dialogOpen} onClose={onDismiss} onAfterClose={() => { if (!dialogOpen) onDismiss(); }}
      includeChromeClassName={false} ariaLabelledBy="settings-dialog-title" className={dialogStyles.frame}>
      {surface}
    </Dialog>
  );
}


function MediaProvidersSection({
  cfg,
  setCfg,
  mediaProvidersNotice,
  onReloadMediaProviders,
  providerModelsCache: sharedProviderModelsCache,
  onProviderModelsCacheChange,
  pendingLocalProviderIds,
  onChange,
}: {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
  mediaProvidersNotice?: string | null;
  onReloadMediaProviders?: () => Promise<AppConfig['mediaProviders'] | null>;
  providerModelsCache?: Record<string, ProviderModelOption[]>;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<Record<string, ProviderModelOption[]>>>;
  pendingLocalProviderIds: ReadonlySet<string>;
  onChange: (providerId: string) => void;
}) {
  const { t } = useI18n();
  const { confirm: askClear, dialog: clearDialog } = useConfirmDialog();
  const analytics = useAnalytics();
  const [codexStatus, setCodexStatus] = useState<MediaProviderAvailability | null>(null);
  const [reloadRunning, setReloadRunning] = useState(false);
  const [reloadNotice, setReloadNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [visibleApiKeys, setVisibleApiKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setVisibleApiKeys((current) => {
      const next = new Set<string>();
      for (const providerId of current) {
        const apiKey = cfg.mediaProviders?.[providerId]?.apiKey ?? '';
        if (apiKey.trim()) next.add(providerId);
      }
      return next.size === current.size ? current : next;
    });
  }, [cfg.mediaProviders]);
  const visibleProviders = MEDIA_PROVIDERS.filter(
    (p) => p.settingsVisible !== false,
  );
  // Split the catalog into two surfaces:
  //   - "Available" — daemon ships a real client, user can paste a key
  //     and it works. Rendered as full editable cards.
  //   - "Coming soon" — listed for transparency / roadmap signaling but
  //     the daemon has no client yet, so the form fields would be
  //     disabled placeholders. Hiding them behind a <details> keeps the
  //     primary list focused (was 16 cards, now 8) without dropping the
  //     informational value.
  const availableProviders = visibleProviders
    .filter((p) => p.integrated)
    .slice()
    .sort((a, b) => {
      const aEntry = cfg.mediaProviders?.[a.id];
      const bEntry = cfg.mediaProviders?.[b.id];
      const aConfigured = isStoredMediaProviderEntryPresent(aEntry);
      const bConfigured = isStoredMediaProviderEntryPresent(bEntry);
      if (aConfigured !== bConfigured) return aConfigured ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  const comingSoonProviders = visibleProviders
    .filter((p) => !p.integrated)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
  const updateProvider = (
    provider: MediaProvider,
    patch: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      apiKeyConfigured?: boolean;
      apiKeyTail?: string;
    },
  ) => {
    onChange(provider.id);
    setCfg((curr) => {
      const prev = curr.mediaProviders?.[provider.id] ?? { apiKey: '', baseUrl: '', model: '' };
      const next = { ...prev, ...patch };
      const map = { ...(curr.mediaProviders ?? {}) };
      if (isStoredMediaProviderEntryEmpty(next)) {
        delete map[provider.id];
      } else {
        map[provider.id] = next;
      }
      return { ...curr, mediaProviders: map };
    });
  };
  const handleReload = async () => {
    if (!onReloadMediaProviders || reloadRunning) return;
    setReloadRunning(true);
    setReloadNotice(null);
    try {
      const next = await onReloadMediaProviders();
      if (!next) {
        setReloadNotice({ kind: 'error', message: t('settings.mediaProviderReloadError') });
        return;
      }
      setCfg((curr) => mergeDaemonMediaProviders(curr, next, {
        preserveLocalProviderIds: pendingLocalProviderIds,
      }));
      setReloadNotice({ kind: 'success', message: t('settings.mediaProviderReloadSuccess') });
    } finally {
      setReloadRunning(false);
    }
  };
  // Successful reload acknowledgement lives on the button (✓ Reloaded)
  // for ~2s then disappears. Keeping it as a permanent paragraph under
  // the section header was noise — the user just clicked a button and
  // got a visible state change, an extra "we did the thing" line is
  // redundant. Errors stay sticky because they actually require user
  // attention.
  useEffect(() => {
    if (reloadNotice?.kind !== 'success') return;
    const handle = window.setTimeout(() => setReloadNotice(null), 2000);
    return () => window.clearTimeout(handle);
  }, [reloadNotice]);

  const toggleApiKeyVisibility = (providerId: string) => {
    setVisibleApiKeys((current) => {
      const next = new Set(current);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };
  // #5517 redesign: the section renders a pill selector (one pill per
  // available provider, with a configured-state dot) plus ONE detail card
  // for the selected provider, instead of a flat stack of rows.
  //
  // The initial selection is pinned eagerly (not left null): the pill order
  // re-sorts live as entries become configured/cleared, so deriving the
  // default from `availableProviders[0]` on every render would make the
  // detail card jump to a different provider mid-edit (e.g. right after
  // Clear). Pinning keeps the card stable; clicking a pill re-pins.
  const [activeProviderId, setActiveProviderId] = useState<string | null>(
    () => availableProviders[0]?.id ?? null,
  );
  const activeProvider = availableProviders.find((p) => p.id === activeProviderId)
    ?? availableProviders[0]
    ?? null;
  // Capability chip copy is derived from the provider's marketing hint
  // ("Image · Audio · Custom configuration").
  const providerLabel = (provider: MediaProvider) => provider.id === 'codex-cli' ? t('settings.codexImageLabel') : provider.label;
  const providerCapabilityLabel = (provider: MediaProvider) => {
    if (provider.id === 'codex-cli') return t('settings.mediaProviderNoKeyRequired');
    const hint = provider.hint.toLowerCase();
    const parts: string[] = [];
    if (/image|imagen|flux|dall|banana|leonardo|gpt-image|seedream/.test(hint)) parts.push(t('settings.mediaCapability.image'));
    if (/video|sora|veo|wan|seedance|grok-imagine/.test(hint)) parts.push(t('settings.mediaCapability.video'));
    if (/voice|speech|audio|sfx|tts|clone/.test(hint) || provider.id === 'senseaudio') parts.push(t('settings.mediaCapability.audio'));
    if (/research|search/.test(hint)) parts.push(t('settings.mediaCapability.research'));
    if (provider.supportsCustomModel) parts.push(t('settings.mediaCapability.custom'));
    if (parts.length === 0) {
      return provider.credentialsRequired === false
        ? t('settings.mediaProviderNoKeyRequired')
        : t('settings.mediaProviderApiKey');
    }
    return parts.slice(0, 3).join(' · ');
  };
  const activeEntry = activeProvider
    ? cfg.mediaProviders?.[activeProvider.id] ?? { apiKey: '', baseUrl: '', model: '' }
    : null;
  const activeHasPendingEdit = Boolean(activeEntry?.apiKey.trim());
  const activeIsSavedState = Boolean(
    activeEntry && (activeHasPendingEdit || activeEntry.apiKeyConfigured) && !activeHasPendingEdit,
  );
  const activeClearable = Boolean(activeEntry && isStoredMediaProviderEntryPresent(activeEntry));
  const activeApiKeyVisible = activeProvider ? visibleApiKeys.has(activeProvider.id) : false;
  const activeRequiresCredentials = activeProvider?.credentialsRequired !== false;

  return (
    <section className="settings-section">
      {clearDialog}
      {mediaProvidersNotice ? (
        <p className="hint" role="alert">{mediaProvidersNotice}</p>
      ) : null}
      {reloadNotice && reloadNotice.kind === 'error' ? (
        // Errors only — successful reload feedback now rides on the
        // button (see is-success-flash above) and clears itself after
        // 2s, so the section header doesn't get colonised by a
        // permanent "yes I did the thing" paragraph.
        <p className="hint" role="alert">{reloadNotice.message}</p>
      ) : null}
      {reloadNotice && reloadNotice.kind === 'success' ? (
        // Off-screen announcement so assistive tech still hears the
        // success state even though the visible feedback collapses
        // into a transient button label change.
        <VisuallyHidden role="status">
          {reloadNotice.message}
        </VisuallyHidden>
      ) : null}
      {/* Saved at once, outside the Settings draft; the composer chip and
          `pixo config set agentImageModel` write the same value. */}
      <AgentImageModelSetting />
      {/* The page title and description come from the Settings page header;
          this row only says what to do next and offers the reload. */}
      <div className="media-provider-page-head">
        <div>
          <p>{t('settings.mediaProvidersPick')}</p>
        </div>
        {onReloadMediaProviders ? (
          <button
            type="button"
            className={`ghost media-provider-reload-btn${
              reloadNotice?.kind === 'success' ? ' is-success-flash' : ''
            }`}
            onClick={() => {
              trackSettingsMediaProvidersClick(analytics.track, {
                page_name: 'settings',
                area: 'media_providers',
                element: 'reload',
              });
              void handleReload();
            }}
            disabled={reloadRunning}
            aria-live="polite"
          >
            {reloadRunning ? (
              t('common.loading')
            ) : reloadNotice?.kind === 'success' ? (
              <>
                <Icon name="check" size={13} />
                <span style={{ marginLeft: 4 }}>{t('settings.mediaProviderReload')}</span>
              </>
            ) : (
              <>
                <Icon name="refresh" size={13} />
                <span style={{ marginLeft: 4 }}>{t('settings.mediaProviderReload')}</span>
              </>
            )}
          </button>
        ) : null}
      </div>
      <div
        className="protocol-chips protocol-chips--providers media-provider-tabs"
        role="tablist"
        aria-label={t('settings.mediaProviders')}
      >
        <div className="protocol-chip-group protocol-chip-group--providers">
          <span className="protocol-chip-group-label">{t('settings.mediaProviderModelProviders')}</span>
          <div className="protocol-chip-group-options">
            {availableProviders.map((provider) => {
              const active = activeProvider?.id === provider.id;
              const entry = cfg.mediaProviders?.[provider.id];
              const connected = provider.id === 'codex-cli' ? codexStatus?.available === true
                : provider.credentialsRequired === false || isStoredMediaProviderEntryPresent(entry);
              const statusLabel = provider.id === 'codex-cli' && !connected
                ? t(codexStatus ? codexImageReasonKey(codexStatus.reasonCode) : 'settings.codexImageUnchecked')
                : connected
                ? t('settings.mediaProviderConfigured')
                : t('settings.mediaProviderUnset');
              return (
                <button
                  key={provider.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={'protocol-chip' + (active ? ' active' : '')}
                  title={`${providerLabel(provider)} · ${statusLabel}`}
                  onClick={() => setActiveProviderId(provider.id)}
                >
                  <span
                    className={`media-provider-chip-status${connected ? ' is-connected' : ' is-disconnected'}`}
                    aria-hidden
                  />
                  <span>{providerLabel(provider)}</span>
                  <VisuallyHidden>{statusLabel}</VisuallyHidden>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {activeProvider && activeEntry ? (
        <article className="media-provider-detail">
          <div className="media-provider-detail-head">
            <div className="media-provider-meta">
              <div className="media-provider-name-row">
                <h3>{providerLabel(activeProvider)}</h3>
                {activeIsSavedState ? (
                  <span
                    className="field-status-badge field-status-badge--inline"
                    title={t('settings.mediaProviderConfigured')}
                  >
                    {t('settings.mediaProviderConfigured')}
                  </span>
                ) : null}
              </div>
              <p>{activeProvider.id === 'codex-cli' ? t('settings.codexImageHint') : activeProvider.hint || providerCapabilityLabel(activeProvider)}</p>
            </div>
            <div className="media-provider-badges">
              <span className="media-provider-badge integrated">
                {providerCapabilityLabel(activeProvider)}
              </span>
              {activeProvider.credentialsRequired === false ? (
                <span className="media-provider-badge on">
                  {t('settings.mediaProviderNoKeyRequired')}
                </span>
              ) : null}
            </div>
          </div>
          {activeProvider.id === 'grok' ? <XaiOAuthControl /> : null}
          {activeRequiresCredentials ? (
            <div className="media-provider-detail-grid">
              <label className="media-provider-detail-field">
                <span>{t('settings.mediaProviderApiKey')}</span>
                <div className="media-provider-secret-field">
                  <input
                    type={activeApiKeyVisible ? 'text' : 'password'}
                    value={activeEntry.apiKey}
                    placeholder={activeIsSavedState ? t('settings.replaceSavedKeyPlaceholder') : t('settings.mediaProviderPlaceholder')}
                    aria-label={`${activeProvider.label} ${t('settings.mediaProviderApiKey')}`}
                    onFocus={() => {
                      trackSettingsMediaProvidersClick(analytics.track, {
                        page_name: 'settings',
                        area: 'media_providers',
                        element: 'key_input',
                        providers_id: activeProvider.id,
                        is_configured: activeClearable,
                      });
                    }}
                    onChange={(e) => updateProvider(activeProvider, { apiKey: e.target.value })}
                  />
                  <button
                    type="button"
                    className="secret-visibility-button"
                    aria-label={
                      activeApiKeyVisible
                        ? `${activeProvider.label} ${t('settings.hideKey')}`
                        : `${activeProvider.label} ${t('settings.showKey')}`
                    }
                    aria-pressed={activeApiKeyVisible}
                    onClick={() => toggleApiKeyVisibility(activeProvider.id)}
                  >
                    <Icon name={activeApiKeyVisible ? 'eye' : 'eye-off'} size={15} />
                  </button>
                </div>
              </label>
              <label className="media-provider-detail-field">
                <span>{t('settings.mediaProviderBaseUrl')}</span>
                <input
                  value={activeEntry.baseUrl}
                  placeholder={activeProvider.defaultBaseUrl || t('settings.mediaProviderBaseUrlPlaceholder')}
                  aria-label={`${activeProvider.label} ${t('settings.mediaProviderBaseUrl')}`}
                  onFocus={() => {
                    trackSettingsMediaProvidersClick(analytics.track, {
                      page_name: 'settings',
                      area: 'media_providers',
                      element: 'url_input',
                      providers_id: activeProvider.id,
                      is_configured: activeClearable,
                    });
                  }}
                  onChange={(e) => updateProvider(activeProvider, { baseUrl: e.target.value })}
                />
              </label>
              <label className="media-provider-detail-field">
                <span>{t('settings.mediaProviderModel')}</span>
                <input
                  value={activeEntry.model ?? ''}
                  placeholder={activeProvider.customModelPlaceholder ?? t('settings.mediaProviderModelPlaceholder')}
                  aria-label={`${activeProvider.label} ${t('settings.mediaProviderModel')}`}
                  onChange={(e) => updateProvider(activeProvider, { model: e.target.value })}
                />
              </label>
            </div>
          ) : activeProvider.id === 'codex-cli' ? (
            <CodexImageProviderControl onStatus={setCodexStatus} />
          ) : (
            <div className="media-provider-no-key">
              <Icon name="check" size={15} />
              <div>
                <strong>{t('settings.mediaProviderNoKeyRequired')}</strong>
                <span>{t('settings.mediaProviderNoKeyHint')}</span>
              </div>
            </div>
          )}
          {activeProvider.id !== 'codex-cli' ? <><div className="media-provider-docs-callout">
            <div>
              <strong>{t('settings.mediaProviderDocsTitle')}</strong>
              <span>{t('settings.mediaProviderDocsHint')}</span>
            </div>
            {activeProvider.docsUrl ? (
              <a
                href={sanitizeHttpsUrl(activeProvider.docsUrl) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="ghost-link"
              >
                {t('settings.agentInstall.docs')}
                <Icon name="external-link" size={14} />
              </a>
            ) : null}
          </div>
          <div className="media-provider-detail-actions">
            <span className="hint">{t('settings.mediaProviderSaveHint')}</span>
            <button
              type="button"
              className="ghost"
              disabled={!activeClearable}
              onClick={async () => {
                trackSettingsMediaProvidersClick(analytics.track, {
                  page_name: 'settings',
                  area: 'media_providers',
                  element: 'clear',
                  providers_id: activeProvider.id,
                  // The click reports the state at the moment the
                  // user pressed Clear; the actual clear only lands
                  // after they confirm the dialog below, but the
                  // dashboard cares about the intent signal.
                  is_configured: activeClearable,
                });
                if (!await askClear({ title: t('settings.mediaProviderClear'),
                  body: t('settings.mediaProviderClearConfirm', { name: activeProvider.label }),
                  confirmLabel: t('settings.mediaProviderClear'), destructive: true })) return;
                updateProvider(activeProvider, {
                  apiKey: '',
                  baseUrl: '',
                  model: '',
                  apiKeyConfigured: false,
                  apiKeyTail: '',
                });
              }}
            >
              {t('settings.mediaProviderClear')}
            </button>
          </div></> : null}
        </article>
      ) : null}
      {comingSoonProviders.length > 0 ? (
        // Roadmap drawer. We still want to advertise that we know
        // these providers exist (so users don't ask where they went),
        // but disabled placeholder cards in the main list were noise.
        // Closed by default — opens to a compact name + hint + docs
        // link list, no inputs because there's nothing to wire up yet.
        // TODO(i18n): inline English placeholders; promote to locale
        // keys when we touch this section again.
        <details className="library-group media-provider-coming-soon">
          <summary className="settings-details-summary">
            <span className="settings-details-title">
              {t('tasks.comingSoon')}
            </span>
            <span className="filter-pill-count">
              ({comingSoonProviders.length})
            </span>
          </summary>
          <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
            {t('settings.mediaProviderComingSoonHint')}
          </p>
          <ul className="media-provider-coming-soon-list">
            {comingSoonProviders.map((provider) => {
              const docsHref = sanitizeHttpsUrl(provider.docsUrl);
              return (
                <li
                  key={provider.id}
                  className="media-provider-coming-soon-item"
                >
                  <div className="media-provider-coming-soon-meta">
                    <span className="media-provider-name">
                      {provider.label}
                    </span>
                    <span className="media-provider-hint">
                      {provider.hint}
                    </span>
                  </div>
                  {docsHref ? (
                    <a
                      href={docsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ghost-link"
                    >
                      {t('settings.agentInstall.docs')}
                      <Icon name="external-link" size={11} />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// Per-client install paths. Each entry's `snippet` is what the user
// copies; some clients also support a richer `deeplink` flow that
// triggers a one-click install with an in-client approval dialog.
//
// Schemas drift between clients in deliberate ways. VS Code keys
// servers under "servers" with a required "type" field; Zed uses
// "context_servers"; Cursor, Kiro, Windsurf, and Antigravity share
// "mcpServers"; Claude Code is best served by its CLI which writes
// to the local config for you. Verified against each tool's official
// docs in May 2026.
//
// Important: every snippet uses absolute paths to the daemon's current
// Node-compatible runtime and built cli.js, fetched at runtime. Source
// checkouts may not have `pixo` installed globally. The installer panel
// must NOT reference bare `pixo`.
type McpClientId =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'vscode'
  | 'zed'
  | 'windsurf'
  | 'antigravity';

interface McpInstallInfo {
  command: string;
  args: string[];
  env?: Record<string, string>;
  daemonUrl: string;
  platform: 'darwin' | 'linux' | 'win32' | string;
  cliExists: boolean;
  nodeExists: boolean;
  buildHint: string | null;
}

interface McpStdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpClient {
  id: McpClientId;
  label: string;
  // Function so the dropdown can show different methods per OS
  // (Claude Code uses CLI on POSIX but JSON edit on Windows because
  // the bash/PowerShell/cmd.exe quoting is too fragile to reliably
  // emit a single command that works in every shell).
  buildMethod: (info: McpInstallInfo) => string;
  // Function so per-OS path hints (~/.cursor on POSIX vs
  // %USERPROFILE%\.cursor on Windows) and shortcut differences
  // (⌘⇧P vs Ctrl+Shift+P) can be rendered correctly.
  buildInstruction: (info: McpInstallInfo) => string;
  buildSnippet: (info: McpInstallInfo) => string;
  buildSnippetLang: (info: McpInstallInfo) => 'bash' | 'json' | 'toml';
  // Optional one-click install action. Currently only Cursor
  // supports deeplinks of this shape.
  buildDeeplink?: (info: McpInstallInfo) => string;
  deeplinkLabel?: () => string;
}

// Path hint per OS. Localizes the "where to paste" copy so a
// Windows user does not see ~/.cursor/mcp.json (which their shell
// will not expand) or a Linux user does not see %APPDATA% paths.
function homeConfigPath(
  platform: McpInstallInfo['platform'],
  posix: string,
  windows: string,
): string {
  return platform === 'win32' ? windows : posix;
}

function commandPaletteShortcut(platform: McpInstallInfo['platform']): string {
  return platform === 'darwin' ? '⌘⇧P' : 'Ctrl+Shift+P';
}

function settingsShortcut(platform: McpInstallInfo['platform']): string {
  return platform === 'darwin' ? '⌘,' : 'Ctrl+,';
}

// btoa() requires every input character be representable in Latin-1
// (codepoints 0-255). A Mac/Linux home directory like
// "/Users/Émile/.fnm/.../node" trips that and throws
// InvalidCharacterError. UTF-8-encode the string into bytes first,
// then map each byte back to a Latin-1 char before base64'ing.
function utf8Btoa(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function buildMcpStdioServerConfig(info: McpInstallInfo): McpStdioServerConfig {
  const env = info.env && Object.keys(info.env).length > 0 ? info.env : undefined;
  return {
    command: info.command,
    args: info.args,
    ...(env ? { env } : {}),
  };
}

function buildCodexEnvToml(info: McpInstallInfo): string {
  const entries = Object.entries(info.env ?? {});
  if (entries.length === 0) return '';
  return `

[mcp_servers.openpixo.env]
${entries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}`;
}

function buildSharedMcpJson(info: McpInstallInfo): string {
  const inner = buildMcpStdioServerConfig(info);
  const innerJson = JSON.stringify(inner, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `    ${line}`))
    .join('\n');
  return `{
  "mcpServers": {
    "openpixo": ${innerJson}
  }
}`;
}

// One-click install toggle for Codex: queries the daemon for whether
// `codex mcp get openpixo` succeeds, and POSTs/DELETEs the install
// endpoint to call `codex mcp add/remove` on the user's behalf. The
// copy-snippet path still works for users who prefer to paste manually
// or whose Codex CLI is not on PATH (button shows a disabled hint in
// that case).
function CodexInstallToggle(): JSX.Element | null {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/install/codex/status');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { available: boolean; installed: boolean };
      setAvailable(Boolean(data.available));
      setInstalled(Boolean(data.installed));
    } catch {
      // Daemon unreachable or endpoint missing — hide the toggle
      // entirely rather than spook the user with a permanent error.
      setAvailable(false);
      setInstalled(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback(
    async (method: 'POST' | 'DELETE', successKey: 'settings.mcpCodexInstallSuccess' | 'settings.mcpCodexUninstallSuccess') => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch('/api/mcp/install/codex', { method });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(body?.error?.message || `HTTP ${res.status}`);
        }
        setMessage({ kind: 'success', text: t(successKey) });
        await refresh();
      } catch (err) {
        setMessage({
          kind: 'error',
          text: t('settings.mcpCodexInstallError', { error: err instanceof Error ? err.message : String(err) }),
        });
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  if (available === null) return null;

  if (!available) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          disabled
          style={{ padding: '6px 14px', fontSize: 14, opacity: 0.6 }}
        >
          {t('settings.mcpCodexOneClickInstall')}
        </button>
        <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('settings.mcpCodexOneClickUnavailable')}
        </span>
      </div>
    );
  }

  const label = installed
    ? t('settings.mcpCodexOneClickUninstall')
    : t('settings.mcpCodexOneClickInstall');
  const onClick = () => {
    if (installed) {
      void run('DELETE', 'settings.mcpCodexUninstallSuccess');
    } else {
      void run('POST', 'settings.mcpCodexInstallSuccess');
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        className={installed ? '' : 'primary'}
        disabled={busy}
        onClick={onClick}
        style={{ padding: '6px 14px', fontSize: 14 }}
      >
        {busy ? t('settings.mcpCodexBusy') : label}
      </button>
      {message ? (
        <span
          style={{
            marginLeft: 10,
            fontSize: 13,
            color: message.kind === 'error' ? 'var(--danger, #ff6b6b)' : 'var(--text-muted)',
          }}
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}

function IntegrationsSection() {
  const { t } = useI18n();

  const MCP_CLIENTS: McpClient[] = [
    {
      id: 'claude',
      label: 'Claude Code',
      buildMethod: () => t('settings.mcpMethodCli'),
      buildInstruction: () => t('settings.mcpInstructionCli'),
      buildSnippet: (info) => {
        const inner = JSON.stringify(buildMcpStdioServerConfig(info));
        return `claude mcp add-json --scope user openpixo '${inner}'`;
      },
      buildSnippetLang: () => 'bash',
    },
    {
      id: 'codex',
      label: 'Codex',
      buildMethod: () => t('settings.mcpMethodToml'),
      buildInstruction: (info) => {
        const path = homeConfigPath(
          info.platform,
          '~/.codex/config.toml',
          '%USERPROFILE%\\.codex\\config.toml',
        );
        return t('settings.mcpInstructionCodex', { path });
      },
      buildSnippet: (info) => `[mcp_servers.openpixo]\ncommand = ${JSON.stringify(info.command)}\nargs = ${JSON.stringify(info.args)}${buildCodexEnvToml(info)}`,
      buildSnippetLang: () => 'toml',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      buildMethod: () => t('settings.mcpMethodOneClick'),
      buildInstruction: (info) =>
        t('settings.mcpInstructionCursor', {
          path: homeConfigPath(info.platform, '~/.cursor/mcp.json', '%USERPROFILE%\\.cursor\\mcp.json'),
        }),
      buildSnippet: buildSharedMcpJson,
      buildSnippetLang: () => 'json',
      buildDeeplink: (info) => {
        const inner = buildMcpStdioServerConfig(info);
        const encoded = utf8Btoa(JSON.stringify(inner));
        return `cursor://anysphere.cursor-deeplink/mcp/install?name=openpixo&config=${encoded}`;
      },
      deeplinkLabel: () => t('settings.mcpDeeplinkInstallCursor'),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      buildMethod: () => t('settings.mcpMethodJson'),
      buildInstruction: (info) =>
        t('settings.mcpInstructionCopilot', {
          shortcut: commandPaletteShortcut(info.platform),
        }),
      buildSnippet: (info) => `{\n  "servers": {\n    "openpixo": {\n      "type": "stdio",\n      "command": ${JSON.stringify(info.command)},\n      "args": ${JSON.stringify(info.args)}${info.env && Object.keys(info.env).length > 0 ? `,\n      "env": ${JSON.stringify(info.env)}` : ''}\n    }\n  }\n}`,
      buildSnippetLang: () => 'json',
    },
    {
      id: 'antigravity',
      label: 'Antigravity',
      buildMethod: () => t('settings.mcpMethodJson'),
      buildInstruction: () => t('settings.mcpInstructionAntigravity'),
      buildSnippet: buildSharedMcpJson,
      buildSnippetLang: () => 'json',
    },
    {
      id: 'zed',
      label: 'Zed',
      buildMethod: () => t('settings.mcpMethodJson'),
      buildInstruction: (info) =>
        t('settings.mcpInstructionZed', {
          shortcut: settingsShortcut(info.platform),
        }),
      buildSnippet: (info) => `{\n  "context_servers": {\n    "openpixo": {\n      "source": "custom",\n      "command": ${JSON.stringify(info.command)},\n      "args": ${JSON.stringify(info.args)}${info.env && Object.keys(info.env).length > 0 ? `,\n      "env": ${JSON.stringify(info.env)}` : ''}\n    }\n  }\n}`,
      buildSnippetLang: () => 'json',
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      buildMethod: () => t('settings.mcpMethodJson'),
      buildInstruction: (info) =>
        t('settings.mcpInstructionWindsurf', {
          path: homeConfigPath(info.platform, '~/.codeium/windsurf/mcp_config.json', '%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json'),
        }),
      buildSnippet: buildSharedMcpJson,
      buildSnippetLang: () => 'json',
    },
  ];

  const [clientId, setClientId] = useState<McpClientId>('claude');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [info, setInfo] = useState<McpInstallInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  // The reset is wired through a ref-driven timer rather than effect
  // cleanup so re-clicks during the 2s window restart the countdown.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // Pull the absolute paths to node + cli.js from the running daemon
  // so snippets work even when `pixo` isn't on PATH (the common case
  // for source clones). Fetched on mount; if the daemon is
  // unreachable we surface a clear error instead of a half-built
  // snippet that would silently fail when pasted.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/mcp/install-info')
      .then(async (res) => {
        if (!res.ok) throw new Error(`daemon ${res.status}`);
        return (await res.json()) as McpInstallInfo;
      })
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setInfoError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setInfoError(String(err && err.message ? err.message : err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = MCP_CLIENTS.find((c) => c.id === clientId) ?? MCP_CLIENTS[0]!;
  const snippet = info ? client.buildSnippet(info) : '';
  const snippetLang: 'bash' | 'json' | 'toml' = info
    ? client.buildSnippetLang(info)
    : 'json';

  // Reset the "Copied" badge when the user flips to a different
  // client; otherwise the green check sits there next to a snippet
  // they haven't actually copied.
  useEffect(() => {
    setCopied(false);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [clientId]);

  const onCopy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail under non-secure contexts; the snippet
      // is selectable so the user can still copy manually.
      setCopied(false);
    }
  };

  return (
    <section className="settings-section">
      <div className="mcp-client-body">
        <div className="mcp-page-head">
          <h3>{t('settings.mcpTitle')}</h3>
        </div>

        {infoError ? (
          <div
            className="empty-card"
            style={{ marginBottom: 14, color: 'var(--red)' }}
          >
            {t('settings.mcpDaemonError', { error: infoError! })}
          </div>
        ) : null}

        <div className="mcp-capabilities-card">
          <p className="mcp-capabilities-label">
            {t('settings.mcpCapabilitiesTitle')}
          </p>
          <ul className="mcp-capabilities-list">
            <li>{t('settings.mcpCapabilityRead')}</li>
            <li>{t('settings.mcpCapabilityPull')}</li>
            <li>{t('settings.mcpCapabilityDefault')}</li>
          </ul>
        </div>

        {/* Setup flow */}
        <div className="mcp-setup-card">
          <div
            className="ds-picker"
            ref={pickerRef}
          >
          <button
            type="button"
            className={`ds-picker-trigger${pickerOpen ? ' open' : ''}`}
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            <span className="ds-picker-meta">
              <span className="ds-picker-title">{client.label}</span>
              <span className="ds-picker-sub">
                {info ? client.buildMethod(info) : ''}
              </span>
            </span>
            <Icon
              name="chevron-down"
              size={14}
              className="ds-picker-chevron"
              style={{ transform: pickerOpen ? 'rotate(180deg)' : undefined }}
            />
          </button>
          {pickerOpen ? (
            <div className="ds-picker-popover" role="listbox">
              <div className="ds-picker-list">
                {MCP_CLIENTS.map((c) => {
                  const active = c.id === clientId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`ds-picker-item${active ? ' active' : ''}`}
                      onClick={() => {
                        setClientId(c.id);
                        setPickerOpen(false);
                      }}
                    >
                      <span className="ds-picker-item-text">
                        <span className="ds-picker-item-title">{c.label}</span>
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--text-muted)',
                          }}
                        >
                          {info ? c.buildMethod(info) : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {info && client.id !== 'claude' ? (
          <p style={{ margin: 0 }}>{client.buildInstruction(info)}</p>
        ) : null}

        {client.id === 'codex' ? <CodexInstallToggle /> : null}

        {client.buildDeeplink && info ? (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="primary"
              onClick={() => {
                // Use a hidden anchor so the cursor:// scheme is
                // handled the same way as a normal link click; some
                // browsers block window.location assignments to
                // unknown schemes from button handlers.
                const url = client.buildDeeplink!(info);
                const a = document.createElement('a');
                a.href = url;
                a.rel = 'noopener noreferrer';
                a.click();
              }}
              disabled={!info.cliExists || !info.nodeExists}
              style={{ padding: '6px 14px', fontSize: 14 }}
            >
              <Icon name="link" size={14} />
              <span style={{ marginLeft: 6 }}>{client.deeplinkLabel ? client.deeplinkLabel() : ''}</span>
            </button>
            <span
              style={{
                marginLeft: 10,
                fontSize: 13,
                color: 'var(--text-muted)',
              }}
            >
              {t('settings.mcpCursorApproval')}
            </span>
          </div>
        ) : null}

        <div style={{ position: 'relative' }}>
          <pre
            style={{
              background: 'var(--bg-subtle)',
              color: 'var(--text)',
              // Top-align the snippet (first line sits at the top, level with
              // the Copy button) — the right padding already reserves the
              // button's horizontal lane so the first line never runs under it.
              // The right padding is sized for the wider "Copied" post-click
              // state (icon + text + button padding + the 8px right offset)
              // with a few px of buffer for elevated font sizes / zoom.
              // Issue #632.
              padding: '12px 104px 12px 14px',
              borderRadius: 8,
              overflowX: 'auto',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.55,
              margin: 0,
              userSelect: 'text',
              whiteSpace: snippetLang === 'bash' ? 'pre-wrap' : 'pre',
              wordBreak: snippetLang === 'bash' ? 'break-all' : 'normal',
              minHeight: 60,
            }}
            data-lang={snippetLang}
          >
            <code
              style={{
                // Neutralize the global inline-`code` chip style (background,
                // padding, rounded corners, color, size) so it doesn't paint a
                // light rounded rectangle behind every wrapped segment of the
                // dark snippet block — which read as permanent selection
                // highlights on the wrapped `claude mcp add-json` one-liner.
                // Issue #4509.
                background: 'transparent',
                padding: 0,
                borderRadius: 0,
                fontFamily: 'inherit',
                fontSize: 'inherit',
                // Terminal-green text on the bare dark surface (#3BBF7D = the
                // dark theme --green; the block stays dark in both themes).
                color: 'var(--green)',
              }}
            >
              {snippet ||
                (infoError
                  ? t('settings.mcpResolvingFailed')
                  : t('settings.mcpLoadingPaths'))}
            </code>
          </pre>
          <button
            type="button"
            className="ghost mcp-copy-btn"
            onClick={onCopy}
            disabled={!snippet}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              padding: '4px 10px',
              fontSize: 13,
              borderRadius: 999,
            }}
            aria-label={t('settings.mcpCopyAria')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            <span style={{ marginLeft: 4 }}>{copied ? t('settings.mcpCopied') : t('settings.mcpCopy')}</span>
          </button>
        </div>

        {/* "Build the daemon first" lives here — next to the code
            block it explains — rather than at the top of the section
            before the user has seen anything. A dev-mode pre-condition
            warning at the very top reads as "something is broken"
            before the user has even picked their client. */}
        {info && (!info.cliExists || !info.nodeExists) ? (
          <div
            className="empty-card"
            style={{ borderLeft: '3px solid var(--amber)' }}
          >
            <strong>
              {!info.cliExists
                ? t('settings.mcpBuildDaemon')
                : t('settings.mcpNodeMissing')}
            </strong>{' '}
            {info.buildHint ?? t('settings.mcpBuildHint')}
          </div>
        ) : null}

        <p className="mcp-running-note">
          {t('settings.mcpRunningNote')}
        </p>
        </div>{/* end mcp-setup-card */}
      </div>
    </section>
  );
}


// Map the runtime SoundId (hyphenated, used by utils/notifications.ts) onto
// the contract's underscored enum. Sounds that don't have a tracking entry
// drop to undefined so we never emit an off-enum value.
function soundIdToTracking(
  id: string,
):
  | 'ding'
  | 'chime'
  | 'two_tone_up'
  | 'pluck'
  | 'buzz'
  | 'two_tone_down'
  | 'thud'
  | undefined {
  switch (id) {
    case 'ding':
      return 'ding';
    case 'chime':
      return 'chime';
    case 'two-tone-up':
      return 'two_tone_up';
    case 'pluck':
      return 'pluck';
    case 'buzz':
      return 'buzz';
    case 'two-tone-down':
      return 'two_tone_down';
    case 'thud':
      return 'thud';
    default:
      return undefined;
  }
}

function NotificationsSection({
  cfg,
  setCfg,
}: {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
}) {
  const { t } = useI18n();
  const analytics = useAnalytics();
  const notif = cfg.notifications ?? DEFAULT_NOTIFICATIONS;
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => notificationPermission(),
  );
  const [testStatus, setTestStatus] = useState<ReturnType<typeof testNotificationStatusText> | null>(null);

  const updateNotif = (
    patch: Partial<NonNullable<AppConfig['notifications']>>,
  ) => {
    setCfg((c) => ({
      ...c,
      notifications: { ...DEFAULT_NOTIFICATIONS, ...(c.notifications ?? {}), ...patch },
    }));
  };

  const toggleSound = () => {
    const next = !notif.soundEnabled;
    // P1 ui_click area=notifications element=completion_sound — the toggle
    // emits the post-click state on `completion_sound_status` so a single
    // event captures intent + outcome.
    trackSettingsNotificationsClick(analytics.track, {
      page_name: 'settings',
      area: 'notifications',
      element: 'completion_sound',
      completion_sound_status: next ? 'on' : 'off',
    });
    updateNotif({ soundEnabled: next });
    // Give the user immediate audible feedback when turning the master
    // switch on so they know which sound they're signing up for. Resuming
    // the AudioContext also bakes in their gesture for later auto-plays.
    if (next) playSound(notif.successSoundId);
  };

  const toggleDesktop = async () => {
    if (notif.desktopEnabled) {
      trackSettingsNotificationsClick(analytics.track, {
        page_name: 'settings',
        area: 'notifications',
        element: 'desktop_notification',
        desktop_notification_status: 'off',
      });
      updateNotif({ desktopEnabled: false });
      return;
    }
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      trackSettingsNotificationsClick(analytics.track, {
        page_name: 'settings',
        area: 'notifications',
        element: 'desktop_notification',
        desktop_notification_status: 'on',
      });
      updateNotif({ desktopEnabled: true });
    } else {
      trackSettingsNotificationsClick(analytics.track, {
        page_name: 'settings',
        area: 'notifications',
        element: 'desktop_notification',
        desktop_notification_status: 'off',
      });
      updateNotif({ desktopEnabled: false });
    }
  };

  const sendTestNotification = async () => {
    const result = await showCompletionNotification({
      status: 'succeeded',
      title: t('notify.successTitle'),
      body: t('notify.successBody'),
    });
    setPermission(notificationPermission());
    setTestStatus(testNotificationStatusText(result));
  };

  return (
    <section className="settings-section">
      <div className="settings-subsection">
        <div className="settings-notify-card">
          <div className="settings-notify-card-header">
            <h4>{t('settings.notifyCompletionSound')}</h4>
            <div className="section-head-actions">
              <div className="seg-control" role="group" aria-label={t('settings.notifyCompletionSound')} style={{ '--seg-cols': 2 } as React.CSSProperties}>
                <button
                  type="button"
                  className={'seg-btn seg-btn--on' + (notif.soundEnabled ? ' active' : '')}
                  aria-pressed={notif.soundEnabled}
                  onClick={() => { if (!notif.soundEnabled) toggleSound(); }}
                >
                  <span className="seg-title">{t('common.active')}</span>
                </button>
                <button
                  type="button"
                  className={'seg-btn' + (!notif.soundEnabled ? ' active' : '')}
                  aria-pressed={!notif.soundEnabled}
                  onClick={() => { if (notif.soundEnabled) toggleSound(); }}
                >
                  <span className="seg-title">{t('common.inactive')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {notif.soundEnabled ? (
          <>
            <div className="settings-field">
              <label>{t('settings.notifySuccessSound')}</label>
              <div className="seg-control" role="group" aria-label={t('settings.notifySuccessSound')} style={{ '--seg-cols': SUCCESS_SOUNDS.length } as React.CSSProperties}>
                {SUCCESS_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    className={'seg-btn' + (notif.successSoundId === sound.id ? ' active' : '')}
                    aria-pressed={notif.successSoundId === sound.id}
                    onClick={() => {
                      const trackingSoundId = soundIdToTracking(sound.id);
                      trackSettingsNotificationsClick(analytics.track, {
                        page_name: 'settings',
                        area: 'notifications',
                        element: 'success_sound',
                        ...(trackingSoundId ? { sound_id: trackingSoundId } : {}),
                      });
                      updateNotif({ successSoundId: sound.id });
                      playSound(sound.id);
                    }}
                  >
                    <span className="seg-title">{t(sound.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-field">
              <label>{t('settings.notifyFailureSound')}</label>
              <div className="seg-control" role="group" aria-label={t('settings.notifyFailureSound')} style={{ '--seg-cols': FAILURE_SOUNDS.length } as React.CSSProperties}>
                {FAILURE_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    className={'seg-btn' + (notif.failureSoundId === sound.id ? ' active' : '')}
                    aria-pressed={notif.failureSoundId === sound.id}
                    onClick={() => {
                      const trackingSoundId = soundIdToTracking(sound.id);
                      trackSettingsNotificationsClick(analytics.track, {
                        page_name: 'settings',
                        area: 'notifications',
                        element: 'failure_sound',
                        ...(trackingSoundId ? { sound_id: trackingSoundId } : {}),
                      });
                      updateNotif({ failureSoundId: sound.id });
                      playSound(sound.id);
                    }}
                  >
                    <span className="seg-title">{t(sound.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="settings-subsection">
        <div className="settings-notify-card">
          <div className="settings-notify-card-header">
            <h4>{t('settings.notifyDesktop')}</h4>
            <div className="section-head-actions">
              <div className="seg-control" role="group" aria-label={t('settings.notifyDesktop')} style={{ '--seg-cols': 2 } as React.CSSProperties}>
                <button
                  type="button"
                  className={'seg-btn seg-btn--on' + (notif.desktopEnabled ? ' active' : '')}
                  aria-pressed={notif.desktopEnabled}
                  disabled={permission === 'unsupported'}
                  onClick={() => { if (!notif.desktopEnabled) void toggleDesktop(); }}
                >
                  <span className="seg-title">{t('common.active')}</span>
                </button>
                <button
                  type="button"
                  className={'seg-btn' + (!notif.desktopEnabled ? ' active' : '')}
                  aria-pressed={!notif.desktopEnabled}
                  disabled={permission === 'unsupported'}
                  onClick={() => { if (notif.desktopEnabled) void toggleDesktop(); }}
                >
                  <span className="seg-title">{t('common.inactive')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        {permission === 'unsupported' ? (
          <p className="hint">{t('settings.notifyDesktopUnsupported')}</p>
        ) : null}
        {permission === 'denied' ? (
          <p className="hint">{t('settings.notifyDesktopBlocked')}</p>
        ) : null}
        {notif.desktopEnabled && permission === 'granted' ? (
          <>
            <Button variant="ghost" onClick={() => {
              trackSettingsNotificationsClick(analytics.track, {
                page_name: 'settings',
                area: 'notifications',
                element: 'send_test',
              });
              void sendTestNotification();
            }}>
              {t('settings.notifyTest')}
            </Button>
            {testStatus ? <p className="hint" role="status">{t(testStatus)}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function testNotificationStatusText(
  result: Awaited<ReturnType<typeof showCompletionNotification>>,
):
  | 'settings.notifyTestSent'
  | 'settings.notifyDesktopBlocked'
  | 'settings.notifyDesktopUnsupported'
  | 'settings.notifyTestFailed' {
  if (result === 'shown') return 'settings.notifyTestSent';
  if (result === 'permission-denied') return 'settings.notifyDesktopBlocked';
  if (result === 'unsupported') return 'settings.notifyDesktopUnsupported';
  return 'settings.notifyTestFailed';
}
