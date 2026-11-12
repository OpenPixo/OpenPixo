
import { observeAnalytics } from './observe';
import type { ShareGuideClickProps, ShareGuideSurfaceViewProps } from '@openpixo/contracts/analytics';
// Typed track* helpers for the v2 analytics schema. Each helper accepts a
// strongly typed props payload (from @openpixo/contracts/analytics) and
// forwards it through the loosely typed `track()` from AnalyticsProvider.
// Keeping the event-name → prop-shape coupling in one place means call sites
// stay short and stay in lockstep with the daemon-side capture.

import type {
  // page_view / surface_view
  PageViewProps,
  HelpPopoverSurfaceViewProps,
  SettingsPopoverSurfaceViewProps,
  NewProjectModalSurfaceViewProps,
  PluginReplacementModalSurfaceViewProps,
  PluginDetailModalSurfaceViewProps,
  PluginImportModalSurfaceViewProps,
  ProjectReferenceModalSurfaceViewProps,
  AssistantFeedbackReasonPanelSurfaceViewProps,
  QuestionsFormSurfaceViewProps,
  // ui_click
  HomeNavClickProps,
  HelpPopoverClickProps,
  HomeToolbarClickProps,
  ExecutionSettingsPopoverClickProps,
  SettingsPopoverClickProps,
  HomeChatComposerClickProps,
  UpdateIndicatorClickProps,
  NewProjectModalElementClickProps,
  PluginReplacementModalClickProps,
  PrivacyModalClickProps,
  RecentProjectsClickProps,
  HomeTemplatesClickProps,
  HomeTemplatesDropdownClickProps,
  ProjectsListControlsClickProps,
  ProjectsListClickProps,
  ProjectsMorePopoverClickProps,
  PluginsTopClickProps,
  PluginsInstalledTabClickProps,
  PluginsTemplatesDropdownClickProps,
  PluginsAvailableTabClickProps,
  PluginsSourcesTabClickProps,
  PluginImportModalClickProps,
  PluginDetailClickProps,
  PluginLoopClickProps,
  CommunityGalleryClickProps,
  PluginDetailModalClickProps,
  PluginDetailModalSharePopoverClickProps,
  IntegrationsTabClickProps,
  IntegrationsMcpTabClickProps,
  IntegrationsSkillsTabClickProps,
  IntegrationsUseEverywhereTabClickProps,
  ChatPanelClickProps,
  ComposerSessionModeClickProps,
  ComposerBarClickProps,
  NextStepActionClickProps,
  QuestionsFormClickProps,
  RunRecoveryActionClickProps,
  PreviewRunStatusSurfaceViewProps,
  RunFailedToastSurfaceViewProps,
  RunRecoveryActionSurfaceViewProps,
  RunStartBlockedSurfaceViewProps,
  ChatPanelResourcesPopoverClickProps,
  ChatPanelMessageQueueClickProps,
  FileManagerClickProps,
  TabLauncherClickProps,
  ArtifactToolbarClickProps,
  ArtifactHeaderClickProps,
  HandoffClickProps,
  ShareOptionPopoverClickProps,
  FileVersionModalClickProps,
  FileVersionModalSurfaceViewProps,
  FileVersionRestoreResultProps,
  AssistantFeedbackButtonClickProps,
  AssistantFeedbackClickProps,
  AssistantFeedbackReasonClickProps,
  AssistantFeedbackReasonSubmitClickProps,
  ConversationForkClickProps,
  AssistantFeedbackReasonSubmitProps,
  AssistantFeedbackReasonViewProps,
  SettingsSidebarClickProps,
  SettingsExecutionModeTabClickProps,
  SettingsLocalCliClickProps,
  SettingsByokProviderOptionClickProps,
  SettingsByokFieldClickProps,
  SettingsMediaProvidersClickProps,
  SettingsLanguageClickProps,
  SettingsNotificationsClickProps,
  SettingsPetsClickProps,
  SettingsPrivacyClickProps,
  SettingsExternalMcpClickProps,
  // Result events
  ProjectCreateResultProps,
  PluginReplacementResultProps,
  PluginImportResultProps,
  RunCreatedProps,
  RunFinishedProps,
  FileUploadResultProps,
  ContextLinkResultProps,
  ArtifactExportResultProps,
  FeedbackSubmitResultProps,
  ConversationForkResultProps,
  SettingsViewProps,
  LabsItemToggledProps,
  SettingsCliTestResultProps,
  SettingsByokModelsFetchResultProps,
  SettingsByokTestResultProps,
  ByokPreflightBlockedProps,
  OnboardingClickProps,
  AgentDetectDiagnosticProps,
  OnboardingRuntimeScanResultProps,
  OnboardingCompleteResultProps,
  UpdateIndicatorSurfaceViewProps,
  UpdatePromptSurfaceViewProps,
  UpdateCheckResultProps,
  UpdateInstallResultProps,
  WhatsNewPopupSurfaceViewProps,
  WhatsNewPopupClickProps,
  EntryNavigationClickProps,
  AccountMenuClickProps,
  ProjectCollectionClickProps,
  CommunityTemplateClickProps,
  ExtensionMarketplaceClickProps,
  WorkspaceSurfaceViewProps,
  WorkspaceProjectActionResultProps,
  WorkspaceResourceActionResultProps,
} from '@openpixo/contracts/analytics';

