/**
 * @module analytics/events/surface-view
 * surface_view event prop types and their union.
 */
import type { TrackingRunRecoveryActionType } from './result-events.js';
import type { TrackingArtifactKind, TrackingProjectKind, TrackingRunFailureCategory } from './shared-enums.js';
import type { WorkspaceSurfaceViewProps } from './workspace.js';
// ---- surface_view --------------------------------------------------------

export interface HelpPopoverSurfaceViewProps {
  page_name: 'home';
  area: 'help_resources_popover';
}

// Impression of the header gear settings popover. Mirrors
// HelpPopoverSurfaceViewProps: fires once each time the popover opens so the
// share / language funnels have a denominator.
export interface SettingsPopoverSurfaceViewProps {
  page_name: 'home' | 'artifact';
  area: 'settings_popover';
}

export interface NewProjectModalSurfaceViewProps {
  page_name: 'home';
  area: 'new_project_modal';
  tab_name: 'media';
}

export interface PluginReplacementModalSurfaceViewProps {
  page_name: 'home';
  area: 'plugin_replacement_modal';
}

// Impression of the plugin detail modal opened from the home Community
// gallery. Fires once per open so the gallery → detail funnel has a
// denominator (card clicks) and a numerator (modal exposures).
export interface PluginDetailModalSurfaceViewProps {
  page_name: 'home';
  area: 'plugin_detail_modal';
  plugin_id?: string;
  plugin_type?: string;
}

// Impression of the "Import a plugin" modal on the Plugins page. Fires once
// per open so the import funnel has a denominator for source_tab / import
// clicks and plugin_import_result.
export interface PluginImportModalSurfaceViewProps {
  page_name: 'plugins';
  area: 'import_modal';
}

// The "Reference project" picker modal opened from the composer "+" menu
// (Files group) on the home hero or the in-project chat composer. Exposure
// baseline for the reference-project funnel: surface_view → ui_click
// `plus_pick` (workspace/reference-project) → `context_link_result`.
export interface ProjectReferenceModalSurfaceViewProps {
  page_name: 'home' | 'chat_panel';
  area: 'project_reference_modal';
  project_id?: string;
}

// Impression of a failed-run error card, once per rendered toast.
export interface RunFailedToastSurfaceViewProps {
  page_name: 'chat_panel';
  area: 'chat_panel';
  element: 'run_failed_toast';
  error_code: string;
  /**
   * WHICH SENTENCE the user actually read: the i18n key of the mapped copy,
   * or `generic_fallback` when the mapping table had no line for this failure
   * and the card fell back to "the task failed".
   *
   * Always present, never omitted. The fallback rate — how often we show a
   * failed user a blank apology instead of a diagnosis — is the whole point,
   * and a rate needs a denominator: an omitted key would silently drop the
   * fallback impressions out of the count that is supposed to measure them.
   *
   * Not typed as the web's `RunFailureMessageKey` union: that union lives in
   * `apps/web` and grows every time copy is added, and pinning it here would
   * make a copy change a contracts change.
   */
  message_key: string;
  /**
   * The daemon's own classification of the failure, as carried on the run's
   * error event. `unknown` when the event carries none — the enum's existing
   * member for exactly that, so the field stays present and the shape stays
   * one that `run_finished` / `run_recovery_action` can be joined against.
   */
  failure_category: TrackingRunFailureCategory;
  project_id: string;
  project_kind: TrackingProjectKind | null;
  conversation_id: string | null;
  assistant_message_id: string;
  run_id: string | null;
}

export interface RunRecoveryActionSurfaceViewProps {
  page_name: 'chat_panel';
  area: 'chat_panel';
  element: 'run_recovery_action';
  task_execution_id: string;
  recovery_action_instance_id: string;
  recovery_action_type: TrackingRunRecoveryActionType;
  source_run_id?: string;
  source_agent_provider_id?: string;
  source_model_id?: string;
  failure_category?: string;
  failure_reason?: string;
}

