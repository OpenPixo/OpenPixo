# Independent scope-correction review

Date: 2026-10-25 (Asia/Tokyo). Reviewer: `integration_review`.
Correction baseline: local `80f3930`, following adaptation `a8114b2`.

## Verdict

**Approve the frozen correction source for local integration and Alpha.2 rebuilding.**
No blocking source finding remains in the reviewed boundaries. This is a source
verdict, not approval of a new package or completion of first-release live
acceptance. The earlier [REVIEW.md](REVIEW.md) applies only to its recorded
Alpha.1 source and artifact.

The authority for this pass is FIRST-RELEASE-SCOPE.md (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`)
and STATUS.md (openpixo-internal: `docs/coordination/STATUS.md`). The reviewer followed ponytail and
code-review-and-quality, read product source without modifying it, and owns
only this report. No model call, external publication, commit or full suite
was run by this reviewer.

## Reviewed boundaries

- Canonical DeepSeek/OpenRouter selection uses one pure contract classifier
  across UI, CLI, HTTP and internal startup. Only supported HTTPS host/path/
  protocol combinations select native Codex. Omitted and legacy BYOK agent
  selections normalize to Codex; conflicting explicit executors fail clearly.
  Existing API history identities and Settings links remain available.
- Native providers use Responses, independent provider IDs, process environment
  authentication and a stable managed Codex home scoped by provider, endpoint,
  model and credential fingerprint. Provider preparation skips normalization of
  the user's Codex configuration. Missing credentials, unsupported inputs and
  unvalidated CLI generations produce setup guidance.
- Validated native models bypass the default account's sanitizer and service-tier
  rewriting. The selected model enters provider argv and turn RPC unchanged;
  provider session identity enters the relevant resume reads and writes.
  Provider keys are excluded from tool-shell inclusion. Default account Codex
  has no provider snapshot and keeps its existing path.
- Native project MCP configuration travels through private thread start/resume
  RPC. The operator-only exec rollback refuses enabled project MCP, including
  configurations whose URL or arguments might contain credentials. Startup
  states stay scoped to their session/root thread, aggregate each server's
  latest state, and reach the existing chat status and CLI event surfaces.
- The shared upstream login, credential-revision and control-context readers
  check daemon-wide opt-in before profile I/O. Disabled startup is signed out;
  per-agent overrides cannot enable it. Local directory and stale-workspace
  authorization remain fail closed.
- The correction reuses existing forms, run lifecycle, prompt/skill composition,
  permissions, status rendering and CLI HTTP boundaries. It adds no dependency
  or execution engine. Domain helpers own new policy, contracts remain pure,
  and no material readability, architecture or performance regression was found
  within this correction scope.

## Resolved findings

All items below were raised during implementation and rechecked on the stable
source. Corrections were made by the owners, not by this reviewer.

| Severity | Defect | Verified correction |
| --- | --- | --- |
| P2 | Changing a provider key reused the prior account's native home/session identity. | Credential fingerprint participates in the identity; repeated identical configuration is stable and key/model/provider changes separate it. |
| P2 | HTTP canonical requests without an agent could use a saved non-Codex executor. | Canonical snapshots select Codex before fallback; a conflicting explicit executor returns 400. |
| P2 | An accepted long OpenRouter slug could become null in the upstream sanitizer and then a static GPT model under priority. | Native model selection bypasses both account-model transformations; production fixture preserves the exact long/unknown slug. |
| P2 | CLI continuation omitted provider credentials/model and could reseed through the default account. Its new credential path also initially bypassed CLI error redaction. | Continue accepts the BYOK snapshot/env-key/model; provider continuation without a snapshot fails before spawn. Success/error/follow output uses the credential-aware serializer. |
| P2 | Legacy MCP argv still exposed possible secrets in HTTP URLs or stdio arguments after only env/header rejection. | Enabled project MCP requires private native RPC; exec rollback fails with app-server guidance. |
| P2 | Recursive secret replacement corrupted native controls; raw stdout failure tails could bypass event redaction. | Credential extraction and display-field filtering preserve IDs/decisions/ordinary flags. Stateful text filtering protects stderr emission/tails and stdout diagnostic tails; known bearer token bodies are scrubbed. |

## Reviewer-executed evidence

Two narrow offline source witnesses were executed with pinned Node 24 and
`--import tsx`; neither started a daemon or model:

1. The actual output helper initially changed `availableDecisions`,
   `approval_resolved.decision` and `node build-production.js` when ordinary MCP
   values were `MODE=accept` and `NODE_ENV=production`. After correction, the
   identical witness passed: controls, IDs and command stayed unchanged while
   a separate known token in displayed text became `[REDACTED]`.
   A split-token helper witness returned `401 [REDACTED] failed`.
2. The actual model/definition helpers initially converted a 201-character
   accepted OpenRouter slug to null, then `gpt-5.5` for priority. Final source
   inspection confirms native model pinning bypasses that path; the author's
   final production fixture checks the complete RPC model behavior.

The split-token execution evidence is at helper level. Source tracing
separately confirmed live stderr uses one stateful redactor before both SSE
emission and its retained tail; stdout uses an independent stateful redactor
for diagnostics while the RPC parser keeps original bytes. This reviewer did
not personally execute a production live-SSE split-token test.

## Recorded owner/orchestrator validation

The following results were reported by the owners/orchestrator and checked
against the test source and coordination reports. They were **not personally
rerun by this reviewer**, and overlapping selections must not be summed.

| Boundary | Recorded result |
| --- | --- |
| Final runtime/CLI/provider/output selection | 8 files, 183 tests passed |
| Canonical Responses connection selection | 6 passed: URI/body/parsing, 401 key redaction, missing key and retained legacy endpoint behavior |
| Shared classifier contracts | 24 passed |
| Final paired real daemon HTTP fixtures | 2/2 passed in 42.71s, using fake native processes |
| MCP notification/config/argv/production selection | 7 daemon files, 76 passed; 2 web files, 3 DOM tests passed |
| Startup isolation | 118 focused checks passed; final startup file 3/3 and original reader file 18/18 passed |
| Provider web correction | Native UI selection 7 passed; affected history/config/settings checks and corrected-fixture reruns passed; exact breakdown in PRODUCT.md |
| Type and repository checks | Full daemon source/test and web typechecks passed; orchestrator subsequently recorded final root guard and repository-wide typecheck exiting 0, with logs under `.cache/packaging/0.1.0-alpha.2/` |

The paired production fixtures cover canonical routing against a saved Claude
default, private home/account-key exclusion, unchanged user configuration,
same-provider resume, missing-snapshot no-spawn rejection, provider switching,
exact long model selection, raw-stdout token redaction, default account
execution, project skill/MCP RPC injection, explicit approvals and visible
nonfatal MCP failure in replayed SSE.

An earlier broader connection-test filter also selected two upstream
POSIX-shebang fixtures that failed on native Windows
(`fallback_invalid` versus `fallback_failed`). They were not changed or
included in the six canonical cases. No entire connection-test-file or full
daemon-suite pass is claimed.

Evidence: [RUNTIME.md](RUNTIME.md), PRODUCT.md (openpixo-internal: `docs/coordination/PRODUCT.md`),
[STARTUP-BOUNDARY.md](STARTUP-BOUNDARY.md),
[MCP-FEEDBACK.md](MCP-FEEDBACK.md) and
[PROVIDER-FIDELITY.md](PROVIDER-FIDELITY.md).

## Remaining delivery limits

The orchestrator saved the checked application source as local commit
`c058ba3d61f124a95ee22c99541ffc1ea73f4d3d`. New Alpha.2 artifact and installed
lifecycle acceptance remain packaging gates. Alpha.1 package evidence does not
accept binaries for this changed source.

Native metadata/auth and MCP initialize probes used Codex 0.160.0 without model
turns. They establish configuration/startup behavior, not real paid-provider
tasks, actual skill/MCP/child-agent participation, real-game acceptance, signing
or public publication. None of those actions was executed by this reviewer.
