# OpenPixo acceptance evidence

Updated: 2026-10-25 (Asia/Tokyo). Owned by `acceptance_qa`.

## Focused acceptance witnesses

- `e2e/tests/openpixo/game-workspace.test.ts` uses an isolated existing tools-dev suite and production HTTP APIs. It imports two disposable real folders, checks image/audio bytes and traversal rejection, imports and updates a local skill and stdio MCP configuration, verifies project scope, native app-server approvals, parallel task ownership, interruption/resumption, child-task attribution, derived asset visibility and preservation after extension removal.
- `e2e/ui/openpixo-assets.test.ts` uses the existing Playwright suite, actual daemon folder import, and actual file APIs. It checks a decoded image thumbnail, audio controls, type filtering, selection across filters, two real file references staged in the composer, and refresh after an external filesystem change.
- `e2e/resources/openpixo-codex.ts` is a hermetic Codex JSON-RPC fixture. Its receipts record configuration and protocol methods without copying full prompts. It does not prove real model behavior or actual MCP execution.
- `e2e/resources/openpixo-mcp.ts` is a real local JSONL stdio MCP fixture. It supports initialize, ping, tools/list and tools/call. Tool `openpixo_ping` returns `OPENPIXO_MCP_OK`. Optional `OPENPIXO_MCP_RECEIPT` records actual tool calls for live verification.
- `e2e/tests/openpixo/live-codex.test.ts` skips its real model task unless the selected provider's independent live gate is enabled and never enables it in CI. Default Codex uses existing native authentication through the user's Codex home as an integration input; third-party paths require their dedicated runtime key/model configuration. It invokes the reviewed fixture batch helper with bundled FFmpeg, validates two nonzero WAVs samplewise at amplitude 0.5, checks original hashes and actual MCP calls, and requires actual completed child activity on the default Codex path.

## Commands and current results

Use the pinned workspace Node 24 / pnpm 10 toolchain. The ordinary sandbox currently rejects `realpath` on this Windows checkout; checks ran with the approved shell boundary.

```powershell
$env:PATH = (Join-Path (Get-Location) '.cache\toolchain\node_modules\node\bin') + ';' + (Join-Path (Get-Location) '.cache\toolchain\node_modules\.bin') + ';' + $env:PATH
$taskNode = '.\.cache\toolchain\node_modules\node\bin\node.exe'
$taskPnpm = '.\.cache\toolchain\node_modules\pnpm\bin\pnpm.cjs'
& $taskNode $taskPnpm --filter @openpixo/e2e typecheck
& $taskNode $taskPnpm --filter @openpixo/e2e test tests/openpixo/game-workspace.test.ts
& $taskNode $taskPnpm --filter @openpixo/e2e exec playwright test -c playwright.config.ts ui/openpixo-assets.test.ts --workers=1
& $taskNode $taskPnpm --filter @openpixo/e2e test tests/openpixo/live-codex.test.ts
& $taskNode e2e/resources/openpixo-mcp.ts --self-check
```

| Check | Actual result |
| --- | --- |
| E2E package typecheck | Passed after product owner fixed the daemon prompt's local metadata type. |
| MCP fixture self-check | Passed. |
| Native game workspace HTTP chain | Passed 1/1 in 57.99s after runtime owner corrected the real scope error. Includes approval cancellation → canceled, replay rejection, independent simultaneous projects, resume, child projection and extension lifecycle/injection. |
| Browser asset witness | Audio-strengthened case passed 1/1 in 71.55s including isolated lifecycle; body 8.2s. It played a nonzero 0.1s WAV muted through native `ended`, with playback time advancing and no media error. No flaky or unexpected results. |
| Live-test safety/offline FFmpeg self-checks | 4/4 passed; authentic model task skipped. Covers independent provider gates, required runtime configuration, credential scrubbing, completed-child evidence, confined approvals and real offline FFmpeg attenuation/preservation. |
| Authenticated model / actual MCP / real skill batch | Parent-owned live task, not executed by QA. |

