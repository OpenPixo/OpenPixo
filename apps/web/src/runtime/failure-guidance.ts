// Shared logic that maps a failed run's error code + agent into the failure
// UI: which contextual button the gray error card shows and its explanation. Kept in
// its own module so ChatPane / ProjectView / AssistantMessage can import it
// without a circular dependency.
import {
  isModelWindowLimitFailure,
  readModelWindowResetAt,
} from '@openpixo/contracts';
import type { RunFailureAction } from '@openpixo/contracts';
import { byokApiKeyIsEditableInSettings } from '../utils/byokProvider';

export type RunFailurePrimaryAction =
  | 'retry'
  | 'switch-model'
  | 'open-settings'
  | 'contact-support';

// i18n keys for the gray-card text override (null = show the raw error).
// Keys ending in a value with `{agent}` are interpolated at render time via
// t(key, { agent }) (see ChatPane displayError).
export type RunFailureMessageKey =
  | 'chat.connectionDropped'
  | 'chat.runError.signInMessage.other'
  | 'chat.runError.cliMissingMessage'
  | 'chat.runError.byokOpencodeUnavailableMessage'
  | 'chat.runError.byokCodexUnavailableMessage'
  | 'chat.runError.promptTooLargeMessage'
  | 'chat.runError.requestRejectedMessage'
  | 'chat.runError.modelUnavailableMessage'
  | 'chat.runError.modelCapabilityUnsupportedMessage'
  | 'chat.runError.artifactMissingMessage'
  | 'chat.runError.rateLimitedMessage'
  | 'chat.runError.modelWindowLimitMessage'
  | 'chat.runError.modelWindowLimitMessageNoTime'
  | 'chat.runError.upstreamUnavailableMessage'
  | 'chat.runError.toolLoopMessage'
  | 'chat.runError.outputInvalidMessage'
  | 'chat.runError.runtimeConfigMessage'
  | 'chat.runError.apiKeyInvalidMessage'
  | 'chat.runError.quotaExhaustedMessage'
  | 'chat.runError.outOfCreditsMessage'
  | 'chat.runError.hostedAgentUnavailableMessage'
  | 'chat.runError.timedOutMessage'
  | 'chat.runError.inactivityTimeoutMessage'
  | 'chat.runError.emptyOutputMessage'
  | 'chat.runError.sessionExpiredMessage'
  | 'chat.runError.gitBashMissingMessage'
  | 'chat.runError.cpuUnsupportedMessage'
  | 'chat.runError.osUnsupportedMessage'
  | 'chat.runError.agentCrashedMessage'
  | 'chat.runError.accountSuspendedMessage'
  | 'chat.runError.certificateFailureMessage'
  | 'chat.runError.proxyConfigurationMessage'
  | 'chat.runError.networkConfigurationMessage'
  | 'chat.runError.hostPolicyBlockMessage'
  | 'chat.runError.localStorageFailureMessage'
  | 'chat.runError.tierUpgradeRequiredMessage'
  | 'chat.runError.fallbackMessage'
  | 'chat.runError.agentReplyIncompleteMessage'
  | 'chat.runError.noDeliverableMessage'
  | 'chat.runError.clarificationRepeatedMessage'
  | 'chat.runError.regionNotSupportedMessage'
  | 'chat.runError.clientEnvironmentMessage'
  | null;

/**
 * The `{cause}` half of S30's sentence — the parenthesis the design writes as
 * 「{地区不支持 / 证书校验失败}」, i.e. a slot, not a fixed phrase.
 *
 * It is a KEY rather than a string because this module has no `t`: the card
 * resolves it at render time next to `{agent}` (see ChatPane's
 * `runFailureMessageVars`). Keeping the five causes in one sentence — instead
 * of five near-identical sentences — is also what keeps the copy honest across
 * en/zh-CN: only the noun changes.
 */
export type RunFailureCauseKey =
  | 'chat.runError.clientEnvironmentCause.certificate'
  | 'chat.runError.clientEnvironmentCause.proxy'
  | 'chat.runError.clientEnvironmentCause.network'
  | 'chat.runError.clientEnvironmentCause.hostPolicy'
  | 'chat.runError.clientEnvironmentCause.localStorage';

/**
 * The one sentence a failure card falls back to when its mapping carries no
 * copy of its own.
 *
 * Before this existed the card rendered `rawError` — the upstream string, in
 * English, sometimes a slab of stderr — straight onto the card face, which is
 * design principle 5 ("say it in plain words") inverted. The raw text is still
 * reachable, just not on the card: it is persisted on the assistant message's
 * error event and travels out through 〔Export logs〕 (`/api/diagnostics/export`),
 * which is where the engineering-facing copy belongs. (The card's own
 * collapsible diagnostic area was removed on 2026-08-27.)
 */
export const RUN_FAILURE_FALLBACK_MESSAGE_KEY =
  'chat.runError.fallbackMessage' as const;

/** What the failure card's description slot renders. */
export type RunErrorCardDescription =
  /** No card — another surface already owns this story. */
  | { render: 'none' }
  /** This failure's own mapped copy (interpolated by the caller). */
  | { render: 'mapped'; messageKey: NonNullable<RunFailureMessageKey> }
  /** RUN_FAILURE_FALLBACK_MESSAGE_KEY — nothing we can say more precisely. */
  | { render: 'fallback' }
  /** Copy this app wrote into the shared pane slot; safe to render verbatim. */
  | { render: 'app-text'; text: string };

/**
 * What the failure card says, decided by the PROVENANCE of the text rather than
 * by which branch of the ladder the failure fell through.
 *
 * **Invariant: the card face only ever renders words this app wrote.** Anything
 * that came back from a run — the daemon's `message`, the agent's stderr, an
 * ACP JSON-RPC envelope — resolves to `{ render: 'fallback' }`, no matter how
 * it reached the card.
 *
 * This is deliberately NOT "hide the failure". The product principle is that
 * the UI shows the agent's behavior as it actually is: the card still appears,
 * still names the failure type, still carries 〔Contact support〕〔Export logs〕
 * and whatever recovery action the rung provides. What is withheld is the
 * TRANSPORT ENVELOPE — event ids, `sessionID`, `properties`, local ports and
 * filesystem paths — which describes our plumbing, not the user's task. The raw
 * text is not deleted either: it stays on the assistant message's persisted
 * error event and leaves through the diagnostics export.
 *
 * Why provenance and not a branch guard: the previous shape ended in a bare
 * `: rawError` tail, reached whenever the two guards in front of it did not
 * both hold. Every failure the mapping table does not claim — and there are
 * dozens — was one guard away from spilling. A lookup table can always be one
 * row short; this predicate cannot.
 *
 * The pane slot (`error`) is shared, which is why it needs a provenance flag of
 * its own: `setError(...)` fills it with copy this app wrote (a conversation
 * that would not load), while `setRunError(message, assistantId)` fills it with
 * a run's raw message. Only the former may be rendered verbatim, and the caller
 * distinguishes them by whether a source assistant id came with it.
 */
