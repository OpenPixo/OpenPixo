/**
 * @module analytics/events/shared-enums
 * Shared tracking enums and value unions used across analytics events.
 */
// ---- Shared enums --------------------------------------------------------

export type TrackingProjectKind =
  'prototype' | 'web_clone' | 'wireframe' | 'mobile' | 'live_artifact' | 'slide_deck' | 'template' | 'document' | 'image' | 'video' | 'hyperframes' | 'audio' | 'brand' | 'orbit' | 'other';

// Where a project originated. Matches CSV row 9 / row 17 enum.
export type TrackingProjectSource =
  | 'create_button'
  | 'open_folder'
  | 'template'
  | 'chat_composer'
  | 'unknown';

export type TrackingFidelity =
  | 'wireframe'
  | 'high_fidelity'
  | 'not_applicable';

export type TrackingExecutionMode = 'local_cli' | 'byok';

export type TrackingByokPreflightBlockReason =
  | 'api_key_required'
  | 'api_key_invalid'
  | 'base_url_required'
  | 'base_url_invalid'
  | 'model_required'
  | 'model_default'
  | 'multiple'
  | 'config_invalid';

// v2 BYOK provider catalogue (CSV row 65). Replaces v1's
// `anthropic|openai|azure|ollama|google`. `senseaudio` was added on
// `main` after the v2 doc was published; we forward it verbatim so
// dashboards can split it out even though the product CSV does not yet
// list it.
export type TrackingByokProviderId =
  | 'anthropic'
  | 'openai'
  | 'azure_openai'
  | 'google_gemini'
  | 'ollama_cloud'
  | 'senseaudio'
  | 'aihubmix';

// Productized CLI runtimes. Retired and unknown saved ids map to `other`.
export type TrackingCliProviderId =
  | 'claude_code'
  | 'codex_cli'
  | 'opencode'
  | 'byok_opencode'
  | 'openpixo_agent'
  | 'other';

export type TrackingFeedbackProviderId =
  | TrackingCliProviderId
  | TrackingByokProviderId;

export type TrackingArtifactKind =
  | 'html'
  | 'markdown'
  | 'image'
  | 'video'
  | 'audio'
  | 'doc'
  | 'unknown';

// NOTE: vercel / cloudflare_pages are intentionally NOT here. Deploy attempts
// used to ride artifact_export_result with those formats, but that only ever
// meant "deploy popover opened", never a real publish. Real deploys are now
// tracked exclusively by artifact_deploy_result (see TrackingDeployProvider).
export type TrackingExportFormat =
  | 'pdf'
  | 'pptx'
  | 'zip'
  | 'html'
  | 'image'
  | 'markdown'
  | 'template'
  | 'share_link'
  | 'share_page'
  | 'playable_game';

export type TrackingResult = 'success' | 'failed';
export type TrackingRunResult = 'success' | 'failed' | 'cancelled';
export type TrackingRunCancelOrigin =
  | 'user_stop'
  | 'project_cleanup'
  | 'daemon_shutdown'
  | 'unknown';
export type TrackingRunTerminalTrigger =
  | TrackingRunCancelOrigin
  | 'first_output_deadline'
  | 'inactivity_watchdog'
  | 'daemon_restart';
export type TrackingExportResult = 'success' | 'failed' | 'cancelled';
// Stable codes for artifact_publish_result.error_code. Deliberately a CLOSED
// set — unlike artifact_deploy_result's open-ended provider/HTTP codes — so no
// free-form message text can ever be passed as an analytics error code.
export type TrackingTestResult = 'success' | 'failed' | 'timeout';
export type TrackingRunFailureCategory =
  | 'auth'
  | 'rate_limit'
  | 'insufficient_balance'
  | 'entitlement_required'
  | 'model_unavailable'
  | 'prompt_too_large'
  | 'upstream_unavailable'
  | 'timeout'
  | 'empty_output'
  | 'tool_error'
  | 'process_exit'
  | 'user_cancel'
  | 'unknown';
