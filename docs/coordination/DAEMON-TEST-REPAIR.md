# Daemon baseline repair — 2026-10-27

> Historical validation at the recorded baseline, before
> [slim-core removal](../adr/0012-slim-core.md). Retired craft/ACP tests and
> restored routes below describe that checkpoint, not the current test or
> capability inventory.

The owner-authorized pre-phase-3 repair is complete on `codex/opendesign-base`.
Starting commit: `52c56f7ea124f35cd4098c0291bdb5bc35c21d28`. The unchanged starting
tree was tested before source/test edits: **89 files, 961 passing tests,
30 failures in 13 files, one existing skip**. Phase 2 list A reproduces exactly
three failures; list B reproduces exactly five. They contain no unidentified
additional failure.

Every touched test file passes independently. Together they pass **111/111
tests in 13 files, zero skips**. Root guard, root typecheck, daemon build and the
required isolated game-workspace E2E pass. No failure remains in the verified
daemon set. Nine cases exclusively about deleted content/routes were retired;
the other 21 starting failures pass. Craft coverage additionally gained a
positive detail check and a stricter malformed-ID assertion.

## Verified starting failures and disposition

Paths below are relative to `apps/daemon/tests/`. Categories follow the task:
**a** = retired feature/stale expectation; **b** = Windows fixture/environment;
**c** = real product bug. Mixed categories describe separate causes inside one
guard. For parametrized discovery cases, Vitest truncates `$path` in its printed
title; the table expands the full fixture path to identify the case exactly.