type TrackOptions = { requestId?: string; insertId?: string };
export type Track = (
  event: string,
  properties: Record<string, unknown>,
  options?: TrackOptions,
) => void;

// Helper: forward a typed payload to the loose `track()` API. Centralized so
// every call site stays one-line.
import {
  EXPERIENCE_SURVEY_ID,
  EXPERIENCE_SURVEY_IMPROVEMENT_CHOICES,
  EXPERIENCE_SURVEY_IMPROVEMENT_OTHER,
  EXPERIENCE_SURVEY_QUESTION_IDS,
  EXPERIENCE_SURVEY_QUESTION_TEXT,
  EXPERIENCE_SURVEY_TRIGGER,
} from './experience-survey-contract';

function send<T extends object>(
  track: Track,
  event: string,
  props: T,
  options?: TrackOptions,
): void {
  // SAFETY: the same plain typed payload is forwarded without mutation.
  track(event, props as unknown as Record<string, unknown>, options);
}

export function trackShareGuideSurfaceView(track: Track, props: ShareGuideSurfaceViewProps): void {
  observeAnalytics(() => send(track, 'surface_view', props));
}

export function trackShareGuideClick(track: Track, props: ShareGuideClickProps): void {
  observeAnalytics(() => send(track, 'ui_click', props));
}

// ---- page_view -----------------------------------------------------------

export function trackPageView(track: Track, props: PageViewProps): void {
  send(track, 'page_view', props);
}

// ---- Workspace redesign -------------------------------------------------

export function trackEntryNavigationClick(track: Track, props: EntryNavigationClickProps): void {
  send(track, 'ui_click', props);
}

export function trackAccountMenuClick(track: Track, props: AccountMenuClickProps): void {
  send(track, 'ui_click', props);
}

export function trackProjectCollectionClick(track: Track, props: ProjectCollectionClickProps, options?: TrackOptions): void {
  send(track, 'ui_click', props, options);
}

export function trackCommunityTemplateClick(track: Track, props: CommunityTemplateClickProps): void {
  send(track, 'ui_click', props);
}

export function trackExtensionMarketplaceClick(track: Track, props: ExtensionMarketplaceClickProps): void {
  send(track, 'ui_click', props);
}

export function trackWorkspaceSurfaceView(track: Track, props: WorkspaceSurfaceViewProps): void {
  send(track, 'surface_view', props);
}

export function trackWorkspaceProjectActionResult(track: Track, props: WorkspaceProjectActionResultProps, options?: TrackOptions): void {
  send(track, 'workspace_project_action_result', props, options);
}

export function trackWorkspaceResourceActionResult(track: Track, props: WorkspaceResourceActionResultProps, options?: TrackOptions): void {
  send(track, 'workspace_resource_action_result', props, options);
}

// ---- surface_view --------------------------------------------------------

