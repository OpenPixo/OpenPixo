# OpenPixo collaboration startup boundary

> Historical defect and repair record. The Vela/collaboration implementation
> and cloud opt-in described below were subsequently removed under
> [ADR 0012](../adr/0012-slim-core.md); this is not a current startup contract.

Updated: 2026-10-25 (Asia/Tokyo). Owner: `startup_boundary_audit`.

## Confirmed defect

The existing `registerVelaRoutes` default-off guard did not cover collaboration
startup. `server.ts` derives `workspaceHubAccountIdentity` through
`velaWorkspaceDirectoryIdentity(readVelaControlApiContext, ...)` during server
construction. The shared control reader still inspected the upstream profile.
The production `/api/workspace/directory` route also used that reader through
the workspace authority broker, independently of the gated Vela routes.

A new regression used a generated synthetic upstream profile and mocked all
non-loopback fetches. On the prior source, two cases failed: startup identity
contained the synthetic upstream account, and real local directory/context
HTTP requests attempted two upstream fetches. No external request was sent.

## Small shared correction

`apps/daemon/src/integrations/vela.ts` now guards the raw login, credential
revision and control-context readers before profile access. Unless the daemon
process explicitly sets `OPENPIXO_UPSTREAM_CLOUD_ENABLED=1`, they return a
neutral signed-out projection. Per-agent credential overrides cannot turn on
this daemon-wide optional integration.

No route, server wiring or authorization algorithm changed. The directory is
empty for the signed-out local identity; an explicitly claimed prior Workspace
is still rejected with `403 WORKSPACE_ACCESS_DENIED`. Explicit daemon opt-in
retains the existing profile-backed behavior. The test confirms the synthetic
profile remains unchanged and records zero profile reads and zero upstream
fetches on the disabled path.

## Actual validation

- Red witness: `tests/collab/openpixo-startup-isolation.test.ts`, 2 failed and
  1 passed before the fix.
- Focused source/authority regression: 118/118 passed across that new file,
  `tests/routes/openpixo-cloud-isolation.test.ts`,
  `tests/vela-workspace-context.test.ts` and
  `tests/collab-context-routes.test.ts`.
- Final new-file rerun including the per-agent override guard: 3/3 passed.
- `pnpm --filter @openpixo/daemon typecheck`: passed for source and tests.

Revalidated on the final source at 2026-10-25 13:55 local time: the same four
files passed 118/118 (3.13 s); daemon source and test typecheck exited 0
(6.34 s).

## Retained integration fixtures

`apps/daemon/vitest.config.ts` loads `tests/setup.ts`, which explicitly opts
retained upstream integration fixtures in through the daemon process flag.
That also covers the direct-reader fixtures in analytics, connection tests,
wallet, Vela routes and telemetry; downstream collab/publish fixtures replace
the reader with a mock. The new isolation suite clears the daemon flag itself.

The original `tests/integrations/vela.test.ts` only redirected `HOME`, while
the implementation resolves the default directory with `os.homedir()`. Its
fixture now supplies a temporary `AMR_HOME` so Windows runs cannot inspect a
real profile. The three affected original describe groups, selected with
`-t 'readVelaLoginStatus|readVelaCredentialRevision|readVelaControlApiContext'`,
passed 18/18 (1.18 s); the other 17 tests were intentionally unselected.

This audit did not execute the broader analytics, wallet, Vela route,
telemetry or publish suites; their shared opt-in or mocked-reader setup was
reviewed in source. The real `vela-login-activation-e2e.local.test.ts` was not
run because it invokes an installed CLI and real login flow. This is focused
startup and workspace-authority evidence, not a claim about all upstream
egress paths or a complete daemon regression run.

Use the pinned Node 24 / pnpm 10 toolchain and package-scoped `exec vitest run`
with the exact file paths above. No full suites, real provider/model calls,
public uploads, commits or installer builds were executed by this agent.

The existing Alpha binary predates this source correction. The parent owns
final guard/typecheck, rebuilding the affected delivery and updating its
artifact evidence before any publication claim.