export type TrackingRunFailureDetail =
  | 'auth_required'
  | 'stale_profile'
  | 'refresh_token_reused'
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'hard_quota'
  // A rolling per-model usage window (`model_limit_exceeded`)
  // that resets on its own at a known instant. Distinct from `hard_quota`:
  // nothing was charged, nothing needs topping up, and the same request
  // succeeds once the window rolls over — so it stays retryable and must not
  // be counted as a quota exhaustion in reliability reporting.
  | 'model_window_limit'
  | 'rate_limit_429'
  | 'model_not_found'
  | 'model_not_supported'
  | 'model_disabled'
  | 'local_model_not_loaded'
  | 'cli_version_incompatible'
  | 'prompt_too_large'
  | 'request_too_large'
  | 'attachment_media_type_unsupported'
  | 'tool_schema_invalid'
  | 'prompt_tokenization_failed'
  | 'provider_resource_not_found'
  | 'upstream_5xx'
  | 'upstream_client_error'
  /** The provider refused the request built from this conversation and gave no reason (a bare 400). */
  | 'request_rejected'
  | 'region_not_supported'
  | 'stream_disconnected'
  | 'network_error'
  | 'provider_high_demand'
  | 'provider_routing_error'
  | 'inactivity_timeout'
  | 'timeout'
  | 'empty_output'
  | 'tool_error'
  | 'plugin_artifact_missing'
  | 'cli_not_installed'
  | 'bundled_binary_missing'
  | 'host_policy_block'
  | 'local_storage_failure'
  | 'certificate_failure'
  | 'proxy_configuration'
  | 'network_configuration'
  | 'git_bash_missing'
  | 'agent_config_invalid'
  | 'spawn_failed'
  | 'spawn_enoexec'
  | 'spawn_ebadf'
  | 'spawn_eperm'
  | 'stdin_write_eof'
  | 'agent_protocol_error'
  | 'session_resume_expired'
  // Two local processes raced to refresh the same stored OAuth credential and
  // one lost the lock (Claude Code: "another Claude Code process is refreshing
  // it or exited mid-refresh"). The credential itself is valid — nothing is
  // expired, revoked or misconfigured — so this must not land in `auth`, whose
  // verdict prescribes a sign-in the user does not need. The contending holder
  // releases the lock within seconds, which is why the agent itself calls the
  // condition transient; named here so it stays retryable rather than falling
  // through to an opaque exit.
  | 'credential_refresh_contention'
  | 'fabricated_role_marker'
  | 'permission_request_not_found'
  | 'signal_killed'
  | 'process_crashed'
  | 'cpu_unsupported'
  // The bundled Bun-compiled runtime cannot load on this OS version (Windows
  // builds older than 10 1809 exit with STATUS_ENTRYPOINT_NOT_FOUND before
  // readiness). Deterministic, so never retried.
  | 'os_unsupported'
  // Provider risk control suspended the account; retrying cannot resolve it.
  | 'account_suspended'
  | 'interrupted'
  | 'exit_code'
  | 'terminated_unknown'
  | 'stream_error'
  | 'exit_nonzero'
  | 'fatal_rpc_error'
  | 'continuation_incomplete'
  | 'execution_failed'
  | 'user_cancelled'
  | 'unknown';
export type TrackingRunFailureStage =
  | 'preflight'
  | 'spawn'
  | 'session_init'
  | 'model_select'
  | 'prompt_send'
  | 'first_token_wait'
  | 'tool_execution'
  | 'tool_outstanding'
  | 'post_tool_resume'
  | 'artifact_write'
  | 'child_close'
  | 'finalize';
export type TrackingRunFailureMechanism =
  | 'policy_rejection'
  | 'provider_rejection'
  | 'model_route_unavailable'
  | 'invalid_model_selection'
  | 'protocol_violation'
  | 'frame_too_large'
  | 'startup_readiness_timeout'
  | 'first_output_deadline'
  | 'post_tool_resume_timeout'
  | 'tool_execution_failure'
  | 'child_exit'
  | 'stream_idle_timeout'
  | 'empty_completion'
  | 'transport_failure'
  | 'unknown';
