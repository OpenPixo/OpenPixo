/**
 * Read an upstream provider's rolling per-model usage window. A temporary
 * window limit differs from exhausted quota: retrying after the stated time
 * can succeed. Share this parser between daemon classification and web copy.
 */

/**
 * Whether an upstream failure is a rolling per-model window rather than an
 * exhausted quota.
 *
 * Asked before any hard-quota check, since the quota detector's `usage limit`
 * alternative matches this sentence too.
 *
 * The structured code is tried first — it is what the gateway actually emits,
 * and it survives wording changes — with the sentence shape as the fallback for
 * transports that flatten the error to a bare string. The window length is
 * deliberately not pinned to five hours: the policy is server-side
 * configuration, not part of the contract.
 */
export function isModelWindowLimitFailure(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\bmodel_limit_exceeded\b/i.test(text)
    || /\b\d+\s*-?\s*hour usage limit\b/i.test(text);
}

/**
 * The instant the window rolls over, exactly as the gateway wrote it.
 *
 * Current server builds always format UTC (`…Z`); a numeric offset is accepted
 * too so a future formatting change degrades to a correct read rather than to
 * no read at all.
 *
 * Returns null when the text carries no readable instant — callers must treat
 * that as "there is a wait, but do not promise a time" rather than substituting
 * a guess, because a wrong instant is worse than an absent one here.
 */
export function readModelWindowResetAt(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /\btry again after\s+(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2}))/i
    .exec(text);
  return match?.[1] ?? null;
}