export function trackHelpPopoverSurfaceView(
  track: Track,
  props: HelpPopoverSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackSettingsPopoverSurfaceView(
  track: Track,
  props: SettingsPopoverSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackNewProjectModalSurfaceView(
  track: Track,
  props: NewProjectModalSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackPluginReplacementModalSurfaceView(
  track: Track,
  props: PluginReplacementModalSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackPluginDetailModalSurfaceView(
  track: Track,
  props: PluginDetailModalSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackPluginImportModalSurfaceView(
  track: Track,
  props: PluginImportModalSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackProjectReferenceModalSurfaceView(
  track: Track,
  props: ProjectReferenceModalSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}


export function trackAssistantFeedbackReasonPanelSurfaceView(
  track: Track,
  props: AssistantFeedbackReasonPanelSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackRunFailedToastSurfaceView(
  track: Track,
  props: RunFailedToastSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackRunRecoveryActionSurfaceView(
  track: Track,
  props: RunRecoveryActionSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackRunStartBlockedSurfaceView(
  track: Track,
  props: RunStartBlockedSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackPreviewRunStatusSurfaceView(
  track: Track,
  props: PreviewRunStatusSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackQuestionsFormSurfaceView(
  track: Track,
  props: QuestionsFormSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackRunRecoveryActionClick(
  track: Track,
  props: RunRecoveryActionClickProps,
): void {
  send(track, 'ui_click', props);
}

// ---- ui_click (home) -----------------------------------------------------

export function trackHomeNavClick(
  track: Track,
  props: HomeNavClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackHelpPopoverClick(
  track: Track,
  props: HelpPopoverClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackHomeToolbarClick(
  track: Track,
  props: HomeToolbarClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackExecutionSettingsPopoverClick(
  track: Track,
  props: ExecutionSettingsPopoverClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsPopoverClick(
  track: Track,
  props: SettingsPopoverClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackHomeChatComposerClick(
  track: Track,
  props: HomeChatComposerClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackUpdateIndicatorClick(
  track: Track,
  props: UpdateIndicatorClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackNewProjectModalElementClick(
  track: Track,
  props: NewProjectModalElementClickProps,
  options?: { requestId?: string },
): void {
  send(track, 'ui_click', props, options);
}

export function trackPluginReplacementModalClick(
  track: Track,
  props: PluginReplacementModalClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPrivacyModalClick(
  track: Track,
  props: PrivacyModalClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackRecentProjectsClick(
  track: Track,
  props: RecentProjectsClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackHomeTemplatesClick(
  track: Track,
  props: HomeTemplatesClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackHomeTemplatesDropdownClick(
  track: Track,
  props: HomeTemplatesDropdownClickProps,
): void {
  send(track, 'ui_click', props);
}

// ---- ui_click (projects) -------------------------------------------------

export function trackProjectsListControlsClick(
  track: Track,
  props: ProjectsListControlsClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackProjectsListClick(
  track: Track,
  props: ProjectsListClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackProjectsMorePopoverClick(
  track: Track,
  props: ProjectsMorePopoverClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginsTopClick(
  track: Track,
  props: PluginsTopClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginsInstalledTabClick(
  track: Track,
  props: PluginsInstalledTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginsTemplatesDropdownClick(
  track: Track,
  props: PluginsTemplatesDropdownClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginsAvailableTabClick(
  track: Track,
  props: PluginsAvailableTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginsSourcesTabClick(
  track: Track,
  props: PluginsSourcesTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginImportModalClick(
  track: Track,
  props: PluginImportModalClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginDetailClick(
  track: Track,
  props: PluginDetailClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginLoopClick(
  track: Track,
  props: PluginLoopClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackCommunityGalleryClick(
  track: Track,
  props: CommunityGalleryClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginDetailModalClick(
  track: Track,
  props: PluginDetailModalClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackPluginDetailModalSharePopoverClick(
  track: Track,
  props: PluginDetailModalSharePopoverClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackIntegrationsTabClick(
  track: Track,
  props: IntegrationsTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackIntegrationsMcpTabClick(
  track: Track,
  props: IntegrationsMcpTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackIntegrationsSkillsTabClick(
  track: Track,
  props: IntegrationsSkillsTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackIntegrationsUseEverywhereTabClick(
  track: Track,
  props: IntegrationsUseEverywhereTabClickProps,
): void {
  send(track, 'ui_click', props);
}

// ---- ui_click (chat panel) -----------------------------------------------

export function trackChatPanelClick(
  track: Track,
  props: ChatPanelClickProps,
): void {
  send(track, 'ui_click', props);
}

// Dormant with `ComposerModePicker` (see that file's header): both composers
// have dropped the mode chip, so nothing calls this today. Kept so the picker
// can be restored in one step — do NOT delete it as dead code.
export function trackComposerSessionModeClick(
  track: Track,
  props: ComposerSessionModeClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackComposerBarClick(
  track: Track,
  props: ComposerBarClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackNextStepActionClick(
  track: Track,
  props: NextStepActionClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackQuestionsFormClick(
  track: Track,
  props: QuestionsFormClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackChatPanelResourcesPopoverClick(
  track: Track,
  props: ChatPanelResourcesPopoverClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackMessageQueueClick(
  track: Track,
  props: ChatPanelMessageQueueClickProps,
): void {
  send(track, 'ui_click', props);
}

// ---- ui_click (file manager / artifact) ----------------------------------

export function trackFileManagerClick(
  track: Track,
  props: FileManagerClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackTabLauncherClick(
  track: Track,
  props: TabLauncherClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackArtifactToolbarClick(
  track: Track,
  props: ArtifactToolbarClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackArtifactHeaderClick(
  track: Track,
  props: ArtifactHeaderClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackHandoffClick(
  track: Track,
  props: HandoffClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackShareOptionPopoverClick(
  track: Track,
  props: ShareOptionPopoverClickProps,
  options?: { requestId: string },
): void {
  send(track, 'ui_click', props, options);
}

export function trackFileVersionModalClick(
  track: Track,
  props: FileVersionModalClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackFileVersionModalSurfaceView(
  track: Track,
  props: FileVersionModalSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

// ---- ui_click (feedback) -------------------------------------------------

export function trackAssistantFeedbackButtonClick(
  track: Track,
  props: AssistantFeedbackButtonClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackConversationForkClick(
  track: Track,
  props: ConversationForkClickProps,
  options?: { requestId?: string },
): void {
  send(track, 'ui_click', props, options);
}

export function trackAssistantFeedbackReasonSubmitClick(
  track: Track,
  props: AssistantFeedbackReasonSubmitClickProps,
  options?: { requestId?: string },
): void {
  send(track, 'ui_click', props, options);
}

// ---- ui_click (settings) -------------------------------------------------

export function trackSettingsSidebarClick(
  track: Track,
  props: SettingsSidebarClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsExecutionModeTabClick(
  track: Track,
  props: SettingsExecutionModeTabClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsLocalCliClick(
  track: Track,
  props: SettingsLocalCliClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsByokProviderOptionClick(
  track: Track,
  props: SettingsByokProviderOptionClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsByokFieldClick(
  track: Track,
  props: SettingsByokFieldClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsMediaProvidersClick(
  track: Track,
  props: SettingsMediaProvidersClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsLanguageClick(
  track: Track,
  props: SettingsLanguageClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsNotificationsClick(
  track: Track,
  props: SettingsNotificationsClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsPetsClick(
  track: Track,
  props: SettingsPetsClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsPrivacyClick(
  track: Track,
  props: SettingsPrivacyClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackSettingsExternalMcpClick(
  track: Track,
  props: SettingsExternalMcpClickProps,
): void {
  send(track, 'ui_click', props);
}

// ---- Result events -------------------------------------------------------

export function trackProjectCreateResult(
  track: Track,
  props: ProjectCreateResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'project_create_result', props, options);
}

export function trackPluginReplacementResult(
  track: Track,
  props: PluginReplacementResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'plugin_replacement_result', props, options);
}

export function trackPluginImportResult(
  track: Track,
  props: PluginImportResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'plugin_import_result', props, options);
}

export function trackRunCreated(
  track: Track,
  props: RunCreatedProps,
  options?: { requestId?: string },
): void {
  send(track, 'run_created', props, options);
}

export function trackRunFinished(
  track: Track,
  props: RunFinishedProps,
  options?: { requestId?: string },
): void {
  send(track, 'run_finished', props, options);
}

export function trackFileUploadResult(
  track: Track,
  props: FileUploadResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'file_upload_result', props, options);
}

export function trackContextLinkResult(
  track: Track,
  props: ContextLinkResultProps,
): void {
  send(track, 'context_link_result', props);
}

export function trackArtifactExportResult(
  track: Track,
  props: ArtifactExportResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'artifact_export_result', props, options);
}

export function trackFileVersionRestoreResult(
  track: Track,
  props: FileVersionRestoreResultProps,
): void {
  send(track, 'file_version_restore_result', props);
}

export function trackFeedbackSubmitResult(
  track: Track,
  props: FeedbackSubmitResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'feedback_submit_result', props, options);
}

export function trackConversationForkResult(
  track: Track,
  props: ConversationForkResultProps,
  options?: { requestId?: string },
): void {
  send(track, 'conversation_fork_result', props, options);
}

// ---- Settings view + test/auth result events -----------------------------

export function trackSettingsView(
  track: Track,
  props: SettingsViewProps,
): void {
  send(track, 'settings_view', props);
}

// ---- Labs ----------------------------------------------------------------

/**
 * Fires after the preference is persisted, not on click.
 *
 * The event asserts "this install now prefers X". A failed write rolls the
 * switch back, so reporting the click would assert something that is not true
 * of the machine. Losing the rare failed toggle is the cheaper error.
 */
export function trackLabsItemToggled(track: Track, props: LabsItemToggledProps): void {
  send(track, 'labs_item_toggled', props);
}

export function trackSettingsCliTestResult(
  track: Track,
  props: SettingsCliTestResultProps,
): void {
  send(track, 'settings_cli_test_result', props);
}

export function trackSettingsByokTestResult(
  track: Track,
  props: SettingsByokTestResultProps,
): void {
  send(track, 'settings_byok_test_result', props);
}

export function trackSettingsByokModelsFetchResult(
  track: Track,
  props: SettingsByokModelsFetchResultProps,
): void {
  send(track, 'settings_byok_models_fetch_result', props);
}

export function trackByokPreflightBlocked(
  track: Track,
  props: ByokPreflightBlockedProps,
): void {
  send(track, 'byok_preflight_blocked', props);
}

export function trackAssistantFeedbackClick(
  track: Track,
  props: AssistantFeedbackClickProps,
) {
  track(
    'assistant_feedback_click',
    // SAFETY: the typed feedback payload is a plain string-keyed object, passed unchanged to track.
    props as unknown as Record<string, unknown>,
  );
}

export function trackAssistantFeedbackReasonView(
  track: Track,
  props: AssistantFeedbackReasonViewProps,
) {
  track(
    'assistant_feedback_reason_view',
    // SAFETY: the typed feedback payload is a plain string-keyed object, passed unchanged to track.
    props as unknown as Record<string, unknown>,
  );
}

export function trackAssistantFeedbackReasonClick(
  track: Track,
  props: AssistantFeedbackReasonClickProps,
  options?: { requestId: string },
) {
  track(
    'assistant_feedback_reason_click',
    // SAFETY: the typed feedback payload is a plain string-keyed object, passed unchanged to track.
    props as unknown as Record<string, unknown>,
    options,
  );
}

export function trackAssistantFeedbackReasonSubmit(
  track: Track,
  props: AssistantFeedbackReasonSubmitProps,
  options?: { requestId: string },
) {
  track(
    'assistant_feedback_reason_submit',
    // SAFETY: the typed feedback payload is a plain string-keyed object, passed unchanged to track.
    props as unknown as Record<string, unknown>,
    options,
  );
}

// ---- Onboarding ---------------------------------------------------------
//
// Runtime setup clicks, CLI scan results and setup completion stay observable.

export function trackOnboardingClick(
  track: Track,
  props: OnboardingClickProps,
): void {
  send(track, 'ui_click', props);
}

export function trackAgentDetectDiagnostic(
  track: Track,
  props: AgentDetectDiagnosticProps,
): void {
  send(track, 'agent_detect_diagnostic', props);
}

export function trackOnboardingRuntimeScanResult(
  track: Track,
  props: OnboardingRuntimeScanResultProps,
): void {
  send(track, 'onboarding_runtime_scan_result', props);
}

export function trackOnboardingCompleteResult(
  track: Track,
  props: OnboardingCompleteResultProps,
): void {
  send(track, 'onboarding_complete_result', props);
}

// ---- Update indicator / prompt ------------------------------------------

export function trackUpdateIndicatorSurfaceView(
  track: Track,
  props: UpdateIndicatorSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackUpdatePromptSurfaceView(
  track: Track,
  props: UpdatePromptSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackUpdateInstallResult(
  track: Track,
  props: UpdateInstallResultProps,
): void {
  send(track, 'update_install_result', props);
}

export function trackUpdateCheckResult(
  track: Track,
  props: UpdateCheckResultProps,
): void {
  send(track, 'update_check_result', props);
}

// ---- Post-update "what's new" card ---------------------------------------

export function trackWhatsNewPopupSurfaceView(
  track: Track,
  props: WhatsNewPopupSurfaceViewProps,
): void {
  send(track, 'surface_view', props);
}

export function trackWhatsNewPopupClick(
  track: Track,
  props: WhatsNewPopupClickProps,
): void {
  send(track, 'ui_click', props);
}

// ---- experience survey ---------------------------------------------------
// The experience survey is `type: api` in PostHog: PostHog stores and analyses
// the responses while `ExperienceSurvey` renders the card. That makes the
// client responsible for the three reserved event names PostHog's survey
// analytics reads, which is the only place in this app that emits reserved
// PostHog events rather than the v2 schema's own.

export function trackExperienceSurveyShown(track: Track): void {
  send(track, 'survey shown', {
    $survey_id: EXPERIENCE_SURVEY_ID,
    trigger: EXPERIENCE_SURVEY_TRIGGER,
  });
}

export function trackExperienceSurveyDismissed(track: Track): void {
  send(track, 'survey dismissed', {
    $survey_id: EXPERIENCE_SURVEY_ID,
    trigger: EXPERIENCE_SURVEY_TRIGGER,
  });
}

/**
 * Reports a finished response. A skipped follow-up is omitted rather than sent
 * as null, so PostHog's per-question response counts stay honest about how
 * many people actually answered it.
 */
export function trackExperienceSurveySent(
  track: Track,
  answers: { recommendation: number; improvement?: number; improvementOther?: string },
): void {
  const ids = EXPERIENCE_SURVEY_QUESTION_IDS;
  const text = EXPERIENCE_SURVEY_QUESTION_TEXT;
  const answered: Array<{ id: string; question: string; response: string | number }> = [];
  const responses: Record<string, string | number> = {};

  const add = (id: string, question: string, response: string | number) => {
    answered.push({ id, question, response });
    responses[`$survey_response_${id}`] = response;
  };

  add(ids.recommendation, text.recommendation, answers.recommendation);
  if (typeof answers.improvementOther === 'string') {
    // PostHog's open-choice convention: the response is what they typed. An
    // empty field still reports the choice itself, so "none of these fit"
    // survives instead of looking like the question was skipped.
    add(
      ids.improvement,
      text.improvement,
      answers.improvementOther.trim() || EXPERIENCE_SURVEY_IMPROVEMENT_OTHER,
    );
  } else if (typeof answers.improvement === 'number') {
    const choice = EXPERIENCE_SURVEY_IMPROVEMENT_CHOICES[answers.improvement];
    if (choice) add(ids.improvement, text.improvement, choice);
  }

  send(track, 'survey sent', {
    $survey_id: EXPERIENCE_SURVEY_ID,
    trigger: EXPERIENCE_SURVEY_TRIGGER,
    $survey_questions: answered,
    ...responses,
  });
}
