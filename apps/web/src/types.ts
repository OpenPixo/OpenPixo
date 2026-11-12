import type {
  AgentInfo,
  GameEnginePaths,
  GameExperience,
  AgentDiagnostic,
  AgentFixIntent,
  AgentCliEnvPrefs,
  AgentCliEnvIntentPrefs,
  AgentModelPrefs,
  AgentApprovalModes,
  AgentTestRequest,
  AppRuntimeCapabilities,
  AppVersionInfo,
  AppVersionResponse,
  WhatsNewContent,
  WhatsNewLocaleContent,
  WhatsNewResponse,
  AudioKind,
  ChatAttachment,
  ChatMessageFeedback,
  ChatMessageFeedbackRating,
  ChatMessageFeedbackReasonCode,
  ChatMessage,
  ConnectionTestKind,
  ConnectionTestProtocol,
  ConnectionTestRequest,
  ConnectionTestResponse,
  Conversation,
  MediaAspect,
  ProviderTestRequest,
  PersistedAgentEvent,
  ProviderModelOption,
  ProviderModelsKind,
  ProviderModelsRequest,
  ProviderModelsResponse,
  Project,
  ProjectLocationPrefs,
  ProjectPlatform,
  ProjectBrowserWorkspaceTab,
  ProjectTabsState,
  ProjectDisplayStatus,
  ProjectFile,
  ProjectFolder,
  ProjectFileKind,
  ProjectKind,
  ProjectMetadata,
  ProjectTemplate,
  RenameProjectFileResponse,
  SkillDetail,
  SkillSummary,
  InstallInput,
  InstallSkillRequest,
  InstallSkillResponse,
  UninstallResponse,
} from '@openpixo/contracts';

export type {
  ProjectLocation,
} from '@openpixo/contracts';

export type ExecMode = 'daemon' | 'api';
export type ApiProtocol =
  | 'anthropic'
  | 'openai'
  | 'azure'
  | 'google'
  | 'ollama'
  | 'senseaudio'
  | 'aihubmix'
  | 'bedrock';
// Tab ids are arbitrary strings; the template-literal members below are
// conventions FileWorkspace's `.ws-body` switch keys off (`live:` → live
// artifact viewer, `chat:` → Side Chat tab). See `SideChatTabId` below.
export type ProjectWorkspaceTabId =
  | string
  | SideChatTabId
  | TerminalTabId;

// Side Chat tab convention. A `chat:<conversationId>` tab mounts a secondary
// ChatPane bound to that conversation (Stage 2), mirroring the `live:` scheme
// above. The conversation is a normal conversation, so it also shows up in the
// conversation list.
export type SideChatTabId = `chat:${string}`;

export function sideChatTabId(conversationId: string): SideChatTabId {
  return `chat:${conversationId}`;
}

export function isSideChatTabId(tabId: string): tabId is SideChatTabId {
  return tabId.startsWith('chat:') && tabId.length > 'chat:'.length;
}

export function conversationIdFromSideChatTabId(tabId: SideChatTabId): string {
  return tabId.slice('chat:'.length);
}

// Terminal tab convention. A `terminal:<terminalId>` tab mounts an xterm.js
// surface bound to a daemon PTY session (Stage 3), mirroring the `chat:` and
// `live:` schemes above. The terminal id is the session id returned by
// `POST /api/projects/:id/terminals`.
export type TerminalTabId = `terminal:${string}`;

export function terminalTabId(terminalId: string): TerminalTabId {
  return `terminal:${terminalId}`;
}

export function isTerminalTabId(tabId: string): tabId is TerminalTabId {
  return tabId.startsWith('terminal:') && tabId.length > 'terminal:'.length;
}

export function terminalIdFromTabId(tabId: TerminalTabId): string {
  return tabId.slice('terminal:'.length);
}

export interface ProjectFileWorkspaceEntry {
  kind: 'file';
  tabId: string;
  name: string;
  file: ProjectFile;
}

export type ProjectWorkspaceEntry = ProjectFileWorkspaceEntry;

export interface MediaProviderCredentials {
  apiKey: string;
  baseUrl: string;
  model?: string;
  apiKeyConfigured?: boolean;
  apiKeyTail?: string;
  source?: string;
}