export function resolveRunErrorCardDescription(input: {
  /** The failure is being told by some other surface (reconnect row, upgrade card). */
  handedToAnotherSurface: boolean;
  /** `runFailureUi.messageKey` — null when the mapping table has no copy for it. */
  mappedMessageKey: RunFailureMessageKey;
  /** The shared pane-level error slot. */
  paneError: string | null;
  /** True when the pane slot was filled by a run failure (`setRunError`), not by us. */
  paneErrorCameFromARun: boolean;
  /** The failed run's own upstream string, off its persisted error event. */
  failedRunRawDetail: string | null;
  /**
   * This turn really did end in a terminal, user-facing failure — a failed run
   * process, or a run whose result never got delivered — and no other surface
   * is announcing it.
   *
   * It is the answer to "is there something to be silent ABOUT", which is a
   * different question from every source above ("do we have words for it").
   * When it holds and the three sources are all empty, the card still has to
   * appear: it is the only thing on screen carrying 〔Retry〕〔Export logs〕
   * 〔Contact support〕, and dropping it drops the whole recovery surface with
   * the explanation. The shell header's "run failed" line is written on the
   * assumption that this card is below it saying why.
   */
  turnEndedInTerminalFailure: boolean;
}): RunErrorCardDescription {
  if (input.handedToAnotherSurface) return { render: 'none' };
  if (input.mappedMessageKey) {
    return { render: 'mapped', messageKey: input.mappedMessageKey };
  }
  // An empty pane slot is not a source — it used to SHADOW the run's own detail
  // (being the higher-priority source) and take the card down with it, which is
  // the same silence this function now refuses everywhere else. Only a slot
  // with words in it decides anything.
  if (input.paneError) {
    return input.paneErrorCameFromARun
      ? { render: 'fallback' }
      : { render: 'app-text', text: input.paneError };
  }
  // Nothing in the pane slot, so the only text left is the run's own — raw by
  // definition, whether or not a `runFailureUi` was resolved for it.
  if (input.failedRunRawDetail) return { render: 'fallback' };
  // Nothing to say, but something to say it ABOUT: a terminal failure always
  // gets a card, so the turn keeps its explanation and its way out. Ordered
  // last so every handoff and every more precise source still wins.
  return input.turnEndedInTerminalFailure
    ? { render: 'fallback' }
    : { render: 'none' };
}

// i18n keys for the unified error card's TITLE (the "error type" line above the
// detail message). Frontend-only mapping from error code → human-readable type;
// the daemon does not yet emit a type name (the raw status label is just the
// word "error"). A full backend type ⇄ frontend pairing is a later effort.
export type RunFailureTitleKey =
  | 'chat.runError.title.authRequired'
  | 'chat.runError.title.balance'
  | 'chat.runError.title.outOfCredits'
  | 'chat.runError.title.hostedAgentUnavailable'
  | 'chat.runError.title.connectionDropped'
  // 「尚未登录」有两个主语,所以是两个键 —— 一个键装不下两句话。
  // S02 本地 agent(点名是哪一个,`{agent}` 由报错卡渲染时填);
  // S04 OpenPixo 智能体(主语固定,卡内一键授权)。
  | 'chat.runError.title.signInRequired.other'
  | 'chat.runError.title.rateLimited'
  | 'chat.runError.title.modelWindowLimit'
  | 'chat.runError.title.membershipConcurrencyLimit'
  | 'chat.runError.title.cliMissing'
  | 'chat.runError.title.promptTooLarge'
  | 'chat.runError.title.requestRejected'
  | 'chat.runError.title.modelUnavailable'
  // S13 · 「模型能力不支持」—— 和上面那格**不是**同一句话。文档 S13 表里
  // 「模型不存在」与「模型能力不支持」分列两行,S07 的「模型不可用」又是第三行;
  // 三句话不能共用一个键,否则谁改都盖到别人头上。
  | 'chat.runError.title.modelCapabilityUnsupported'
  | 'chat.runError.title.upstreamUnavailable'
  | 'chat.runError.title.toolLoop'
  | 'chat.runError.title.outputInvalid'
  | 'chat.runError.title.runtimeConfig'
  | 'chat.runError.title.apiKeyInvalid'
  | 'chat.runError.title.quotaExhausted'
  | 'chat.runError.title.timedOut'
  | 'chat.runError.title.emptyOutput'
  | 'chat.runError.title.sessionExpired'
  | 'chat.runError.title.gitBashMissing'
  | 'chat.runError.title.artifactMissing'
  | 'chat.runError.title.cpuUnsupported'
  | 'chat.runError.title.osUnsupported'
  | 'chat.runError.title.agentCrashed'
  | 'chat.runError.title.accountSuspended'
  | 'chat.runError.title.agentReplyIncomplete'
  | 'chat.runError.title.noDeliverable'
  | 'chat.runError.title.clarificationRepeated'
  | 'chat.runError.title.regionNotSupported'
  | 'chat.runError.title.clientEnvironment'
  | 'chat.runError.title.certificateFailure'
  | 'chat.runError.title.proxyConfiguration'
  | 'chat.runError.title.networkConfiguration'
  | 'chat.runError.title.hostPolicyBlock'
  | 'chat.runError.title.localStorageFailure'
  | 'chat.runError.title.tierUpgradeRequired'
  | 'chat.runError.title.generic';

export interface RunFailureUi {
  primaryAction: RunFailurePrimaryAction;
  // Title shown above the detail message — names the failure type.
  titleKey: RunFailureTitleKey;
  // Override the gray error card's text (e.g. authentication gets a clearer
  // explanation than the raw upstream string).
  messageKey: RunFailureMessageKey;
  // Interpolation values for `messageKey`, for the cases whose copy names
  // something the daemon read off the failure (e.g. when a rolling model window
  // reopens). Absent for every message that is a fixed sentence.
  messageVars?: Record<string, string>;
  // A `{cause}` the copy names but that is itself localized, so it arrives as a
  // key and is translated next to `{agent}` at render time. Only S30 uses it.
  messageCauseKey?: RunFailureCauseKey;
  // Show a secondary plain "retry" button alongside the primary action (used
  // by the recharge case, where retry is manual after topping up).
  secondaryRetry: boolean;

  /**
   * Draw no error card. Existing run status and diagnostics remain intact.
   *
   * The browser↔daemon stream drop hands its card to the
   * reconnect line at the tail of the conversation, which already offers
   * the reconnect action.
   * Missing Git Bash also sets this flag by product decision: the existing
   * failed-run status remains, with no replacement card or installation UI.
   */
  suppressCard?: boolean;

  /**
   * Lead the card with 〔Open settings〕 and demote 〔Retry〕 to a secondary.
   *
   * The action row is otherwise fixed (OPEND-2807 / G16) and reads nothing from
   * `primaryAction`, so this is an explicit opt-in: a row that sets it changes
   * only its own card.
   */
  leadsWithSettings?: boolean;