The first typecheck exposed missing `baseDir` in the daemon prompt's local `ProjectMetadata`; the product owner fixed it. This was a source failure, not a flaky test. No real provider keys or unrelated game folders were read.

The first native HTTP run preserved failure evidence under `.tmp/e2e/e2e-openpixo-game-workspace-1792883860279-vv716c/`; run `ec6ac2e5-4e53-412d-9c74-e07ca83428a5` failed before the fake CLI spawned. Runtime owner fixed the run-owned variable scope and added a production startServer/API regression. No timeout increase was made. Subsequent runs capture terminal run status/events explicitly on failure.

Passing API evidence: `.tmp/e2e/e2e-openpixo-game-workspace-1792894447867-fw0ka2/report/game-workspace.json`. Passing browser evidence: `e2e/ui/reports/results.json`; the attached screenshot was exported unchanged to `.tmp/evidence/openpixo-assets.png`. Successful isolated runtimes and their scratch project folders were cleaned by the existing suite.

The later `--enable multi_agent` per-process default was added after this API run and is covered by the runtime owner's focused argv test; actual native child participation remains part of the gated live task. The final E2E package typecheck passed after all QA fixture/test additions.

## Parent live verification recipe

Use a disposable game fixture, the authenticated native Codex executable already selected by the user, and production APIs. Do not replace the user's global Codex configuration.

1. `POST /api/import/folder` with `{ "baseDir": "<absolute disposable game folder>" }`; retain the returned project and conversation IDs.
2. Import an actual game batch skill with `POST /api/projects/:id/extensions` and `{ "kind": "skill", "source": "<absolute skill folder>" }`.
3. Import the local MCP server through the same endpoint with `{ "kind": "mcp", "server": { "id": "acceptance-ping", "transport": "stdio", "command": "<absolute pinned Node 24 exe>", "args": ["<absolute e2e/resources/openpixo-mcp.ts>"], "env": { "OPENPIXO_MCP_RECEIPT": "<absolute disposable receipt file>" }, "enabled": true } }`.
4. `POST /api/runs` with project ID, conversation ID, `agentId: "codex"`, fresh assistant/client request IDs and a prompt to follow the enabled batch skill, call `openpixo_ping`, then create derived copies of the selected original image/audio under `assets/derived`, reporting successes and failures. Keep originals unchanged.
5. Observe `/api/runs/:runId/events`; if `/approvals` returns pending requests, respond explicitly through `/api/runs/:runId/approvals/:requestId`. Verify the MCP receipt contains `openpixo_ping`, the reply contains `OPENPIXO_MCP_OK`, the derived files exist through `/api/projects/:id/files`, and original bytes are unchanged.

Only that live check can establish real native Codex + project MCP + skill participation. The hermetic acceptance suite deliberately makes no such claim.

After separate authorization for the selected path, run the same single `tests/openpixo/live-codex.test.ts` command once: default Codex uses `OPENPIXO_LIVE_PROVIDER=codex` (or omit the selector) plus `OPENPIXO_LIVE_CODEX=1` and existing authentication; DeepSeek/OpenRouter require their own selector and independent `OPENPIXO_LIVE_DEEPSEEK=1` / `OPENPIXO_LIVE_OPENROUTER=1`, with matching dedicated `_API_KEY` and explicit `_MODEL` environment variables. Credentials are read only inside the selected live callback, passed in the native run's in-memory provider snapshot, and scrubbed before errors/reports; they are never written to app config. No provider loop or fallback exists, and default/CI live tasks skip. The authorization request for one default Codex task remains pending; neither that task nor a third-party live path has been authorized yet. Default Codex now requires a completed real child with distinct parent/child IDs; third-party child activity is recorded separately as observed evidence. The existing bounded task still checks code inspection, tools, skill/MCP and audio transforms; image input/generation remain unexercised. Only offline checks and the one strengthened browser case were run for this preparation; no live gate was executed.