export interface ApiProtocolConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiVersion?: string;
  apiProviderBaseUrl?: string | null;
  /** SenseAudio BYOK only — default image model the daemon-side
   *  `generate_image` tool uses when the LLM doesn't pass one. Carries
   *  one of the SenseAudio image model ids (`senseaudio-image-2.0-260319`,
   *  `senseaudio-image-1.0-260319`, `doubao-seedream-5-0-260128`). Stored
   *  per-protocol so flipping between BYOK tabs doesn't reset the
   *  SenseAudio image-model choice. */
  byokImageModel?: string;
  /** BYOK only — default video model the daemon-side `generate_video` tool
   *  uses when the LLM doesn't pass one. Carries an `aihubmix-` prefixed
   *  video model id. Stored per-protocol, like byokImageModel. */
  byokVideoModel?: string;
  /** BYOK only — default speech (TTS) model for the daemon-side generate_speech
   *  tool (`aihubmix-` prefixed). Stored per-protocol, like byokImageModel. */
  byokSpeechModel?: string;
  /** BYOK only — default speech voice id for the generate_speech tool. */
  byokSpeechVoice?: string;
}

export interface ByokProviderConfigDraft {
  apiConfig: ApiProtocolConfig;
  maxTokens?: number;
}

// Per-CLI model + reasoning the user picked in the model menu. Each agent
// keeps its own slot so flipping between Codex and Claude doesn't reset the
// other one's choice. Missing entries fall back to the agent's first
// declared model (`'default'` — let the CLI pick).
export type AgentModelChoice = AgentModelPrefs;
export type AgentCliEnvConfig = AgentCliEnvPrefs;
export type AgentCliEnvIntentConfig = AgentCliEnvIntentPrefs;

export type AppTheme = 'system' | 'light' | 'dark';

export interface NotificationsConfig {
  // Master switch for the completion sound. Default true; users can opt out.
  soundEnabled: boolean;
  // Sound id played when a turn ends with `runStatus === 'succeeded'`.
  successSoundId: string;
  // Sound id played when a turn ends with `runStatus === 'failed'`.
  failureSoundId: string;
  // Master switch for the browser Notification API banner. Default true.
  desktopEnabled: boolean;
}

export interface AppConfig {
  gameEnginePaths?: GameEnginePaths;
  mode: ExecMode;
  apiKey: string;
  baseUrl: string;
  model: string;
  apiProtocol?: ApiProtocol;
  apiVersion?: string;
  /** SenseAudio BYOK only — default image model for the daemon-side
   *  generate_image tool. Mirrors apiProtocolConfigs.senseaudio.byokImageModel
   *  so the active protocol's value lives at the top level (consistent
   *  with how apiKey / baseUrl / model are projected onto AppConfig). */
  byokImageModel?: string;
  /** BYOK only — default video model for the daemon-side generate_video tool.
   *  Mirrors apiProtocolConfigs.<protocol>.byokVideoModel onto AppConfig. */
  byokVideoModel?: string;
  /** BYOK only — default speech model + voice for the generate_speech tool. */
  byokSpeechModel?: string;
  byokSpeechVoice?: string;
  apiProtocolConfigs?: Partial<Record<ApiProtocol, ApiProtocolConfig>>;
  /** BYOK provider drafts keyed by protocol + selected provider base URL. */
  byokProviderConfigDrafts?: Record<string, ByokProviderConfigDraft>;
  /** Provider draft restored first when Settings returns to BYOK. */
  byokPendingProviderKey?: string;
  /** Internal config schema/migration version for localStorage upgrades. */
  configMigrationVersion?: number;
  /** Base URL of the selected known provider; cleared once the user customizes provider fields. */
  apiProviderBaseUrl?: string | null;
  agentId: string | null;
  skillId: string | null;
  theme?: AppTheme;
  accentColor?: string;
  // True once the user has been through the welcome onboarding modal at
  // least once (saved or skipped). Bootstrap skips the auto-popup when
  // this is set so refreshing the page doesn't re-prompt.
  onboardingCompleted?: boolean;
  /** "Have you made a game before?", asked on the first new game; mirrors the daemon's app config. */
  gameExperience?: GameExperience | null;
  account?: import('./state/account').AppAccount | null;
  mediaProviders?: Record<string, MediaProviderCredentials>;
  // Per-CLI model picker state, keyed by agent id (e.g. `claude`, `codex`).
  // Pre-existing configs without this field fall through to the agent's
  // declared default.
  agentModels?: Record<string, AgentModelChoice>;
  agentApprovalModes?: AgentApprovalModes;
  // Per-agent non-secret CLI config locations injected into detection and runs.
  agentCliEnv?: AgentCliEnvConfig;
  // Per-agent marker that says an API key was saved as an explicit Local CLI
  // environment override, not as an older proxy-only credential.
  agentCliEnvIntent?: AgentCliEnvIntentConfig;
  // Caps the upstream completion length in API mode. Defaults to 8192 when
  // unset; raise it for providers (e.g. MiMo) that allow longer responses.
  maxTokens?: number;
  // Optional Codex-style animated companion. Older configs that pre-date
  // the feature land at `undefined`, which the loader normalizes to a
  // safe default (un-adopted, hidden until the user opts in).
  // Optional task-completion sound + browser notification settings. Older
  // configs that pre-date the feature land at `undefined`, which the loader
  // normalizes to a safe default (everything off).
  notifications?: NotificationsConfig;
  // IDs of skills/design-systems the user has explicitly disabled.
  disabledSkills?: string[];
  // Anonymous install identifier for telemetry. Generated locally the first
  // time a user opts in via Settings → Privacy. `null` after the user
  // explicitly opts out (or rotates "Delete my data"); `undefined` when the
  // daemon has not assigned an anonymous id yet.
  installationId?: string | null;
  // Unix-millis timestamp recording that the first-run privacy prompt was
  // resolved. This is independent from installationId so Delete my data can
  // rotate or clear the anonymous id without re-opening the consent banner.
  privacyDecisionAt?: number | null;
  allowSilentUpdates?: boolean;
  // Privacy preferences governing what (if anything) is shipped to the
  // PostHog telemetry endpoints. `metrics` and `content`
  // default ON (set by `DEFAULT_CONFIG.telemetry` in state/config.ts) so
  // the onboarding funnel actually captures the first-run events. The
  // post-onboarding disclosure modal explains this and Settings → Privacy is
  // the one-click opt-out. Complete-context object manifests follow the
  // Metrics preferences A daemon-stored override always wins over these client
  // defaults — once the user picks a value the modal / PrivacySection persist
  // it through `syncConfigToDaemon`.
  telemetry?: TelemetryConfig;
  customInstructions?: string;
  projectLocations?: ProjectLocationPrefs[];
  defaultProjectLocationId?: string | null;
}