  /**
   * Lead the card with 〔New conversation〕 and demote 〔Retry〕 to a secondary.
   * For failures the conversation itself causes: Retry sends the same
   * conversation again, so only a fresh one can get past them.
   */
  leadsWithNewConversation?: boolean;
}


/**
 * The browser↔daemon SSE stream ran out of reconnect budget.
 *
 * Duplicated from `providers/daemon.ts` rather than imported: that module
 * already imports this one, so the import would
 * close a cycle. `run-error-ladder.test.ts` pins the two copies equal, since a
 * silently drifting copy is the failure mode of writing it twice.
 */
export const RECONNECT_OWNED_FAILURE_CODE = 'DAEMON_STREAM_DISCONNECTED';
const RECONNECT_OWNED_FAILURE_MESSAGE =
  'daemon stream disconnected before run completed';

/**
 * Is this failure the one the reconnect line already speaks for?
 *
 * Reads the same code-or-message pair as `ProjectView`'s
 * `hasGenericDisconnectFailureEvent`: rows persisted before the structured code
 * existed carry only the sentence, and they have to be recognized too or the
 * duplicate card comes back for exactly the users with the longest history.
 *
 * Not the same thing as `AGENT_CONNECTION_DROPPED` (S11): that is the agent's
 * connection to the MODEL service, which the reconnect line knows nothing about
 * and cannot re-establish, so that failure keeps its card and its retry.
 */
export function isReconnectOwnedFailure(
  code: string | null | undefined,
  rawMessage?: string | null,
): boolean {
  if (code === RECONNECT_OWNED_FAILURE_CODE) return true;
  return typeof rawMessage === 'string'
    && rawMessage.trim() === RECONNECT_OWNED_FAILURE_MESSAGE;
}

/**
 * The two window-limit message keys, narrowed away from `RunFailureMessageKey`
 * (which includes `null` for the cases that keep the raw upstream string) so
 * callers can hand the result straight to `t()` without a non-null assertion.
 */
export type ModelWindowLimitMessageKey =
  | 'chat.runError.modelWindowLimitMessage'
  | 'chat.runError.modelWindowLimitMessageNoTime';

/**
 * The copy a rolling model-window rejection should render, or null when the
 * text is some other failure.
 *
 * Two surfaces need this and they arrive from opposite directions: the chat
 * card already knows the daemon's `model_window_limit` classification and only
 * wants the instant, while the Home composer fails before a run exists and has
 * nothing but the raw upstream sentence. Sharing one reader keeps them from
 * disagreeing about what counts as a window limit.
 */
export function modelWindowLimitCopy(
  rawMessage: string | null | undefined,
): { messageKey: ModelWindowLimitMessageKey; retryAt?: string } | null {
  if (!isModelWindowLimitFailure(rawMessage)) return null;
  const parsed = readModelWindowResetAt(rawMessage);
  // Shape-valid but not a real instant (`2026-13-45T…`) counts as unreadable,
  // so the message key and the variable can never disagree about whether a
  // time exists — the card would otherwise render "Invalid Date".
  const retryAt = parsed && Number.isFinite(Date.parse(parsed)) ? parsed : null;
  return retryAt
    ? { messageKey: 'chat.runError.modelWindowLimitMessage', retryAt }
    // Promising a time we could not read is worse than not naming one.
    : { messageKey: 'chat.runError.modelWindowLimitMessageNoTime' };
}

/**
 * The instant a model window reopens, rendered for a reader in `locale`.
 *
 * The gateway reports UTC; a user waiting on a clock needs their own. Date and
 * time are both shown because the wait can cross midnight, and the year is left
 * off because a rolling window never reaches one.
 *
 * Returns the input untouched if it cannot be formatted, so the copy degrades
 * to a machine-readable instant rather than to a gap.
 */
export function formatModelWindowRetryAt(retryAt: string, locale: string): string {
  const parsed = new Date(retryAt);
  if (!Number.isFinite(parsed.getTime())) return retryAt;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return retryAt;
  }
}

/**
 * The rung-1 actions: the things we can do FOR the user in one click.
 *
 * Narrowed out of `RunFailurePrimaryAction` so a mapping cannot accidentally
 * declare "we have a direct fix" and then name `retry` (rung 2) or
 * `contact-support` (rung 4) as that fix.
 */
export type RunFailureDirectFix = Extract<
  RunFailurePrimaryAction,
  | 'switch-model'
  | 'open-settings'
>;

/**
 * What KIND of failure this is — the only thing a mapping has to declare.
 *
 * Every field is a question about the failure itself, not about the button we
 * want. The button is derived (`primaryActionForFailure`), which is the whole
 * point: adding a new failure code means answering three questions, not picking
 * a CTA by hand and hoping it stays consistent with the sixteen picked before it.
 */
export interface RunFailureNature {
  /** Rung 1 — we have a one-click action that actually resolves this. */
  directFix?: RunFailureDirectFix;
  /** Rung 2 — running it again can plausibly succeed (possibly after the user does something). */
  transient?: boolean;

}

/**
 * The primary-button ladder (`docs/coordination/archive/run-error-catalog.md` §6.Z),
 * top-down; the first rung that matches wins.
 *
 *   1. We have an action that directly solves it   → that action
 *   2. The failure is transient                    → retry from where it failed
 *   4. None of the above                           → contact support (promoted
 *                                                     from the standing secondary)
 *
 *
 * Rung 4 is what makes design principle 4 hold structurally rather than by
 * vigilance: a failure that declares neither a direct fix nor transience can no
 * longer end up with a Retry button, because nothing in this function can
 * produce one.
 *
 * §6.T maps the rungs onto the F0–F10 flow table: rung 1 = F4/F5/F6/F7/F8,
 * rung 2 = F1/F2/F3/F9,
 * rung 4 = F10.
 */
export function primaryActionForFailure(
  nature: RunFailureNature,
): RunFailurePrimaryAction {
  if (nature.directFix) return nature.directFix;
  if (nature.transient) return 'retry';

  return 'contact-support';
}

/**
 * The daemon's own reading of a failed run: can it be re-run, and what should
 * the user do. Both are already computed at finalize time
 * (`apps/daemon/src/run-failure-classification.ts` → `retryable` /
 * `user_action`) and both are already on `GET /api/runs/:id`
 * (`ChatRunStatusResponse.failureAction`).
 *
 * ⚠️ They do NOT reach the card today. The chat reads its failure off the
 * persisted `status`/`error` event, and the streaming layer only stamps
 * `failureCategory` + `failureDetail` onto it. Carrying these two the same way
 * is a three-file change outside this module — the SSE `end` frame /
 * `PersistedAgentEvent` shape in contracts, `providers/daemon.ts`'s
 * `markErrorRunFailure`, and `runtime/chat-events.ts`'s
 * `appendErrorStatusEvent` — so this parameter is written to be inert until
 * they land, and correct the moment they do.
 */
export interface RunFailureDaemonVerdict {
  /** Daemon's `retryable`. */
  retryable?: boolean | null;
  /** Daemon's `user_action`, as published on the run-status response. */
  failureAction?: RunFailureAction | null;
}

