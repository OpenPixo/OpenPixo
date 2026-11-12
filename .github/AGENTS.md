# GitHub automation guide

OpenPixo keeps the PR validation system from the hard fork (ADR 0006).
Upstream organization releases, publishing, notifications, contributor bots,
and repository maintenance workflows have been removed.

## Retained workflows

- `ci.yml` owns PR, merge-queue, and manual validation. Its Linux planning
  jobs resolve runners, scopes, and reusable workload results; `Validate workspace`
  is the application merge gate.
- `comment.atom.yml`, `autofix.atom.yml`, and `report.atom.yml` consume typed
  handoffs from completed CI runs for comments, same-repository patches, and
  reports.
- `convergence.atom.yml` publishes successful reusable workload results.
- `rerun.atom.yml` requests one retry for CI jobs lost to infrastructure
  cancellation, using `scripts/rerun_infra_cancel.py`.
- `catalog-validate.yml` remains independent of the merge gate; its long-term
  OpenPixo role is undecided. The inherited critique conformance workflow was
  removed with the scoring UI.

The PR template and generic bug/feature issue forms remain. There is no
upstream CODEOWNERS or automatic approval of fork PR workflows.

Linux validation defaults to GitHub-hosted Ubuntu; Windows uses the hosted
Windows profile. Optional Blacksmith and explicitly labeled preseeded/persistent
runners remain selectable. No upstream runner fleet is selected.

Trusted writer atoms require a nonempty repository variable `PIXO_REPOSITORY`
that exactly matches `github.repository`; without it they remain disabled.
The isolated convergence publisher passes that same value into its helper.
Bot tokens are limited to the current owner/repository. Do not broaden writer
permissions or replace explicit authorization with event data alone.

Convergence uses the product protocol and declaration schema 12. Previous
product receipts/config versions are not accepted. Scope confidence, routing
and omission policy are unchanged. Release-only helpers have no repository
or bot identity default; configure the selected repository and
`PIXO_RELEASE_BOT_LOGIN` explicitly before using them.

## Read before editing

- `workflows/ci.yml` and any affected atom or composite action.
- `scripts/handoff.py`, which owns artifact names, layout, and validation.
- `config/runners.json`, `config/scopes.json`, `config/convergence.json`,
  `config/postinstall.json`, and their Python helpers when changing planning
  or setup.
- `specs/current/ci.md` before changing scope routing, confidence, or omission
  policy; `docs/ci/workload-products.md` before changing reusable products.
- `e2e/tests/packaged-smoke-workflow.test.ts` and the relevant cases under
  `e2e/tests/scripts/` or `e2e/tests/actions-cache-workflows.test.ts`.

## Boundaries and safety

Business decisions belong in `ci.yml`; reusable trusted writes belong in the
existing atoms. Do not add domain-specific follow-on workflows when a typed
handoff can use an existing atom.

- `comment.atom.yml` consumes final text only. It does not install dependencies,
  access storage, or execute PR code.
- `autofix.atom.yml` applies only declared paths after live PR, head, and base
  checks. Fork, closed, draft, and stale PRs skip.
- `report.atom.yml` may materialize reports and publish comments, but must
  check out trusted base/default code and treat PR artifacts as untrusted data.
- Trusted `workflow_run` consumers must never execute PR-head code. Validate
  provenance and live PR state before using credentials or writing.
- Use file-backed JSON payloads (`jq -n --rawfile`, `gh api --input`) for
  comments. Keep handoff names and schemas centralized in `handoff.py`.

Planning is Linux-only and Python-stdlib-only. Runner placement, changed-file
scope, convergence, and workload commands stay independent. The planner alone
authorizes omission; unknown or uncertain inputs retain conservative coverage.
Removing workflow paths from scope tables must not change confidence tiers or
the routing of surviving files.

Convergence identities bind declared inputs, execution class, products, policy,
and schema version. Hashing or declaration changes require a schema bump.
Only trusted atoms publish immutable results; low-privilege CI only reads them
and emits validated handoffs. Postinstall planning and convergence must share
the canonical resolver in `scripts/lib/postinstall_plan.py`.

## Directory ownership

- `workflows/`: workflow entrypoints.
- `actions/`: shared composite setup actions.
- `scripts/` and `config/`: workflow helpers and declarative contracts.
- `templates/`: non-executable delivery text rendered by `scripts/template.py`.

Legacy helpers still consumed by local tools or tests remain. Before removing
one, search repository-wide references, including imports with relative paths
or emitted `.js` extensions. Do not delete shared CI helpers because their
release callers disappeared. Root `scripts/` remains for developer commands
and repository policy; it is test-free.

## Validation

Run focused helper and topology tests after changing cross-workflow behavior.
Useful local checks are:

- `python3 .github/scripts/handoff.py self-check`
- `python3 .github/scripts/scopes.py validate`
- `python3 .github/scripts/convergence.py validate`
- `actionlint -color` when available, plus YAML parsing of remaining workflows
- `pnpm guard`, `pnpm typecheck`, and `git diff --check`

Tests belong under `e2e/tests/`, not beside workflow helpers. Do not start local
development or packaged runtimes merely to validate workflow cleanup.