| # | File and case | Starting error | Category | Change and result |
|---|---|---|---|---|
| 1 | `plugins-export.test.ts` — `exportPlugin target=claude-plugin writes SKILL.md + .claude-plugin/plugin.json` | Forward-slash suffix predicate returned false. | b | Assert the complete native `path.join` output path. PASS. |
| 2 | `resume-continue-prompt-context.test.ts` — `resume continue prompt context carries the original request when a headless Continue turn cannot resume the session` | `failed.resumable`: expected true, got false. | b | Native Node/cmd fake Claude; consume a complete JSONL user frame and flush output before exit. Original-request and fresh-session assertions preserved. PASS. |
| 3 | Same file — `resume continue prompt context carries the original request through the transcript on the web Continue shape` | `failed.resumable`: expected true, got false. | b | Same portable fixture; transcript sentinel and resume invalidation checks preserved. PASS. |
| 4 | `craft-route.test.ts` — `GET /api/craft returns a craft array of { id, label, bytes }` | Expected 200, got 404. | c | Restore retained craft list/detail endpoints in an independent route module. PASS, including strengthened red/green coverage below. |
| 5 | `export-tool-token-authority.test.ts` — `pixo export run-scoped project authority revokes renderer asset capability as soon as the renderer promise settles` | 502 `UPSTREAM_UNAVAILABLE`: renderer returned a slide path outside the export scratch directory. | b | Replace the POSIX FIFO with a real PNG and deferred image read. Prove the read has started, the HTTP response is still pending, and the renderer-only URL already returns 404; then release the read and require exact PNG bytes/200. PASS. |
| 6 | `server-paths.test.ts` — `resolveDaemonCliPath uses the packaged daemon CLI path override before package resolution` | Windows `C:\app\…` differed from POSIX `/app/…`. | b | Use a native absolute fixture path; require exact override precedence. PASS. |
| 7 | Same file — `resolveDaemonCliPath uses PIXO_BIN as a fallback override for bundled wrapper invocations` | Same drive/root mismatch. | b | Native absolute fixture path and exact equality. PASS. |
| 8 | Same file — `resolveDaemonPluginPreviewsDir honors an PIXO_PLUGIN_PREVIEWS_DIR override from the injected env` | `C:\repo\rel\previews` differed from drive-less `\repo\rel\previews`. | b | Use a fully resolved project root/absolute override; preserve absolute and relative override checks. PASS. |
| 9 | `acp-handshake-failure-wiring.test.ts` — `ACP handshake rejection — server wiring keeps a bundled runtime that never started retryable, and does not blame the CLI` | Process-tree cleanup error replaced `json-rpc id 2: start opencode server: opencode exited before readiness: exit status 3`. | b | The isolated PATH omitted `powershell.exe`, so native process enumeration was unavailable. Keep only fixture and Windows system tool directories. Exact message, retryability, retry count and persisted classification all PASS. |
| 10 | `acp-service-failure-wiring.test.ts` — `ACP model-service failure classes — server wiring names a mid-turn provider overload as an upstream outage` | Expected `UPSTREAM_UNAVAILABLE`, got `AGENT_EXECUTION_FAILED`. | b | Same PATH fix. Live error frames and persisted provider-outage classification PASS. |
| 11 | `acp-stage-timeout-wiring.test.ts` — `ACP stage timeout — server wiring reaches the chat as a named, retryable timeout on every surface` | Terminal error frame lacked `{ kind: 'acp_stage_timeout', action: 'retry' }`. | b | Same PATH fix. Every error frame, final run verdict and restored message retain timeout/retry details. PASS. |
| 12 | `skills.test.ts` — `listSkills includes the agent-browser skill as an external CLI integration` | CRLF body did not contain the LF multiline prohibition. | b | Normalize line endings only for the assertion; retain the complete browser attachment rule. PASS. |
| 13 | `static-resource-routes.test.ts` — `static resource mutation routes rejects cross-origin POST /api/design-systems/install before catalog or filesystem work` | Expected 403, got 404. | a | Retire deleted-route case; keep both live skill mutation origin guards. |
| 14 | Same title template, `POST /api/design-systems/import/local` | Expected 403, got 404. | a | Retire deleted-route case. |
| 15 | Same title template, `POST /api/design-systems/import/github` | Expected 403, got 404. | a | Retire deleted-route case. |
| 16 | Same title template, `POST /api/design-systems/import/shadcn` | Expected 403, got 404. | a | Retire deleted-route case. |
| 17 | Same title template, `DELETE /api/design-systems/demo-system` | Expected 403, got 404. | a | Retire deleted-route case. Retained file PASS, 2/2. |
| 18 | `prompts/discovery-localization-drift.test.ts` — `active skill clarification policy 'plugins/_official/examples/html-ppt/SKILL.md' does not restore a fixed clarification gate` | ENOENT, deleted fixture. | a | Retire only this deleted presentation example. |
| 19 | Same title template, `plugins/_official/examples/audio-jingle/SKILL.md` | CRLF did not match `Missing metadata is not\nan instruction to ask`. | b | Normalize CRLF; keep positive and negative clarification checks. PASS. |
| 20 | Same title template, `design-templates/audio-jingle/SKILL.md` | Same multiline CRLF mismatch. | b | Same assertion-only normalization. PASS. |
| 21 | Same title template, `design-templates/contact-widget/SKILL.md` | CRLF did not match the consolidated-form directive. | b | Same normalization, preserving exact wording. PASS. |
| 22 | Same title template, `plugins/_official/examples/guizang-ppt/SKILL.md` | ENOENT, deleted fixture. | a | Retire deleted presentation example. |
| 23 | Same title template, `plugins/_official/examples/guizang-ppt/references/styles.md` | ENOENT, deleted fixture. | a | Retire deleted presentation reference. |
| 24 | Same title template, `plugins/community/hallmark/SKILL.md` | CRLF did not match the on-demand clarification sentence. | b | Normalize CRLF; preserve forbidden fixed-gate phrases. PASS. |
| 25 | Same file — `product clarification copy 'plugins/_official/examples/open-design-landing/example.html' describes clarification as on demand` | ENOENT, deleted example. | a | Retire only this example; keep both surviving landing-template checks. File PASS, 14/14. |
| 26 | `prompts/host-failure-narration.test.ts` — `host-failure narration — class guard every flagged line carries a written verdict` | Windows relative paths failed every registry match; two existing game directives also lacked verdicts. | a/b | Canonicalize scanner paths to `/`; manually classify the existing requested recipe outcome and honest verification report, with exact line lengths. PASS. |
| 27 | Same file — `host-failure narration — class guard no registered line has been edited since it was excused` | ENOENT for deleted `skills/hatch-pet/SKILL.md`. | a | Remove its three obsolete registry entries. Keep all surviving length pins unchanged. PASS. |
| 28 | Same file — `host-failure narration — class guard the registry has no stale entries` | All 31 entries appeared stale because scanner paths used `\`; pet entries really were stale. | a/b | Normalize paths and retire only deleted pet entries. PASS. |
| 29 | Same file — `host-failure narration — class guard pins the three W84 rewrites the detector can no longer see` | CRLF did not match `Never\n  paste upstream error text into the reply`. | b | Normalize instance-fixture line endings; keep positive suppression and negative leak checks. File PASS, 7/7. |
| 30 | `prompts/stable-sections.test.ts` — `diffStableSections names every section that moved, in declaration order` | Actual `['memory', 'mode']`; expected an extra `'design-system'`. | a | Require exactly the two changed inputs; no source change. File PASS, 18/18. |

### Prompt review

No prompt text, snapshot or existing registry line-length pin was changed.
The two added registry verdicts were reviewed against the complete existing
lines in `packages/contracts/src/prompts/openpixo-game.ts`: recipe exit 5 reports
the requested operation's failure (214 characters, introduced in `47078621f`),
and unavailable verification names work not performed (218 characters,
`9d53a70e2`). These are explicit verdicts for retained game behavior, not blanket
exceptions. The six previously contested entries stay contested and count-pinned.
Both daemon/contracts localization guards remain. No removed domain was revived.

### Older reports that no longer reproduce

These ran unchanged at the starting HEAD and passed: `frontmatter.test.ts`,
`plugins-code-migration-e2e.test.ts` (including the full atom chain),
`routes/projects.test.ts` (already using a Windows junction), `routes/handoff.test.ts`
(all 17 HTTP cases, default hook budget), and
`runtimes/run-failure-telemetry-smoke.test.ts` (all five cases, existing budgets).
The current PATH already supplies a working `true`; no fixture edit was needed.
The frozen-skill symlink suites were deleted with OD Next in `d9940308` and were
not recreated. The deleted Bash HTML-PPT fixture likewise has no current case.

## Real product bug and red/green evidence

`b4dc84ba` deleted `routes/design-systems.ts`, which also contained the unrelated
`GET /api/craft` and `GET /api/craft/:id` handlers. Craft content, injection and
`pixo craft list|show` remained. Both commands therefore called missing endpoints.

The original list test went red at the untouched baseline. Before changing
source, the malformed-ID assertion was tightened from accepting 400 **or** 404
to requiring 400, and a catalog-to-detail Markdown/byte-length check was added.
The complete red run was **1 pass / 3 fail**, all three failures returning 404.
After mounting `routes/craft.ts`, the same file passes **4/4** independently and
in the combined run. The module restores the previous JSON shapes, missing-file
behavior and slug validation; `server.ts` only imports/registers it and the
route-context assertion checks its narrow path dependency. No CLI or UI behavior
was invented to hide the regression.

This is the only product-source bug fixed. Other changes are test repairs.

## Validation commands

All Node/pnpm commands use repository Node **24.22.1** / pnpm **10.33.2**, with
the two pinned toolchain directories prepended to PATH. `D` below means
`pnpm --filter @openpixo/daemon exec vitest run -c vitest.config.ts`.
JSON reporter/output flags only save evidence under `.tmp/daemon-tests-repair/`.
Lists A/B are the exact lists in [PHASE2-CLI.md](PHASE2-CLI.md#exact-focused-file-selections).

The extra starting selection was:

```text
tests/prompts
tests/static-resource-routes.test.ts
tests/acp-handshake-failure-wiring.test.ts
tests/acp-service-failure-wiring.test.ts
tests/acp-stage-timeout-wiring.test.ts
tests/routes/projects.test.ts
tests/plugins-code-migration-e2e.test.ts
tests/frontmatter.test.ts
tests/skills.test.ts
tests/routes/handoff.test.ts
tests/runtimes/run-failure-telemetry-smoke.test.ts
```

`F` is the exact final 13-file selection:

```text
tests/prompts/discovery-localization-drift.test.ts
tests/prompts/host-failure-narration.test.ts
tests/prompts/stable-sections.test.ts
tests/static-resource-routes.test.ts
tests/acp-handshake-failure-wiring.test.ts
tests/acp-service-failure-wiring.test.ts
tests/acp-stage-timeout-wiring.test.ts
tests/plugins-export.test.ts
tests/resume-continue-prompt-context.test.ts
tests/server-paths.test.ts
tests/skills.test.ts
tests/export-tool-token-authority.test.ts
tests/craft-route.test.ts
```

| Invocation / evidence name | Result |
|---|---|
| `node --version`; `pnpm --version` | PASS: 24.22.1 / 10.33.2. |
| `D <list A>` (`baseline-a`) | Expected FAIL: 43 files, 459 pass / 3 fail / 1 existing skip; 166.452 s. |
| `D <list B>` (`baseline-b`) | Expected FAIL: 16 files, 138 pass / 5 fail; 88.494 s. |
| `D <extra starting selection>` (`baseline-extra`) | Expected FAIL: 30 files, 364 pass / 22 fail; 96.202 s. |
| `D` first four F files (`prompt-audit`) | Intermediate FAIL: 40 pass / 1 fail. Identified the two missing game-prompt verdicts after path normalization; reviewed both before registration. |
| `D tests/prompts/discovery-localization-drift.test.ts` (`solo-discovery`) | PASS, 14/14. |
| `D tests/prompts/host-failure-narration.test.ts` (`solo-host-narration`) | PASS, 7/7. |
| `D tests/prompts/stable-sections.test.ts` (`solo-stable-sections`) | PASS, 18/18. |
| `D tests/static-resource-routes.test.ts` (`solo-static-resource`) | PASS, 2/2. |
| `D` first four F files (`group-prompt-retirement`) | PASS, 41/41. |
| `pnpm guard`; `pnpm typecheck` (`group1-*`) | Both PASS before `9b6ac77d`. |
| `D` ACP handshake/service/stage, plugins-export, server-paths, skills, resume-continue files (`portable-audit`) | PASS, 51/51. |
| `D tests/export-tool-token-authority.test.ts` (`solo-export-token`) | PASS, 15/15. |
| `D tests/plugins-export.test.ts` (`solo-plugin-export`) | PASS, 5/5. |
| `D tests/server-paths.test.ts` (`solo-server-paths`) | PASS, 14/14. |
| `D tests/skills.test.ts` (`solo-skills`) | PASS, 20/20. |
| `D tests/resume-continue-prompt-context.test.ts` (`solo-resume`) | PASS, 2/2 after removing idle/exit sleeps. |
| `D tests/acp-handshake-failure-wiring.test.ts` (`solo-acp-handshake`) | PASS, 6/6. |
| `D tests/acp-service-failure-wiring.test.ts` (`solo-acp-service`) | PASS, 3/3. |
| `D tests/acp-stage-timeout-wiring.test.ts` (`solo-acp-timeout`) | PASS, 1/1. |
| `pnpm guard`; `pnpm typecheck` (`group2-*`) | Both PASS before `239cecb1`. |
| `D tests/craft-route.test.ts` (`craft-red`) | Expected FAIL before source fix: 1 pass / 2 fail, including strict malformed-ID check. |
| Same command, complete new regression (`craft-red-complete`) | Expected FAIL before source fix: 1 pass / 3 fail. |
| Same command after source fix (`solo-craft-green`) | PASS, 4/4. |
| `pnpm guard`; `pnpm typecheck` (`group3-*`) | Both PASS before `bd9bdb0f`. |
| `pnpm --filter @openpixo/daemon build` (`final-daemon-build`) | PASS, exit 0. |
| `D <F>` (`together-final`) | PASS, 111/111, 13 files, no skips; 105.762 s command wall time. |
| `pnpm --filter @openpixo/e2e exec vitest run -c ../.tmp/daemon-tests-repair/e2e.config.ts tests/openpixo/game-workspace.test.ts --reporter=json --outputFile=<task report>` (`final-e2e`) | PASS, 1/1, 39.701 s command wall time. |
| `pnpm guard`; `pnpm typecheck` (documentation checkpoint and final note review) | Both PASS at both checkpoints before the documentation commit. |
| `git diff --check` and staged diff checks | PASS before every commit. |
| Four local `git -c user.name=Claude -c user.email=claude@local.invalid commit …` invocations | PASS; no co-author metadata. No push. |

The E2E temporary config only redirects the existing suite's scratch prefix.
It preserves the standard suite's ports, namespaces, lifecycle and assertions;
daemon data propagation follows root `AGENTS.md`. Namespace:
`e2e-openpixo-game-workspace-1793086257122-21rto1`. The suite report records success,
and its runtime scratch was removed by the normal successful-suite cleanup.
Curated reports and raw Vitest/command logs remain under this task's ignored
scratch prefix. Node emitted its existing DEP0190 shell-argument warning; the
smoke still completed successfully.

### Timing and completion signals

No test/hook timeout was increased and no skip was added. The ACP repair fixes
missing OS tool discovery, rather than lengthening a cleanup budget. The export
test explicitly controls the read; the Claude fixture consumes a full user
frame and exits on stream-flush callbacks rather than fixed idle/exit delays.

| Test body | Starting failing body (ms) | Final passing body (ms) |
|---|---:|---:|
| Renderer capability revocation | 31.98 | 7.23 |
| Headless Continue context | 4,031.00 | 7,924.95 |
| Web Continue context | 2,932.76 | 7,713.56 |
| ACP bundled startup failure | 1,632.03 | 7,296.36 |
| ACP provider overload | 1,699.20 | 8,176.81 |
| ACP timeout surfaces | 2,887.15 | 9,555.35 |

These are Vitest test-body durations, not file/job timings. Passing Continue
cases now execute the real second turn; ACP cases now perform the intended
retry and native process verification instead of failing early. Their longer
bodies are not a performance regression claim or a reason to weaken coverage.

## Commits and scope

| Commit | Cause |
|---|---|
| `9b6ac77d` — `test(daemon): align prompt guards with retained features` | Retired-content assertions and portable prompt guards. |
| `239cecb1` — `test(daemon): make local agent fixtures portable on Windows` | Paths, CRLF, native fixture launch, process tools and deferred export handoff. |
| `bd9bdb0f` — `fix(daemon): restore retained craft catalog routes` | Real craft HTTP/CLI regression with red/green evidence. |
| Documentation commit containing this report | Replace the corresponding phase-1/2 exclusion notes and update STATUS. |

All commits use `Claude <claude@local.invalid>` without co-author trailers.
No full daemon/web suite, live model/provider test, push, global install/config
change, installed Alpha.3 operation or phase-3 work was performed. Only
task-owned runtimes were started/stopped. No unrelated working-tree changes
were present at entry.

The historical `e2e/specs/web-clone/main.spec.ts` fake-Chrome Windows failure in
the phase-2 report is outside this daemon-repair scope and was not rerun or
changed. No claim is made that all unrelated repository suites are green.
