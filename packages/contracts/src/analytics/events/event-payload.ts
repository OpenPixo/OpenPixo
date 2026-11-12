import type { ClientMetricEventPayload } from '../client-metrics.js';
import type { UpdateLifecycleObservedProps } from '../update-lifecycle.js';
import type { AnalyticsEventName } from './event-names.js';
import type * as Onboarding from './onboarding.js';
import type * as Result from './result-events.js';
import type * as Mcp from './mcp.js';
import type * as Workspace from './workspace.js';
import type { PageViewProps } from './page-view.js';
import type { SurfaceViewProps } from './surface-view.js';
import type { UiClickProps } from './ui-click.js';

interface EventProps {
  packaged_runtime_failed: Result.PackagedRuntimeFailedProps;
  page_view: PageViewProps;
  ui_click: UiClickProps;
  surface_view: SurfaceViewProps;
  project_create_result: Result.ProjectCreateResultProps;
  plugin_replacement_result: Result.PluginReplacementResultProps;
  plugin_import_result: Result.PluginImportResultProps;
  run_created: Result.RunCreatedProps;
  run_finished: Result.RunFinishedProps;
  run_retry_attempted: Result.RunRetryAttemptedProps;
  run_retry_finished: Result.RunRetryFinishedProps;
  mcp_session_initialized: Mcp.McpSessionInitializedProps;
  mcp_tool_started: Mcp.McpToolStartedProps;
  mcp_tool_finished: Mcp.McpToolFinishedProps;
  media_generation_result: Result.MediaGenerationResultProps;
  chat_artifact_capture_result: Result.ChatArtifactCaptureResultProps;
  update_install_result: Result.UpdateInstallResultProps;
  update_check_result: Result.UpdateCheckResultProps;
  update_apply_observed: Result.UpdateApplyObservedProps;
  update_lifecycle_observed: UpdateLifecycleObservedProps;
  file_upload_result: Result.FileUploadResultProps;
  context_link_result: Result.ContextLinkResultProps;
  artifact_export_result: Result.ArtifactExportResultProps;
  file_version_restore_result: Result.FileVersionRestoreResultProps;
  workspace_project_action_result: Workspace.WorkspaceProjectActionResultProps;
  workspace_resource_action_result: Workspace.WorkspaceResourceActionResultProps;
  conversation_fork_result: Result.ConversationForkResultProps;
  feedback_submit_result: Result.FeedbackSubmitResultProps;
  assistant_feedback_click: Result.AssistantFeedbackClickProps;
  assistant_feedback_reason_view: Result.AssistantFeedbackReasonViewProps;
  assistant_feedback_reason_click: Result.AssistantFeedbackReasonClickProps;
  assistant_feedback_reason_submit: Result.AssistantFeedbackReasonSubmitProps;
  settings_view: Result.SettingsViewProps;
  labs_item_toggled: Result.LabsItemToggledProps;
  settings_cli_test_result: Result.SettingsCliTestResultProps;
  settings_byok_test_result: Result.SettingsByokTestResultProps;
  settings_byok_models_fetch_result: Result.SettingsByokModelsFetchResultProps;
  byok_preflight_blocked: Result.ByokPreflightBlockedProps;
  agent_detect_diagnostic: Result.AgentDetectDiagnosticProps;
  onboarding_runtime_scan_result: Onboarding.OnboardingRuntimeScanResultProps;
  onboarding_complete_result: Onboarding.OnboardingCompleteResultProps;
}

export type AnalyticsEventPayload = ClientMetricEventPayload | {
  [Event in keyof EventProps]: { event: Event; props: EventProps[Event] }
}[keyof EventProps];

type AnalyticsEventCatalogDrift =
  | Exclude<AnalyticsEventName, AnalyticsEventPayload['event']>
  | Exclude<AnalyticsEventPayload['event'], AnalyticsEventName>;
type AssertAnalyticsEventCatalogInSync<_Drift extends never = AnalyticsEventCatalogDrift> = _Drift;