/**
 * Did the daemon put a NAME on this failure?
 *
 * The two cases the fallback used to merge are separable in the data, and this
 * is the whole of the test: the classifier emits a specific `failure_detail`
 * when it recognised the cause, and the literal `'unknown'` when it did not
 * (the last `classification('unknown', 'unknown', …)` in
 * `run-failure-classification.ts`). An absent detail is an older daemon that
 * classified nothing at all, which is the same situation.
 *
 * What it does NOT settle is the button. Among the causes the daemon names but
 * this module has no row for there are both futile ones (`spawn_enoexec`,
 * `cli_version_incompatible`) and genuinely transient ones (`upstream_5xx`,
 * `provider_high_demand`), so "named" alone cannot demote a Retry without
 * taking it away from failures that deserve it. That call belongs to the
 * daemon's own verdict — see {@link RunFailureDaemonVerdict}.
 */
export function daemonNamedTheFailure(detail: string | null | undefined): boolean {
  return typeof detail === 'string' && detail.length > 0 && detail !== 'unknown';
}

/**
 * Did the daemon already decide that running this again cannot help?
 *
 * Either half is sufficient and they are written independently upstream:
 * `retryable: false` is the classifier's verdict, `failureAction: 'none'` is
 * the same verdict expressed as an instruction. An absent verdict answers no,
 * which is what keeps an older daemon on today's behaviour.
 */
function daemonSaysRetryIsFutile(
  verdict: RunFailureDaemonVerdict | null | undefined,
): boolean {
  if (!verdict) return false;
  return verdict.retryable === false || verdict.failureAction === 'none';
}

/**
 * Read the daemon's verdict off whatever the chat has for this failure.
 *
 * Deliberately structural rather than typed against the event: the fields are
 * not on `PersistedAgentEvent` yet (see {@link RunFailureDaemonVerdict}), and
 * the same shape of defensive read is how `runFailureFieldsFromError` already
 * picks the classification off a surfaced error. Returns undefined when neither
 * field is present, so a caller passes nothing through rather than an object
 * that says "we asked and the answer was nothing".
 */
export function daemonFailureVerdictFrom(
  source: unknown,
): RunFailureDaemonVerdict | undefined {
  const value = source as
    | { retryable?: unknown; failureAction?: unknown }
    | null
    | undefined;
  if (!value || typeof value !== 'object') return undefined;
  const retryable = typeof value.retryable === 'boolean' ? value.retryable : undefined;
  const failureAction =
    typeof value.failureAction === 'string'
      ? (value.failureAction as RunFailureAction)
      : undefined;
  if (retryable === undefined && failureAction === undefined) return undefined;
  return {
    ...(retryable === undefined ? {} : { retryable }),
    ...(failureAction === undefined ? {} : { failureAction }),
  };
}

/**
 * Does the LADDER hand this card a control that can push the failed run forward?
 *
 * Contact support opens a conversation rather than recovering the run.
 * Callers use it to decide whether to offer the generic local-CLI escape hatch
 * alongside.
 *
 */
export function hasSelfContainedRecovery(ui: RunFailureUi | null | undefined): boolean {
  if (!ui) return false;
  if (ui.secondaryRetry) return true;
  return ui.primaryAction !== 'contact-support';
}

/**
 * Build a failure card from the nature of the failure. Callers never name a
 * primary action — they describe the failure and the ladder answers.
 */
function failureCard(
  nature: RunFailureNature,
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
  extra: Partial<
    Pick<
      RunFailureUi,
      'secondaryRetry' |  'messageVars' | 'messageCauseKey'
    >
  > = {},
): RunFailureUi {
  return {
    primaryAction: primaryActionForFailure(nature),
    titleKey,
    messageKey,
    secondaryRetry: extra.secondaryRetry ?? false,

    ...(extra.messageVars ? { messageVars: extra.messageVars } : {}),
    ...(extra.messageCauseKey ? { messageCauseKey: extra.messageCauseKey } : {}),
  };
}

// Named failure type + actionable copy, recovered by re-running once the user
// has followed the instruction (ladder rung 2).
function retryWithGuidance(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({ transient: true }, titleKey, messageKey);
}

/**
 * The conversation itself is what fails (too long for the model, or refused by
 * the service). Retry resends it and stays as the secondary; a new conversation
 * is the way forward.
 */
function newConversationWithGuidance(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return { ...retryWithGuidance(titleKey, messageKey), leadsWithNewConversation: true };
}

/**
 * The selected model cannot serve this run at all — it is missing, disabled, or
 * no longer in the catalogue. Retrying re-picks the same model and reproduces
 * the same answer, so the card offers the one thing that changes the outcome:
 * picking a different model (ladder rung 1).
 */
function switchModelWithGuidance(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({ directFix: 'switch-model' }, titleKey, messageKey);
}

/**
 * Named environment failures use the approved supplementary copy
 * (L7ukd6xcqoWpo2xJzKdcDPctnvh, revision 96), not the region-only S30 text.
 * Keep each existing recovery action and cause identity when changing copy.
 */
function clientEnvironmentCard(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
  causeKey: RunFailureCauseKey,
): RunFailureUi {
  return failureCard(
    { directFix: 'open-settings' },
    titleKey,
    messageKey,
    { secondaryRetry: true, messageCauseKey: causeKey },
  );
}


/**
 * Nothing on this card can move the run forward and retrying is futile
 * (ladder rung 4). 〔Contact support〕 — a standing secondary on every failure
 * card — is promoted to primary so the card is never a dead end.
 */
function contactSupportOnly(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({}, titleKey, messageKey);
}

/**
 * A BYOK send the browser refused because the local runtime that would carry it
 * is not detected. No run ever existed, so the daemon never classifies these:
 * `ProjectView` stamps the code, and the failed turn's persisted error event
 * carries it across a reload. Renaming one strands the rows already stored.
 */
export const BYOK_OPENCODE_UNAVAILABLE_CODE = 'BYOK_OPENCODE_UNAVAILABLE';
export const BYOK_CODEX_UNAVAILABLE_CODE = 'BYOK_CODEX_UNAVAILABLE';

export function isByokRuntimeRefusal(code: string | null | undefined): boolean {
  return code === BYOK_OPENCODE_UNAVAILABLE_CODE
    || code === BYOK_CODEX_UNAVAILABLE_CODE;
}

/**
 * Ladder rung 1: the rescan that clears this lives in Settings, and until the
 * runtime is installed a retry refuses the same way. Retry stays as a secondary
 * because it is how the user re-sends the same prompt once the fix is done.
 */
function byokRuntimeRefusalCard(
  agent: string,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return {
    ...failureCard(
      { directFix: 'open-settings' },
      'chat.runError.title.cliMissing',
      messageKey,
      { secondaryRetry: true, messageVars: { agent } },
    ),
    leadsWithSettings: true,
  };
}

