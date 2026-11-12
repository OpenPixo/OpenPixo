/**
 * @module analytics/events/onboarding
 * Onboarding analytics event prop types.
 */
import type { TrackingRuntimeType } from '../public-params.js';
import type { TrackingCliProviderId } from './shared-enums.js';
// ---- page_view ------------------------------------------------------------

// `source` is supplied only by the chat_panel page_view (CSV row 41), where
// it records which surface launched the studio.
export type TrackingChatPanelPageViewSource =
  | 'new_project'
  | 'chat_composer'
  | 'recent_project'
  | 'projects_list'
  | 'template'
  | 'automation'
  | 'deeplink'
  | 'reload'
  | 'unknown';

// --- Onboarding page_view (welcome flow) ---
//
// Runtime setup exposure shares a session id across setup and CLI scanning.
export type TrackingOnboardingArea =
  'runtime' | 'model_source' | 'runtime_setup';

export type TrackingOnboardingStepIndex = '1' | '2' | '3';

export type TrackingOnboardingStepName =
  'connect' | 'model_source' | 'runtime_setup';

// How the user chose to connect to a model provider:
// a local coding agent or a user-supplied model key. `none` stamps click
// events fired before any runtime was picked.
// Onboarding's runtime pick is the same closed set as the global
// `runtime_type` public param; alias to the single source of truth so the
// two never drift.
export type TrackingOnboardingRuntimeType = TrackingRuntimeType;

// `completed`: user finished runtime setup.
// `cancelled`: user closed the onboarding tab / navigated away without
// finishing. `failed`: terminal error before completion.
// `skipped`: DEPRECATED — the onboarding "Skip for now" affordance was
// removed (Connect is now a required gate), so this is no longer emitted.
// Kept in the union for historical data / dashboard compatibility.
export type TrackingOnboardingCompletionResult =
  | 'completed'
  /** @deprecated no longer emitted — Skip was removed from onboarding. */
  | 'skipped'
  | 'cancelled'
  | 'failed';

export type TrackingOnboardingCompletionType =
  'completed_without_design_system' | 'skipped';

// CLI scan terminal state. `success`: at least one CLI was detected;
// `failed`: scan errored or detected nothing; `timeout`: scan didn't
// settle inside the budget. Daemon doesn't currently surface timeouts
// for this scan; left in the type so a future watchdog can use it
// without a contract change.
export type TrackingOnboardingScanResult = 'success' | 'failed' | 'timeout';

export interface OnboardingPageViewProps {
  page_name: 'onboarding';
  area: TrackingOnboardingArea;
  step_index: TrackingOnboardingStepIndex;
  step_name: TrackingOnboardingStepName;
  onboarding_session_id: string;
}

// ---- Onboarding ui_click ------------------------------------------------
//
// Runtime setup click targets.
export type TrackingOnboardingClickElement =
  // Runtime / connect step
  | 'local_coding_agent'
  | 'byok'
  // Action buttons
  | 'continue'
  // Finished setup without the optional connection check.
  | 'continue_unverified'
  | 'back'
  /** @deprecated no longer emitted — Skip was removed from onboarding. */
  | 'skip';

export type TrackingOnboardingClickAction =
  | 'select_runtime'
  | 'continue'
  | 'back'
  /** @deprecated no longer emitted — Skip was removed from onboarding. */
  | 'skip';

// Runtime selection adds only bounded runtime metadata to the setup context.
export interface OnboardingClickProps {
  page_name: 'onboarding';
  area: TrackingOnboardingArea;
  element: TrackingOnboardingClickElement;
  action: TrackingOnboardingClickAction;
  step_index: TrackingOnboardingStepIndex;
  step_name: TrackingOnboardingStepName;
  onboarding_session_id: string;
  runtime_type?: TrackingOnboardingRuntimeType;
  is_recommended?: boolean;
}

// ---- Onboarding lifecycle result events ---------------------------------

export interface OnboardingRuntimeScanResultProps {
  page_name: 'onboarding';
  area: 'runtime';
  runtime_type: 'local_cli';
  result: TrackingOnboardingScanResult;
  detected_cli_count: number;
  available_cli_count: number;
  selected_cli_id?: TrackingCliProviderId;
  error_code?: string;
  duration_ms: number;
  onboarding_session_id: string;
}

export interface OnboardingCompleteResultProps {
  page_name: 'onboarding';
  area: 'onboarding';
  result: TrackingOnboardingCompletionResult;
  exit_step_name: TrackingOnboardingStepName;
  completion_type: TrackingOnboardingCompletionType;
  runtime_type: TrackingOnboardingRuntimeType;
  has_about_you: boolean;
  has_design_system_request: boolean;
  source_count: number;
  error_code?: string;
  duration_ms: number;
  onboarding_session_id: string;
}
