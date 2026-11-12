# Codex approval UI

Owner: `runtime_core/approval_ui`. Updated 2026-10-25 (Asia/Tokyo).

- Added `apps/web/src/components/chat/CodexApprovals.tsx` and colocated CSS Module, using shared Button and chat theme tokens.
- `ChatPane.codexApprovalRunId` scopes requests to the current daemon run. `ProjectView` wiring belongs to `game_assets` and is present.
- Queries `GET /api/runs/:runId/approvals` while mounted, with one second between completed reads. Sends only a user's explicit accept/decline/cancel decision to `POST /api/runs/:runId/approvals/:requestId`.
- Run changes discard old reads and clear controls; unmount cancels reads, decisions and polling. Read-only viewers get no approval controls. Request reason, command, working directory and paths remain readable.
- Added six `chat.approval.*` dictionary keys to all 19 locales and the typed Dict.
- Focused Vitest: `pnpm --filter @openpixo/web exec vitest run -c vitest.config.ts tests/components/chat/codex-approvals.test.tsx --maxWorkers=1` passed 10 tests using the workspace Node 24 / pnpm 10.33.2 toolchain. Windows sandbox realpath restrictions required an escalated test run.

Parent integration checks still required: web typecheck and visual/API smoke against the real daemon approval route. No paid model call or full web test suite run by this agent.