// Agent-agnostic failure codes that carry a clear root cause and a concrete
// fix, mapped the same way regardless of which agent produced them. The daemon
// already classifies these into failure_category / user_action
// (apps/daemon/src/run-failure-classification.ts); this is the user-facing half
// of that taxonomy — a human-readable type name plus a one-line instruction,
// with the raw upstream string preserved in the card's collapsible source area.
const AGENT_AGNOSTIC_FAILURE_UI: Record<string, RunFailureUi> = {
  // The OpenPixo-credits agent model ran out of credits. Retrying works once the
  // user has topped up, so it is guidance plus retry, not a dead end.
  INSUFFICIENT_CREDITS: retryWithGuidance(
    'chat.runError.title.outOfCredits',
    'chat.runError.outOfCreditsMessage',
  ),
  // Paused by the operator, or a per-run / daily token cap: same model, same answer.
  HOSTED_AGENT_UNAVAILABLE: contactSupportOnly(
    'chat.runError.title.hostedAgentUnavailable',
    'chat.runError.hostedAgentUnavailableMessage',
  ),
  // S23 · 跑完了但没生成文件。正文以前是 `null`,于是卡面落到兜底那一句
  // (「这次没能顺利完成。反复出现的话,把日志发给我们。」)—— 用户面对的是一次
  // **正常结束**的任务,兜底句却在说它失败了,而且什么都没解释。文档 S23 有终稿,
  // 补上。
  ARTIFACT_NOT_FOUND: retryWithGuidance(
    'chat.runError.title.artifactMissing',
    'chat.runError.artifactMissingMessage',
  ),
  // CLI binary not found on PATH (user_action: install_cli).
  AGENT_UNAVAILABLE: retryWithGuidance(
    'chat.runError.title.cliMissing',
    'chat.runError.cliMissingMessage',
  ),
  [BYOK_OPENCODE_UNAVAILABLE_CODE]: byokRuntimeRefusalCard(
    'OpenCode',
    'chat.runError.byokOpencodeUnavailableMessage',
  ),
  [BYOK_CODEX_UNAVAILABLE_CODE]: byokRuntimeRefusalCard(
    'Codex',
    'chat.runError.byokCodexUnavailableMessage',
  ),
  // Input exceeded the model context window (user_action: reduce_context).
  AGENT_PROMPT_TOO_LARGE: newConversationWithGuidance(
    'chat.runError.title.promptTooLarge',
    'chat.runError.promptTooLargeMessage',
  ),
  // Selected model is missing/disabled (user_action: switch_model). The daemon
  // already names the fix — offer it as the button instead of a Retry that is
  // guaranteed to fail the same way.

  // Guard halted a repeating, non-progressing tool loop (user_action: retry
  // after checking the real target).
  TOOL_LOOP_DETECTED: retryWithGuidance(
    'chat.runError.title.toolLoop',
    'chat.runError.toolLoopMessage',
  ),
  // Model emitted a fabricated role marker and was aborted; a plain retry
  // usually recovers.
  ROLE_MARKER_HALLUCINATION: retryWithGuidance(
    'chat.runError.title.outputInvalid',
    'chat.runError.outputInvalidMessage',
  ),
  // Checked-in runtime def failed strict validation (user_action: fix_config).
  // Ladder rung 4 (catalogue R-031: flow F10, "retryable: no"): the user cannot
  // self-repair and a new run re-reads the same invalid definition, so the
  // button now matches what the copy has always said — talk to us.
  AGENT_RUNTIME_DEF_INVALID: contactSupportOnly(
    'chat.runError.title.runtimeConfig',
    'chat.runError.runtimeConfigMessage',
  ),
  // R9 · the browser↔daemon stream gave up reconnecting. Ladder rung 2 — the
  // stream can be re-established, and 〔重新连接〕 already exists for exactly
  // that. But the button lives on the reconnect line at the tail of the
  // conversation (grid 84, S29), not on a card, so this mapping draws no card:
  // the run may well still be alive on the daemon (`ProjectView` re-attaches
  // any run whose only failure event is this one), and a card claiming "task
  // failed" would be both a duplicate and a lie.
  [RECONNECT_OWNED_FAILURE_CODE]: {
    ...failureCard(
      { transient: true },
      'chat.runError.title.connectionDropped',
      'chat.connectionDropped',
    ),
    suppressCard: true,
  },
};

/**
 * The card for "the agent replied, but the reply could not be recorded".
 *
 * A function rather than a shared constant because `AGENT_AGNOSTIC_FAILURE_UI`
 * hands its values straight to callers; four references to one frozen-by-
 * convention object would let a future mutation of one code's card silently
 * rewrite the other three.
 */


// Failure causes keyed by the daemon's fine-grained `failure_detail`, for the
// cases where the coarse `error_code` alone is wrong or too vague. This layer
// can OVERRIDE a code mapping — e.g. `hard_quota` and a transient 429 share
// `error_code: RATE_LIMITED`, but only the transient one should offer Retry.
// Applied after agent-specific handling and before the generic code branches.
const DETAIL_FAILURE_UI: Record<string, RunFailureUi> = {
  // Provider quota / billing hard-stop: retrying reproduces the failure, so
  // drop Retry until the provider configuration is repaired.
  hard_quota: contactSupportOnly(
    'chat.runError.title.quotaExhausted',
    'chat.runError.quotaExhaustedMessage',
  ),

  // CLI binary missing detected only from text (leaks in as the opaque
  // AGENT_EXECUTION_FAILED code, not AGENT_UNAVAILABLE) — reuse the same
  // "install the CLI, then retry" card the code path already renders.
  cli_not_installed: retryWithGuidance(
    'chat.runError.title.cliMissing',
    'chat.runError.cliMissingMessage',
  ),
};

