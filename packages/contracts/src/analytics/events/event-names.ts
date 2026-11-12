/**
 * @module analytics/events/event-names
 * Analytics event-name and page-name string-literal unions.
 */
// ---- Event names ---------------------------------------------------------

import type { ClientMetricEventName } from '../client-metrics.js';

export type AnalyticsEventName =
  ClientMetricEventName | 'page_view' | 'ui_click' | 'surface_view' | 'project_create_result' | 'plugin_replacement_result' | 'plugin_import_result' | 'run_created' | 'run_finished' | 'run_retry_attempted' | 'run_retry_finished' | 'mcp_session_initialized' | 'mcp_tool_started' | 'mcp_tool_finished' | 'media_generation_result' | 'chat_artifact_capture_result' | 'update_install_result' | 'update_check_result' | 'update_apply_observed' | 'update_lifecycle_observed' | 'client_update_stage_result' | 'packaged_runtime_failed' | 'file_upload_result' | 'context_link_result' | 'artifact_export_result' | 'file_version_restore_result' | 'workspace_project_action_result' | 'workspace_resource_action_result' | 'conversation_fork_result' | 'feedback_submit_result' | 'assistant_feedback_click' | 'assistant_feedback_reason_view' | 'assistant_feedback_reason_click' | 'assistant_feedback_reason_submit' | 'settings_view' | 'labs_item_toggled' | 'settings_cli_test_result' | 'settings_byok_test_result' | 'settings_byok_models_fetch_result' | 'byok_preflight_blocked' | 'agent_detect_diagnostic' | 'onboarding_runtime_scan_result' | 'onboarding_complete_result';

// ---- Pages ---------------------------------------------------------------

export type TrackingPageName =
  'home' | 'community' | 'drafts' | 'all_projects' | 'projects' | 'automations' | 'plugins' | 'integrations' | 'chat_panel' | 'file_manager' | 'artifact' | 'onboarding' | 'studio' | 'settings';

// Alias kept for backwards-compatibility inside the contracts file; v2 wire
// format uses the field name `page_name` for settings events too.
export type TrackingSettingsPage = 'settings';