export interface RunStartBlockedSurfaceViewProps {
  page_name: 'chat_panel';
  area: 'chat_composer';
  element: 'run_start_blocked';
  task_execution_id: string;
  recovery_action_instance_id: string;
  block_reason: string;
  agent_provider_id: string;
  model_id: string;
}

// Preview-workspace status feedback for Design-mode runs. This exposure is
// intentionally separate from `run_finished`: that event records the daemon
// outcome, while this one measures whether the user actually saw the delivery
// confirmation or recovery path.
export interface PreviewRunStatusSurfaceViewProps {
  page_name: 'file_manager';
  area: 'preview_run_status';
  element: 'run_status_bar';
  status: 'generating' | 'verifying' | 'succeeded' | 'failed';
  delivery_state?: 'delivered' | 'no_result' | 'delivery_failed';
  project_id: string;
  conversation_id: string | null;
  assistant_message_id: string;
  run_id?: string;
}

export interface AssistantFeedbackReasonPanelSurfaceViewProps {
  page_name: 'chat_panel';
  area: 'chat_panel';
  element: 'assistant_feedback_reason_panel';
  view_type: 'panel';
  project_id: string;
  project_kind: TrackingProjectKind | null;
  conversation_id: string | null;
  assistant_message_id: string;
  run_id: string;
  rating: 'positive' | 'negative';
}

// Exposure of an inline discovery form — fires once per form occurrence when
// a parseable form first becomes visible in its originating assistant message.
// Denominator for the questions_form click events above.
export interface QuestionsFormSurfaceViewProps {
  page_name: 'chat_panel';
  area: 'questions_form';
  project_id: string;
  form_id?: string;
}

// Packaged updater UI surfaces. The download pipeline is intentionally
// silent; these fire only when a verified update is installable and when the
// user opens the final confirmation prompt.
export interface UpdateIndicatorSurfaceViewProps {
  page_name: 'home';
  area: 'update_indicator';
  app_version_before?: string;
  app_version_after?: string;
}

export interface UpdatePromptSurfaceViewProps {
  page_name: 'home' | 'app';
  area: 'update_prompt' | 'update_dialog';
  app_version_before?: string;
  app_version_after?: string;
}

// Post-update "what's new" card on the home surface; fires once per version
// when the card becomes visible after an update.
export interface WhatsNewPopupSurfaceViewProps {
  page_name: 'home';
  area: 'whats_new_popup';
  app_version: string;
  /** True when release-configured highlights were shown, false for the generic fallback copy. */
  has_release_notes: boolean;
}

// Impression of the HTML file version history modal. Fires once per open so
// the versions funnel has a denominator (toolbar clicks → exposures →
// version_item browsing → restore result). `entry_from` mirrors the opening
// toolbar click's dimension.
export interface FileVersionModalSurfaceViewProps {
  page_name: 'artifact';
  area: 'file_version_modal';
  entry_from: 'toolbar' | 'more_menu';
  artifact_id: string;
  artifact_kind: TrackingArtifactKind;
  project_id: string;
  project_kind: TrackingProjectKind;
}

export interface ShareGuideSurfaceViewProps {
  page_name: 'artifact';
  area: 'share_guide';
  project_id: string;
  project_kind: TrackingProjectKind | null;
  artifact_id: string;
}

export type SurfaceViewProps =
  ShareGuideSurfaceViewProps | WorkspaceSurfaceViewProps | RunFailedToastSurfaceViewProps | RunRecoveryActionSurfaceViewProps | RunStartBlockedSurfaceViewProps | PreviewRunStatusSurfaceViewProps | HelpPopoverSurfaceViewProps | SettingsPopoverSurfaceViewProps | NewProjectModalSurfaceViewProps | PluginReplacementModalSurfaceViewProps | PluginDetailModalSurfaceViewProps | PluginImportModalSurfaceViewProps | ProjectReferenceModalSurfaceViewProps | AssistantFeedbackReasonPanelSurfaceViewProps | QuestionsFormSurfaceViewProps | UpdateIndicatorSurfaceViewProps | UpdatePromptSurfaceViewProps | WhatsNewPopupSurfaceViewProps | FileVersionModalSurfaceViewProps;