/**
 * S05 · 自带 API key 没配好 —— **只对那把 key 我们自己存着的一轮成立**。
 *
 * daemon 认得这一格,而且判得完全对:`authDetail` 的正则(「invalid api key」/
 * 「api key … invalid」,`run-failure-classification.ts`)把它从 `auth_required`
 * 里单独摘出来,category `auth`、user_action `login`、retryable false。web 这边
 * 一直没有这一格,于是 BYOK 那一轮落到最后那张通用卡 —— 标题「任务执行失败」、
 * 正文是兜底句、卡上唯一像出路的按钮是〔联系支持〕。API key 填错了把人支去联系
 * 客服,是这张卡最不该做的事,而且卡上没有任何通往「改 key」的入口,尽管 daemon
 * 说的就是 `login`。(实测:packaged BYOK `byok-opencode`,code
 * AGENT_EXECUTION_FAILED + detail invalid_api_key。)
 *
 * ⚠️ 判据不是「这条 detail」,是「这把 key 在谁手上」。
 *
 * `authDetail()` 是从**任何** agent 拍平的 stderr 上读出来的,所以本机 CLI 一样
 * 会报 `invalid_api_key` —— `claude` 那句 `Invalid API key · Please run /login`
 * 同时命中 `AGENT_AUTH_FAILURE_RE`(→ code `AGENT_AUTH_REQUIRED`)和这条 detail。
 * 而本机 CLI 的登录态在用户自己的终端里:把它们送去设置页,是把人送到一屏**改不了
 * 那把 key** 的界面上(`opencode` 在那一屏没有输入框),
 * 同时还吃掉了它们本来该看到的 S02「{agent} 尚未登录」+ 终端登录指引。
 * 这条作用域就是 PR #7893 评审拦下来的那一条。
 *
 * 所以这一格按 `byokApiKeyIsEditableInSettings` 收窄到 BYOK / API 提供商那一档
 * (`utils/byokProvider.ts`,和发送前那道 BYOK 闸门是同一条线);不在这一档的
 * agent 一律**继续往下走**,落回它们原本的那条路 —— code `AGENT_AUTH_REQUIRED` /
 * `UNAUTHORIZED` 的走 S02,其余的走原来的兜底。这一格一个字都不替它们改。
 *
 * 摆位:在通用认证错误分支之前,
 * 在码级分支**之前**(覆盖过粗的 `AGENT_AUTH_REQUIRED` 正是这一层存在的理由)。
 *
 * 主按钮〔去设置〕是阶梯第 1 档:落点是 `execution` 这一节,BYOK 的 key 输入框
 * (`ByokKeyField`)就渲染在那一屏,也正是发送前那道 BYOK 闸门(`ProjectView` 的
 * `requiresByokPreflight` → `onOpenSettings('execution')`)落的同一个地方 ——
 * 不新造入口。
 *
 * 不带重试:文档 S05 那一排只有〔去设置〕,而且 key 没改之前重试必然同样结果
 * (设计原则四)。
 */
function apiKeyInvalidCardFor(agentId: string | null | undefined): RunFailureUi | null {
  if (!byokApiKeyIsEditableInSettings(agentId)) return null;
  return failureCard(
    { directFix: 'open-settings' },
    'chat.runError.title.apiKeyInvalid',
    'chat.runError.apiKeyInvalidMessage',
  );
}