export type TrackingRunFailureDomain =
  | 'client_product'
  | 'client_environment'
  | 'provider_control_plane'
  | 'policy_admission'
  | 'cross_boundary'
  | 'unknown';
export type TrackingRunEvidenceLevel =
  | 'structured_error'
  | 'structured_code'
  | 'protocol_error'
  | 'lifecycle_signal'
  | 'stderr_fallback'
  | 'close_reason'
  | 'legacy_text'
  | 'unknown';
export type TrackingRunRepairOwner =
  | 'openpixo'
  | 'client_environment'
  | 'provider_owner'
  | 'policy_owner'
  | 'shared_boundary'
  | 'unknown';
/** v3 describes the terminal attempt; absent evidence remains unknown. */
export type TrackingRunAdmissionPhase = 'before_execution' | 'during_execution' | 'unknown';
/** `none` means no affirmative policy evidence, not proof that no policy applied. */
export type TrackingRunPolicyReason =
  | 'model_window_limit'
  | 'hard_quota'
  | 'entitlement_required'
  | 'none';
/** v2 values were defaults, not phase evidence. Use admission_phase on v3. */
export type TrackingRunAdmissionStatus =
  | 'admitted'
  | 'rejected_policy'
  | 'unknown';
export type TrackingRunTerminalIntegrity =
  | 'canonical'
  | 'duplicate'
  | 'late'
  | 'reconciled'
  | 'overwritten'
  | 'permanently_missing'
  | 'post_terminal_activity';
export type TrackingRunTerminationOrigin =
  | 'user_cancel'
  | 'project_cleanup'
  | 'watchdog_cleanup'
  | 'daemon_quit'
  | 'update_apply'
  | 'unknown';
export type TrackingRunTerminalPersistenceStatus =
  | 'acknowledged'
  | 'failed'
  | 'unknown';
export type TrackingRunTerminalPersistenceErrorType =
  | 'permission_denied'
  | 'read_only_storage'
  | 'storage_full'
  | 'storage_unavailable'
  | 'serialization_failed'
  | 'unknown';
export type TrackingRunPosthogDeliveryStatus =
  | 'unknown'
  | 'in_flight'
  | 'queued'
  | 'not_expected'
  | 'failed';
export type TrackingRunPosthogAcknowledgement =
  | 'unknown'
  | 'local_buffer'
  | 'none';
export type TrackingRunPosthogErrorType =
  | 'not_configured'
  | 'metrics_consent_disabled'
  | 'config_read_failed'
  | 'enqueue_failed';
export type TrackingRunMatureUnfinishedState =
  | 'still_running'
  | 'terminated_persistence_missing'
  | 'terminal_persisted_posthog_failed'
  | 'recovery_pending'
  | 'permanently_missing'
  | 'unknown';
export type TrackingRunReconciliationIntegrity = 'recovered';
export type TrackingRunLifecyclePhase =
  | 'queued'
  | 'prompt_build'
  | 'launch_preflight'
  | 'process_spawn'
  | 'stdin_write'
  | 'runtime_init'
  | 'first_token_wait'
  | 'stream_output'
  | 'tool_execution'
  | 'artifact_write'
  | 'finalize'
  | 'complete'
  | 'unknown';
export type TrackingRunPhaseTimingStatus =
  | 'complete'
  | 'partial'
  | 'missing';
export type TrackingArtifactWriteStatus =
  | 'none'
  | 'started'
  | 'completed'
  | 'failed';
export type TrackingArtifactWriteSource =
  'write_tool' | 'live_artifact' | 'artifact_event' | 'unknown';
export type TrackingFirstModelEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_use'
  | 'artifact';
