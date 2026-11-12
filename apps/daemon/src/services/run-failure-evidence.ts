import type {
  TrackingRunAdmissionPhase,
  TrackingRunPolicyReason,
} from '@openpixo/contracts/analytics';
import type {
  RunEventForFailureClassification,
  RunFailureClassification,
  RunFailureClassificationInput,
} from '../run-failure-classification.js';

const POLICY_REASONS = new Set<TrackingRunPolicyReason>([
  'model_window_limit', 'hard_quota',

   'entitlement_required',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Evidence is terminal-attempt scoped by the caller, never run-level usage. */
function admissionPhase(
  input: RunFailureClassificationInput,
  events: RunEventForFailureClassification[],
): TrackingRunAdmissionPhase {
  if (input.admissionEvidence) {
    if (input.admissionEvidence.executionEvidenceSeen) return 'during_execution';
    return 'unknown';
  }
  const startEvent = events.find((event) => event.event === 'start');
  if (!startEvent) return 'unknown';
  for (const event of events) {
    if (event.event === 'error' || event.event === 'end') break;
    const data = record(event.data);
    if (data.hostSynthesized === true) continue;
    if (event.event === 'stdout') {
      if (typeof data.chunk === 'string' && data.chunk.length > 0) {
        return 'during_execution';
      }
      continue;
    }
    if (event.event !== 'agent') continue;
    if (data.type === 'error') break;
    if ((data.type === 'text_delta' || data.type === 'thinking_delta')
      && typeof data.delta === 'string' && data.delta.trim().length > 0) {
      return 'during_execution';
    }
    if (data.type === 'artifact') return 'during_execution';
    if (data.type === 'tool_use') return 'during_execution';
  }
  return 'unknown';
}

/** Add causal fields without changing legacy categories, actions or retries. */
export function runFailureEvidence(
  input: RunFailureClassificationInput,
  failure: RunFailureClassification,
  events: RunEventForFailureClassification[],
): Partial<RunFailureClassification> {
  const code = input.errorCode ?? input.status.errorCode;
  // A structured final provider verdict outranks incidental policy strings
  // from earlier status/errors. Keep legacy classification untouched.
  const providerVerdict = (code === 'UPSTREAM_UNAVAILABLE' || code === 'AGENT_CONNECTION_DROPPED')
    && failure.failure_mechanism === 'policy_rejection';
  const policyReason: TrackingRunPolicyReason = !providerVerdict && POLICY_REASONS.has(failure.failure_detail as TrackingRunPolicyReason)
    ? failure.failure_detail as TrackingRunPolicyReason
    : !providerVerdict && failure.failure_category === 'entitlement_required'
      ? 'entitlement_required' : 'none';
  const phase = admissionPhase(input, events);
  const common: Partial<RunFailureClassification> = {
    classifier_version: 'run-failure-v3',
    policy_reason: policyReason,
    admission_phase: phase,
    admission_status: phase === 'during_execution' ? 'admitted'
      : phase === 'before_execution' && policyReason !== 'none' ? 'rejected_policy' : 'unknown',
  };
  if (providerVerdict) {
    return { ...common, failure_mechanism: 'provider_rejection', failure_domain: 'provider_control_plane',
      repair_owner: 'provider_owner', evidence_level: 'structured_code' };
  }
  if (failure.failure_category === 'model_unavailable'
    && ['model_not_found', 'model_not_supported', 'provider_routing_error'].includes(failure.failure_detail)) {
    const mismatch = false;
    return { ...common,
      failure_mechanism: mismatch ? 'invalid_model_selection' : 'model_route_unavailable',
      failure_domain: mismatch ? 'client_product' : 'cross_boundary',
      repair_owner: mismatch ? 'openpixo' : 'shared_boundary',
      ...(mismatch ? { evidence_level: 'structured_error' as const } : {}),
    };
  }
  return common;
}