// Agent-agnostic failure causes keyed by the daemon's `failure_detail`, resolved
// BEFORE agent-specific branches (unlike DETAIL_FAILURE_UI above).
// These are engine-neutral run outcomes — a timeout, an empty result, a stale
// resumed session, a missing Git Bash — that carry the same named type + fix for
// every agent. They leak in under the opaque AGENT_EXECUTION_FAILED
// / process-exit codes, so without this the card would only show the raw stderr.
const AGENT_AGNOSTIC_DETAIL_FAILURE_UI: Record<string, RunFailureUi> = {
  // The daemon read the size failure out of the upstream text, so it arrives
  // under the opaque AGENT_EXECUTION_FAILED with no code of its own.
  prompt_too_large: newConversationWithGuidance(
    'chat.runError.title.promptTooLarge',
    'chat.runError.promptTooLargeMessage',
  ),
  request_too_large: newConversationWithGuidance(
    'chat.runError.title.promptTooLarge',
    'chat.runError.promptTooLargeMessage',
  ),
  // The service answered a bare 400 Bad Request: the request this conversation
  // builds is refused, and building it again from the same conversation is
  // refused again. Seen on a Codex thread that had collected 182 playtest frames.
  request_rejected: newConversationWithGuidance(
    'chat.runError.title.requestRejected',
    'chat.runError.requestRejectedMessage',
  ),
  stream_disconnected: retryWithGuidance(
    'chat.runError.title.connectionDropped',
    'chat.connectionDropped',
  ),
  // Hard wall-clock timeout for the run (daemon user_action: retry). A plain
  // retry — optionally with a smaller task — usually gets through.
  timeout: retryWithGuidance(
    'chat.runError.title.timedOut',
    'chat.runError.timedOutMessage',
  ),
  // The agent stalled (no new output for too long) and was cut off as a
  // timeout. Distinct copy from a hard timeout, same retry recovery.
  inactivity_timeout: retryWithGuidance(
    'chat.runError.title.timedOut',
    'chat.runError.inactivityTimeoutMessage',
  ),
  // Run terminated without producing any output (daemon user_action: retry);
  // usually transient, so name it and offer a straight retry.
  empty_output: retryWithGuidance(
    'chat.runError.title.emptyOutput',
    'chat.runError.emptyOutputMessage',
  ),
  // A resumed agent session id went stale; the daemon already cleared it so the
  // next run starts fresh (#3408). Name it as recoverable and offer Retry.
  session_resume_expired: retryWithGuidance(
    'chat.runError.title.sessionExpired',
    'chat.runError.sessionExpiredMessage',
  ),
  // Product decision (2026-09-14): no error card for missing Git Bash.
  // Keep the daemon's failed-run diagnosis and the existing run-status shell;
  // suppressing this surface does not turn the failed run into a success.
  git_bash_missing: {
    ...retryWithGuidance(
      'chat.runError.title.gitBashMissing',
      'chat.runError.gitBashMissingMessage',
    ),
    suppressCard: true,
  },
  // The bundled agent binary needs a CPU instruction set (AVX2) this device
  // doesn't have, so it crashes on launch — retrying reproduces the crash and
  // switching hosted models doesn't help (the runtime binary is the problem).
  // The fix is updating OpenPixo to a build that bundles a compatible
  // (baseline) runtime, so show guidance copy without a dead Retry button.
  // Ladder rung 4. §6.Z names this one explicitly under principle 4 ("quota
  // spent, account suspended, CPU unsupported — these three get no Retry").
  // Rung 3 is not available either: the binary that cannot start IS the hosted
  // runtime, so "switch to Cloud" would point at the thing that just crashed.
  cpu_unsupported: contactSupportOnly(
    'chat.runError.title.cpuUnsupported',
    'chat.runError.cpuUnsupportedMessage',
  ),
  // The bundled runtime cannot load on this Windows build (older than 10 1809 /
  // build 17763, Bun's floor). Deterministic like cpu_unsupported, so no Retry;
  // the copy names the OS version so the user updates Windows instead.
  os_unsupported: contactSupportOnly(
    'chat.runError.title.osUnsupported',
    'chat.runError.osUnsupportedMessage',
  ),
  // S19 · the agent exited and did not say why. 20,868 runs/month, 16.3% of all
  // failures, 3,869 devices — the second-largest bucket, and until now it had no
  // row in any of the three tables, so every one of those runs rendered "task
  // failed" plus whatever stderr happened to be attached (catalogue R-070 /
  // R-071 / R-072 / R-079).
  //
  // Design copy verbatim (`error-ux-design.md:212-217`): "{agent} exited
  // unexpectedly — it didn't say why. Retrying usually recovers; if it keeps
  // happening, send us the logs. 〔Retry | Export logs〕". 〔Export logs〕 is a
  // standing secondary on every card (§6.Z), so the mapping only has to declare
  // that a retry is worth offering — ladder rung 2.
  //
  // Causes we CAN name resolve earlier (cli missing, Git Bash, timeouts, stale
  // session, CPU): these six are the residue where the exit carries no reason.
  process_crashed: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  signal_killed: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  terminated_unknown: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  exit_code: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  exit_nonzero: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  execution_failed: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  // A fatal JSON-RPC error can come from the Codex app-server transport.
  // It reports an unavailable service after automatic recovery is exhausted.
  fatal_rpc_error: retryWithGuidance(
    'chat.runError.title.upstreamUnavailable',
    'chat.runError.upstreamUnavailableMessage',
  ),
  // Provider overload is transient, so retry remains available for these details.
  upstream_5xx: retryWithGuidance(
    'chat.runError.title.upstreamUnavailable',
    'chat.runError.upstreamUnavailableMessage',
  ),
  provider_high_demand: retryWithGuidance(
    'chat.runError.title.upstreamUnavailable',
    'chat.runError.upstreamUnavailableMessage',
  ),
  // S18 · risk control suspended the account (catalogue R-064: "card — contact
  // support, no Retry"). Retrying a suspended account fails the same way.
  // Ladder rung 4, and deliberately no switch card: a suspended account has the
  // same problem on the hosted path.
  account_suspended: contactSupportOnly(
    'chat.runError.title.accountSuspended',
    'chat.runError.accountSuspendedMessage',
  ),
  // The `model_unavailable` family — the one failure class the daemon fully
  // diagnoses AND prescribes for, and the only one of those that had no row in
  // any of the three tables.
  //
  // `modelUnavailableDetail()` (`run-failure-classification.ts`) reads the cause
  // out of the upstream sentence and rules the run `retryable: false` /
  // `user_action: 'switch_model'`. Web carried only the code-keyed half of that
  // family, and a
  // BYOK agent's model problem never arrives under that code: it arrives as the
  // opaque `AGENT_EXECUTION_FAILED` plus one of these details. So it was
  // structurally unreachable, fell to the rung-4 fallback, and the user was told
  // "task failed" with 〔contact support〕 while the daemon had already written
  // down both the cause and the cure. (Observed on a packaged Codex run whose
  // upstream sentence was literally "The '…' model requires a newer version of
  // Codex" — the exact string `cli_version_incompatible` matches on.)
  //
  // Same card as the code-keyed row, deliberately: one family, one story, and
  // the en/zh-CN copy and the 〔switch model〕 button all already exist.
  //
  // Ladder rung 1, and NO retry — neither primary nor secondary. The model
  // picker is ours and re-picking is the one act that changes the outcome;
  // re-running the same CLI against the same model reproduces the same refusal,
  // which is exactly what the daemon's `retryable: false` says. Note these rows
  // do not READ that verdict: the card is right for an older daemon that ships
  // the detail without it, which is the state the wire is actually in today.
  //
  // Resolved HERE and not in `DETAIL_FAILURE_UI` for two reasons:
  //   1. The family's code-keyed row already resolves at this precedence, above
  //      every agent branch. Splitting one card across two layers would make
  //      "may an agent branch pre-empt this?" depend on nothing more than
  //      whether the daemon happened to have a structured error code.
  //   2. `DETAIL_FAILURE_UI` is scoped to OVERRIDING a code mapping that is
  //      wrong or too vague. These override nothing — `AGENT_EXECUTION_FAILED`
  //      has no row in any table.
  //
  // ⚠️ `provider_routing_error` is deliberately NOT here even though
  // `modelUnavailableDetail()` also emits it: `upstreamDetail()` emits the SAME
  // string for `upstream_unavailable` / `retryable: true` / `'retry'`, and this
  // module receives the detail without the category, so one row would mis-card
  // the upstream half. It needs `failureCategory` on the wire first.
  //
  // ⚠️ 待拍板 — `local_model_not_loaded` is the one member whose copy fits
  // loosely. The daemon prescribes `switch_model` for it like the rest, and the
  // family card is the honest place for it (the selected model genuinely cannot
  // serve the run), but its literal fix is "load a model in LM Studio", not
  // "pick another model here". Routing is right; the sentence may want its own
  // cell. Change the wording, not the row, when product writes one.
  //
  // ⚠️ 「模型不存在」这一半(`cli_version_incompatible` / `model_not_found`)
  // **还留在 S07 那张卡上**,不是疏忽:文档 S13 给它的终稿标题是
  // 「未找到 {模型名}」,而失败事件上没有模型名 —— `code` / `failureDetail` /
  // 上游原文三样里都没有结构化的模型标识,报错卡也拿不到「这一轮跑的是哪个模型」。
  // 硬把 `{模型名}` 摆到用户脸上比现在更糟,所以这一格等数据通路,不改文案。
  cli_version_incompatible: switchModelWithGuidance(
    'chat.runError.title.modelUnavailable',
    'chat.runError.modelUnavailableMessage',
  ),
  model_not_found: switchModelWithGuidance(
    'chat.runError.title.modelUnavailable',
    'chat.runError.modelUnavailableMessage',
  ),
  // S13 的另一半:「模型能力不支持」。文档给了它自己的标题和正文,和
  // S07「当前模型不可用」不是同一句话 —— 那句说的是「这个模型现在用不了」,
  // 这句说的是「这个模型做不了这件事」。而且这一句**没有插值槽**,所以它是三格
  // 里唯一能立刻按终稿落下去的。
  model_not_supported: switchModelWithGuidance(
    'chat.runError.title.modelCapabilityUnsupported',
    'chat.runError.modelCapabilityUnsupportedMessage',
  ),
  model_disabled: switchModelWithGuidance(
    'chat.runError.title.modelCapabilityUnsupported',
    'chat.runError.modelCapabilityUnsupportedMessage',
  ),
  local_model_not_loaded: switchModelWithGuidance(
    'chat.runError.title.modelCapabilityUnsupported',
    'chat.runError.modelCapabilityUnsupportedMessage',
  ),
  // S30 · the five client-environment causes. Agent-agnostic on purpose and
  // resolved here, ahead of every agent branch: the proxy, the certificate
  // store, the route and the host policy belong to the user's machine, so the
  // card is the same one whichever agent happened to be running.
  //
  // Product-approved descriptions distinguish local/network causes from region restrictions.
  certificate_failure: clientEnvironmentCard(
    'chat.runError.title.certificateFailure',
    'chat.runError.certificateFailureMessage',
    'chat.runError.clientEnvironmentCause.certificate',
  ),
  proxy_configuration: clientEnvironmentCard(
    'chat.runError.title.proxyConfiguration',
    'chat.runError.proxyConfigurationMessage',
    'chat.runError.clientEnvironmentCause.proxy',
  ),
  network_configuration: clientEnvironmentCard(
    'chat.runError.title.networkConfiguration',
    'chat.runError.networkConfigurationMessage',
    'chat.runError.clientEnvironmentCause.network',
  ),
  host_policy_block: clientEnvironmentCard(
    'chat.runError.title.hostPolicyBlock',
    'chat.runError.hostPolicyBlockMessage',
    'chat.runError.clientEnvironmentCause.hostPolicy',
  ),
  local_storage_failure: clientEnvironmentCard(
    'chat.runError.title.localStorageFailure',
    'chat.runError.localStorageFailureMessage',
    'chat.runError.clientEnvironmentCause.localStorage',
  ),
};