export interface TelemetryConfig {
  metrics?: boolean;
}

export type AgentEvent = PersistedAgentEvent;

export type ChatMessageFeedbackChange =
  | ({
      rating: ChatMessageFeedbackRating;
    } & Partial<
      Pick<
        ChatMessageFeedback,
        'reasonCodes' | 'customReason' | 'reasonsSubmittedAt'
      >
    >)
  | null;

export type {
  ChatAttachment,
  ChatMessage,
  ChatMessageFeedbackRating,
  ChatMessageFeedbackReasonCode,
};

export type {
  ProjectBrowserWorkspaceTab,
};

export interface Artifact {
  identifier: string;
  artifactType?: string;
  title: string;
  html: string;
  savedUrl?: string;
}

export interface ExamplePreview {
  source: 'skill';
  id: string;
  title: string;
  html: string;
}

export type ModelCost = 'low' | 'medium' | 'high' | 'very_high';

export type ModelCapability = 'standard' | 'advanced' | 'best_quality';

export interface ModelMetadata {
  cost?: ModelCost;
  capability?: ModelCapability;
}

export interface AgentModelOption {
  id: string;
  label: string;
  enabled?: boolean;
  default?: boolean;
  inputPriceUsdPerMillion?: number;
  outputPriceUsdPerMillion?: number;
  metadata?: ModelMetadata;
  additionalSpeedTiers?: string[];
  serviceTierOptions?: AgentModelOption[];
}

export type Surface = 'web' | 'image' | 'video' | 'audio';

export interface PromptTemplateSource {
  repo: string;
  license: string;
  author?: string;
  url?: string;
}

export interface PromptTemplateSummary {
  id: string;
  surface: 'image' | 'video';
  title: string;
  summary: string;
  category: string;
  tags?: string[];
  model?: string;
  aspect?: MediaAspect;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  source: PromptTemplateSource;
}

export interface PromptTemplateDetail extends PromptTemplateSummary {
  prompt: string;
}

export type {
  AgentInfo,
  AgentDiagnostic,
  AgentFixIntent,
  AgentTestRequest,
  AppRuntimeCapabilities,
  AppVersionInfo,
  AppVersionResponse,
  WhatsNewContent,
  WhatsNewLocaleContent,
  WhatsNewResponse,
  AudioKind,
  ConnectionTestKind,
  ConnectionTestProtocol,
  ConnectionTestRequest,
  ConnectionTestResponse,
  Conversation,
  MediaAspect,
  Project,
  ProjectPlatform,
  ProjectDisplayStatus,
  ProjectFile,
  ProjectFolder,
  ProjectFileKind,
  ProjectKind,
  ProjectMetadata,
  ProjectTemplate,
  RenameProjectFileResponse,
  ProviderTestRequest,
  ProviderModelOption,
  ProviderModelsKind,
  ProviderModelsRequest,
  ProviderModelsResponse,
  SkillDetail,
  SkillSummary,
  InstallInput,
  InstallSkillRequest,
  InstallSkillResponse,
  UninstallResponse,
};

export type OpenTabsState = ProjectTabsState;