export type TrackingRunFailureUserAction =
  | 'retry'
  | 'login'
  | 'recharge'
  | 'upgrade'
  | 'switch_model'
  | 'reduce_context'
  | 'install_cli'
  | 'fix_config'
  | 'none';
export type TrackingRunRetryStrategy =
  | 'same_run_transient'
  | 'native_session_continue';
export type TrackingRunRetryFinalResult =
  | 'not_attempted'
  | 'success'
  | 'failed'
  | 'suppressed';
export type TrackingRunRetrySuppressedReason =
  | 'not_failed'
  | 'not_retryable'
  | 'unsupported_category'
  | 'non_retryable_category'
  | 'unsafe_failure_stage'
  | 'missing_failure_signal'
  | 'hard_quota'
  | 'attempt_limit_reached'
  | 'cancel_requested'
  | 'user_visible_output_seen'
  | 'tool_call_seen'
  | 'artifact_write_seen'
  | 'live_artifact_seen';
export type TrackingRunDiagnosticSource =
  | 'error_event'
  | 'stderr'
  | 'exit_code'
  | 'signal'
  | 'unknown';
export type TrackingStderrLineCountBucket =
  | 'none'
  | '1_5'
  | '6_20'
  | '21_100'
  | 'gt_100';
export type TrackingRunCloseReason =
  | 'exit_0'
  | 'exit_nonzero'
  | 'signal'
  | 'cancel_requested'
  | 'stream_error'
  | 'fatal_rpc_error'
  | 'empty_output'
  | 'unknown';

export type TrackingFeedbackRating = 'positive' | 'negative';
// Click events emit `none` when the user clears a previously-set rating, so
// `rating` (post-state) and `rating_before` (pre-state) on click both use
// this widened union. Reason events still require a concrete rating.
export type TrackingFeedbackRatingWithNone = 'positive' | 'negative' | 'none';
export type TrackingFeedbackAction =
  | 'submit_feedback_rating'
  | 'clear_feedback_rating';

// Mirrors ChatMessageFeedbackReasonCode in packages/contracts/src/api/chat.ts.
// Kept independent so the analytics wire format can evolve without forcing
// a contract bump on the chat persistence shape.
export type TrackingFeedbackReasonCode =
  'matched_request' | 'strong_visual' | 'useful_structure' | 'easy_to_continue' | 'missed_request' | 'weak_visual' | 'could_not_run' | 'too_slow' | 'incomplete_output' | 'hard_to_use' | 'other';

// Product confirmed on 2026-05-13: custom_reason ships the raw text so
// analysts can read the actual feedback. The earlier length-bucket approach
// from the tracking doc draft is no longer in effect.

export type TrackingTokenCountSource =
  | 'provider_usage'
  | 'estimated'
  | 'unknown';

export type TrackingFileType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'zip'
  | 'folder'
  | 'other';

export type TrackingFileSizeBucket =
  | '0_1mb'
  | '1_10mb'
  | '10_100mb'
  | '100mb_plus';

/**
 * A Labs experiment. Carried as a property so the toggle event stays generic:
 * a second experiment adds one member here and reuses the same event.
 */
export type TrackingLabsItemId = 'design_harness';

/** Who moved a Labs switch. `system` is not a user action — see `TrackingLabsSystemReason`. */
export type TrackingLabsToggleSource = 'settings' | 'cli' | 'system';

/**
 * Why the system moved a Labs switch on the user's behalf. Kept separate from
 * the opt-out reasons so "the user turned this off" and "we turned it off for
 * them" can never be summed together by accident.
 */
export type TrackingLabsSystemReason = 'env_override' | 'latched' | 'restored';

/**
 * Why a user turned a Labs experiment off.
 *
 * `skipped` is not a reason — it is the absence of one, recorded so the share
 * of people who declined to answer is visible instead of missing. A timeout and
 * an explicit "skip" record the same value on purpose.
 */
export type TrackingLabsOptOutReason =
  | 'worse_output'
  | 'too_slow'
  | 'not_what_i_wanted'
  | 'other'
  | 'skipped';