// Resolve the failure UI for a failed run:
//   - agent-agnostic root cause (cli missing, prompt too large, model
//     unavailable, tool loop, bad output, bad runtime def) → named type + fix
//   - agent-agnostic failure_detail (timeout, empty output, stale resumed
//     session) → named type + retry, for every agent
//   - missing Git Bash → retain failed-run status without an error card
//   - fine-grained failure_detail (hard quota, text-detected
//     cli-missing) → named type + fix, overriding a too-coarse code
//   - model/auth/quota error → named copy with local recovery guidance
//   - any agent, generic failure            → plain retry
//
export function resolveRunFailureUi(
  code: string | null | undefined,
  detail: string | null | undefined,
  agentId: string | null | undefined,
  rawMessage?: string | null,
  verdict?: RunFailureDaemonVerdict | null,
): RunFailureUi {
  const ui = resolveRunFailureUiIgnoringSelfPromotion(
    code,
    detail,
    agentId,
    rawMessage,
    verdict,
  );
  // S30 changes copy only. Keep the existing code/agent/verdict action
  // selection, and never infer a region restriction from the raw message.
  const localizedUi: RunFailureUi = detail === 'region_not_supported'
    ? {
      ...ui,
      titleKey: 'chat.runError.title.regionNotSupported',
      messageKey: 'chat.runError.regionNotSupportedMessage',
    }
    : ui;
  return localizedUi;
}

function resolveRunFailureUiIgnoringSelfPromotion(
  code: string | null | undefined,
  detail: string | null | undefined,
  agentId: string | null | undefined,
  rawMessage?: string | null,
  verdict?: RunFailureDaemonVerdict | null,
): RunFailureUi {
  // Agent-agnostic codes resolve first so specific guidance wins over fallback.
  const agnostic = typeof code === 'string' ? AGENT_AGNOSTIC_FAILURE_UI[code] : undefined;
  if (agnostic) return agnostic;
  // A rolling per-model window (the hosted gateway's `model_limit_exceeded`)
  // resolves before every agent branch. It has to: the window is the gateway's,
  // not the agent's. The reset instant is read from the same upstream text the card
  // already displays, through the shared contracts reader.
  if (detail === 'model_window_limit') {
    // The daemon already decided this IS a window limit, so read the instant
    // directly rather than re-deciding from the text — an upstream rewording
    // that the daemon still classified must not silently lose the card.
    const parsed = readModelWindowResetAt(rawMessage);
    const retryAt = parsed && Number.isFinite(Date.parse(parsed)) ? parsed : null;
    // The window rolls over on its own — as transient as a failure gets (rung 2).
    return failureCard(
      { transient: true },
      'chat.runError.title.modelWindowLimit',
      retryAt
        ? 'chat.runError.modelWindowLimitMessage'
        : 'chat.runError.modelWindowLimitMessageNoTime',
      retryAt ? { messageVars: { retryAt } } : {},
    );
  }
  // Engine-neutral failure_detail (timeout, empty output, stale resumed session,
  // missing Git Bash) resolves before the agent branches so it applies to every
  // agent.
  const agnosticDetail =
    typeof detail === 'string' ? AGENT_AGNOSTIC_DETAIL_FAILURE_UI[detail] : undefined;
  if (agnosticDetail) return agnosticDetail;

  // S05 · key 填错了 —— 只在这把 key 归我们保管时才认。判据、摆位理由和它替谁
  // 让路,全写在 `apiKeyInvalidCardFor` 的注释里。不在这一档的 agent 返回 null,
  // 于是继续往下走它原本那条路(码是 AGENT_AUTH_REQUIRED / UNAUTHORIZED 的落 S02)。
  if (detail === 'invalid_api_key') {
    const apiKeyCard = apiKeyInvalidCardFor(agentId);
    if (apiKeyCard) return apiKeyCard;
  }
  // Fine-grained daemon classification overrides a too-coarse code (e.g.
  // hard_quota vs a transient 429 both arriving as RATE_LIMITED), before the
  // generic code branches so it can correct them.
  const detailUi = typeof detail === 'string' ? DETAIL_FAILURE_UI[detail] : undefined;
  if (detailUi) return detailUi;
  // Agent-neutral: a mid-response connection drop (any agent) gets a clear,
  // localized "lost connection — retry" message instead of the raw SDK string.
  // The break is the user's own network path.
  if (code === 'AGENT_CONNECTION_DROPPED') {
    return retryWithGuidance(
      'chat.runError.title.connectionDropped',
      'chat.connectionDropped',
    );
  }
  // 文案 S02 · 本地 agent 没登录 / 登录过期。它的登录在用户自己的终端里,Open
  // Design 替不了:标题「{agent} 尚未登录」点名是哪一个,正文给出下一步,主动作
  // 是重试(等他们本地登录完再跑一次)。
  if (code === 'AGENT_AUTH_REQUIRED' || code === 'UNAUTHORIZED') {
    return failureCard(
      { transient: true },
      'chat.runError.title.signInRequired.other',
      'chat.runError.signInMessage.other',
      {  },
    );
  }
  // Rate limit / upstream outage: name the type and explain the recovery.
  if (code === 'RATE_LIMITED') {
    return failureCard(
      { transient: true },
      'chat.runError.title.rateLimited',
      'chat.runError.rateLimitedMessage',
      {  },
    );
  }
  if (code === 'UPSTREAM_UNAVAILABLE') {
    return failureCard(
      { transient: true },
      'chat.runError.title.upstreamUnavailable',
      'chat.runError.upstreamUnavailableMessage',
      {  },
    );
  }
  // Nothing above claimed this failure — but two very different situations end
  // up here, and until now they shared one answer.
  //
  // (a) The daemon NAMED the cause and this table has no row for it. The old
  //     comment here read "Nothing named this failure", which was simply untrue
  //     of `certificate_failure` and forty-odd siblings: the daemon named them,
  //     ruled them non-retryable, and web handed out a Retry anyway. When its
  //     verdict is available it decides, because it read the run and this is a
  //     lookup table. Rung 4.
  //
  // (b) The daemon did not know either. Keep the retry — an unclassified
  //     failure really is usually a one-off.
  //
  // The `daemonNamedTheFailure` guard is load-bearing, not decoration: the
  // classifier's own last-resort row is `classification('unknown', 'unknown',
  // 'finalize', retryableHint ?? false, retryableHint ? 'retry' : 'none')`, so
  // a plain unknown failure carries `retryable: false` / `'none'` by DEFAULT.
  // Reading the verdict without this guard would therefore strip the Retry from
  // exactly the case that is supposed to keep it.
  if (daemonNamedTheFailure(detail) && daemonSaysRetryIsFutile(verdict)) {
    return failureCard({}, 'chat.runError.title.generic', null);
  }
  // Copy comes from RUN_FAILURE_FALLBACK_MESSAGE_KEY at render time, not from
  // the upstream string, which stays in the collapsible diagnostic area.
  return failureCard({ transient: true }, 'chat.runError.title.generic', null);
}
